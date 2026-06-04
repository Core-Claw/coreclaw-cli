import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { printJson, shouldPrintJson } from '../utils/output.js';
import { resolveProjectPath } from '../utils/paths.js';

const IGNORED_DIRS = new Set([
  '.git',
  '.coreclaw',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py']);

export async function migrateCommand(positionals = [], options = {}) {
  const target = positionals[0];
  if (target !== 'apify') {
    throw new CliError('migrate requires a supported target. Usage: coreclaw migrate apify [project]');
  }

  const projectDir = resolveProjectPath(positionals[1] ?? '.');
  const report = inspectApifyMigration(projectDir);

  if (options.output) {
    const outFile = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.markdown) {
    const outFile = path.resolve(process.cwd(), options.markdown);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, renderApifyMigrationMarkdown(report), 'utf8');
  }

  if (shouldPrintJson(options)) {
    printJson(report);
  } else {
    printApifyMigrationReport(report);
  }

  return report;
}

export function inspectApifyMigration(projectPath = '.') {
  const projectDir = resolveProjectPath(projectPath);
  const packageJsonPath = path.join(projectDir, 'package.json');
  const actorJsonPath = path.join(projectDir, '.actor', 'actor.json');
  const inputSchemaPath = firstExistingPath([
    path.join(projectDir, '.actor', 'input_schema.json'),
    path.join(projectDir, 'input_schema.json'),
  ]);
  const sourceFiles = listSourceFiles(projectDir);
  const packageJson = readOptionalJson(packageJsonPath);
  const sourceMatches = scanSourceFiles(sourceFiles);
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  const detected = {
    apify: Boolean(
      fs.existsSync(actorJsonPath)
      || dependencies.apify
      || sourceMatches.apify.length > 0,
    ),
    crawlee: Boolean(dependencies.crawlee || sourceMatches.crawlee.length > 0),
    browser_crawler: sourceMatches.browser.length > 0,
    package_json_path: fs.existsSync(packageJsonPath) ? packageJsonPath : null,
    actor_json_path: fs.existsSync(actorJsonPath) ? actorJsonPath : null,
    input_schema_path: inputSchemaPath,
    source_file_count: sourceFiles.length,
  };

  const findings = buildApifyFindings({ projectDir, detected, sourceMatches, inputSchemaPath });
  const totals = summarizeFindings(findings);

  return {
    project_dir: projectDir,
    generated_at: new Date().toISOString(),
    detected,
    totals,
    findings,
    next_commands: nextCommands(projectDir),
  };
}

function buildApifyFindings({ detected, sourceMatches, inputSchemaPath }) {
  const findings = [];

  if (!detected.apify && !detected.crawlee) {
    findings.push(finding({
      severity: 'warn',
      code: 'apify_project_not_detected',
      title: '未检测到明显的 Apify/Crawlee 项目特征',
      message: '没有发现 .actor/actor.json、apify/crawlee 依赖或常见 Apify/Crawlee API 调用。',
      action: '确认目录是否为 Apify Actor 根目录，或手动运行 coreclaw init 创建新的 CoreClaw Worker。',
    }));
    return findings;
  }

  findings.push(finding({
    severity: inputSchemaPath ? 'warn' : 'blocker',
    code: 'apify_input_schema_convert',
    title: '迁移输入 schema',
    message: inputSchemaPath
      ? `发现 Apify input schema: ${inputSchemaPath}`
      : '未发现 Apify input schema；CoreClaw 仍需要 input_schema.json 来定义运行表单。',
    action: '把 Apify Actor input schema 转成 CoreClaw `input_schema.json`，重点检查 requestListSources、secret、default 和 required 字段。',
    docs: ['developer-guide/worker-definition/input-schema.md'],
  }));

  if (sourceMatches.dataset.length > 0) {
    findings.push(finding({
      severity: 'blocker',
      code: 'apify_dataset_pushdata',
      title: '迁移 Dataset 输出',
      message: '发现 Apify/Crawlee dataset 输出 API。',
      action: '将 Dataset.pushData 或 Actor.pushData 改为 CoreClaw SDK result.pushData，并让输出字段匹配 output_schema.json。',
      evidence: { files: sourceMatches.dataset },
      docs: ['developer-guide/worker-definition/output-schema.md'],
    }));
  }

  if (sourceMatches.kvStore.length > 0) {
    findings.push(finding({
      severity: 'blocker',
      code: 'apify_kv_store_manual_migration',
      title: '手动迁移 Key-Value Store',
      message: '发现 Apify KeyValueStore/Actor.setValue/getValue 用法。',
      action: 'CoreClaw Worker 输出应优先通过 push_data 写结构化结果；运行状态、缓存或大文件持久化需要按 CoreClaw 平台能力重新设计。',
      evidence: { files: sourceMatches.kvStore },
    }));
  }

  if (sourceMatches.requestQueue.length > 0) {
    findings.push(finding({
      severity: 'blocker',
      code: 'apify_request_queue_manual_migration',
      title: '手动迁移 Request Queue',
      message: '发现 Apify/Crawlee RequestQueue 用法。',
      action: '将队列调度改造成 CoreClaw 输入拆分、本地循环或平台 Task/run 组合；不要假设 CoreClaw 提供 Apify RequestQueue 等价持久队列。',
      evidence: { files: sourceMatches.requestQueue },
      docs: ['developer-guide/worker-definition/input-schema.md'],
    }));
  }

  if (sourceMatches.proxy.length > 0) {
    findings.push(finding({
      severity: 'warn',
      code: 'apify_proxy_configuration',
      title: '迁移代理配置',
      message: '发现 Apify proxy configuration 用法。',
      action: '改为读取 CoreClaw PROXY_AUTH 和 PROXY_DOMAIN，并在本地用 coreclaw verify --local-proxy --require-proxy-usage 验证。',
      evidence: { files: sourceMatches.proxy },
      docs: ['developer-guide/worker-definition/platform-features/proxy-support.md'],
    }));
  }

  if (sourceMatches.browser.length > 0) {
    findings.push(finding({
      severity: 'warn',
      code: 'apify_browser_crawler',
      title: '迁移浏览器 crawler',
      message: '发现 Playwright/Puppeteer/Cheerio crawler 或 Crawlee browser crawler。',
      action: '浏览器 Worker 需要适配 CoreClaw ChromeWs/CDP_ENDPOINT 或 LightpandaDomain 契约，并用 browser/lightpanda shim 做上传前校验。',
      evidence: { files: sourceMatches.browser },
      docs: ['developer-guide/worker-definition/platform-features/browser-use.md'],
    }));
  }

  if (sourceMatches.apify.length > 0 || sourceMatches.crawlee.length > 0) {
    findings.push(finding({
      severity: 'blocker',
      code: 'coreclaw_sdk_adaptation',
      title: '替换运行生命周期和 SDK',
      message: '发现 Apify/Crawlee 运行生命周期或 SDK 调用。',
      action: '将 Actor.init/getInput/exit、Crawlee crawler.run 等入口迁移为 CoreClaw SDK getInputJSONObject、log、setTableHeader 和 pushData 流程。',
      evidence: { files: unique([...sourceMatches.apify, ...sourceMatches.crawlee]) },
      docs: ['developer-guide/develop-worker/quick-start.md'],
    }));
  }

  return findings;
}

function finding({ severity, code, title, message, action, evidence = {}, docs = [] }) {
  return { severity, code, title, message, action, evidence, docs };
}

function summarizeFindings(findings) {
  return {
    findings: findings.length,
    blockers: findings.filter((finding) => finding.severity === 'blocker').length,
    warnings: findings.filter((finding) => finding.severity === 'warn').length,
  };
}

function nextCommands(projectDir) {
  const targetDir = `${projectDir}-coreclaw`;
  const name = `${path.basename(projectDir)}-coreclaw`;
  return [
    `node ./bin/coreclaw.js init "${targetDir}" --language node --name ${name}`,
    `node ./bin/coreclaw.js validate "${targetDir}" --strict`,
    `node ./bin/coreclaw.js verify "${targetDir}" --strict --min-results 1`,
  ];
}

function scanSourceFiles(files) {
  const matches = {
    apify: [],
    crawlee: [],
    dataset: [],
    kvStore: [],
    requestQueue: [],
    proxy: [],
    browser: [],
  };

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    addIf(matches.apify, file, /\bActor\.|from ['"]apify['"]|require\(['"]apify['"]\)/.test(text));
    addIf(matches.crawlee, file, /from ['"]crawlee['"]|require\(['"]crawlee['"]\)|\bCrawler\b|\bPlaywrightCrawler\b|\bPuppeteerCrawler\b|\bCheerioCrawler\b/.test(text));
    addIf(matches.dataset, file, /\bDataset\.pushData\b|\bActor\.pushData\b/.test(text));
    addIf(matches.kvStore, file, /\bKeyValueStore\b|\bActor\.(?:setValue|getValue|openKeyValueStore)\b/.test(text));
    addIf(matches.requestQueue, file, /\bRequestQueue\b|\bActor\.openRequestQueue\b/.test(text));
    addIf(matches.proxy, file, /\bcreateProxyConfiguration\b|\bProxyConfiguration\b|proxyConfiguration/.test(text));
    addIf(matches.browser, file, /\bPlaywrightCrawler\b|\bPuppeteerCrawler\b|\bBrowserCrawler\b|\blaunchContext\b|\bpuppeteer\b|\bplaywright\b/.test(text));
  }

  return matches;
}

function addIf(list, file, condition) {
  if (condition) {
    list.push(file);
  }
}

function listSourceFiles(rootDir) {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  visit(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function firstExistingPath(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) ?? null;
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function unique(values) {
  return Array.from(new Set(values));
}

function printApifyMigrationReport(report) {
  console.log(`Apify migration audit: ${report.project_dir}`);
  console.log(`Detected: apify=${report.detected.apify} crawlee=${report.detected.crawlee} browser=${report.detected.browser_crawler}`);
  console.log(`Findings: ${report.totals.findings} (${report.totals.blockers} blocker, ${report.totals.warnings} warning)`);
  for (const item of report.findings) {
    console.log(`[${item.severity.toUpperCase()}] ${item.code}: ${item.title}`);
    console.log(`  Action: ${item.action}`);
  }
  console.log('Next commands:');
  for (const command of report.next_commands) {
    console.log(`  ${command}`);
  }
}

function renderApifyMigrationMarkdown(report) {
  const lines = [
    '# Apify 到 CoreClaw 迁移审计',
    '',
    `项目：\`${report.project_dir}\``,
    '',
    `检测：Apify=${report.detected.apify}，Crawlee=${report.detected.crawlee}，Browser=${report.detected.browser_crawler}`,
    '',
    `汇总：${report.totals.findings} 个发现，${report.totals.blockers} 个阻塞项，${report.totals.warnings} 个警告。`,
    '',
    '## 发现',
    '',
  ];

  for (const item of report.findings) {
    lines.push(`### ${item.code}`, '');
    lines.push(`级别：${item.severity}`);
    lines.push(`说明：${item.message}`);
    lines.push(`处理：${item.action}`);
    if (item.evidence.files?.length) {
      lines.push(`证据文件：${item.evidence.files.map((file) => `\`${file}\``).join(', ')}`);
    }
    if (item.docs.length > 0) {
      lines.push(`CoreClaw 文档：${item.docs.map((doc) => `\`${doc}\``).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## 下一步命令', '', '```bash');
  lines.push(...report.next_commands);
  lines.push('```', '');
  lines.push('建议先创建新的 CoreClaw Worker 目录，再按报告逐项迁移 Apify Actor 的输入、输出、代理、浏览器和存储逻辑。');
  return `${lines.join('\n')}\n`;
}
