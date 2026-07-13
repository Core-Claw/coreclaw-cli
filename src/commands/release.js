import fs from 'node:fs';
import path from 'node:path';
import { inspectPackage, validatePackageReport } from './inspect-package.js';
import { validateProject } from '../validation/project.js';
import { packCommand } from './pack.js';
import {
  createClientFromOptions,
  parseCommaList,
  printOrReturn,
  requireArg,
} from './cloud-utils.js';
import { CliError } from '../utils/errors.js';
import { printJson, shouldPrintJson } from '../utils/output.js';
import { resolveProjectPath } from '../utils/paths.js';

export async function releaseCommand(positionals = [], options = {}) {
  const subcommand = positionals[0];
  if (subcommand === 'dossier') {
    return releaseDossier(positionals.slice(1), options);
  }
  if (subcommand === 'publish') {
    return publishWorker(positionals.slice(1), options);
  }
  throw new CliError('release requires a supported subcommand. Usage: coreclaw release dossier [project] | release publish <worker_slug> [project]');
}

async function publishWorker(args, options) {
  const workerId = requireArg(args[0], 'release publish requires <worker_slug>.');
  const projectDir = resolveProjectPath(args[1] ?? '.');
  const client = createClientFromOptions(options);

  // Build the upload ZIP first (reuses the pack pipeline + validation).
  const defaultOutput = path.join(projectDir, 'dist', 'worker.zip');
  const packagePath = await packCommand(projectDir, {
    ...options,
    output: options.zipOutput ?? defaultOutput,
  });
  const zipBuffer = fs.readFileSync(packagePath);

  const title = requireArg(options.title, 'release publish requires --title.');
  const description = requireArg(options.description, 'release publish requires --description.');
  const categories = parseCommaList(options.categories).map((item) => Number.parseInt(item, 10)).filter(Number.isInteger);

  const response = await client.createWorkerVersion(workerId, {
    scraperFile: zipBuffer,
    title,
    description,
    categories: categories.length > 0 ? categories : undefined,
    icon: options.icon,
  });

  const result = {
    worker_id: workerId,
    package_path: packagePath,
    version: response.data?.version ?? null,
    response,
  };
  if (shouldPrintJson(options)) {
    printJson(result);
  } else {
    console.log(`Published Worker version: ${response.data?.version ?? '-'}`);
    console.log(`Worker: ${workerId}`);
    console.log(`Package: ${packagePath}`);
  }
  return result;
}

async function releaseDossier(positionals, options) {
  const projectDir = resolveProjectPath(positionals[0] ?? '.');
  const report = buildReleaseDossier(projectDir, options);

  if (options.output) {
    const outFile = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.markdown) {
    const outFile = path.resolve(process.cwd(), options.markdown);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, renderReleaseDossierMarkdown(report), 'utf8');
  }

  if (shouldPrintJson(options)) {
    printJson(report);
  } else {
    printReleaseDossier(report);
  }

  return report;
}

export function buildReleaseDossier(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const validation = validateProject(projectDir);
  const packageReport = options.package
    ? packageEvidence(path.resolve(process.cwd(), options.package), validation.language)
    : null;
  const compareReport = options.compareReport ? readJsonEvidence(options.compareReport, 'compare report') : null;
  const runEvidence = options.runEvidence ? readJsonEvidence(options.runEvidence, 'run evidence bundle') : null;
  const diagnosis = options.diagnosis
    ? readJsonEvidence(options.diagnosis, 'diagnosis report')
    : runEvidence?.diagnosis ?? null;
  const cost = options.costReport
    ? readJsonEvidence(options.costReport, 'cost report')
    : runEvidence?.cost ?? null;
  const cloudRun = options.cloudRun ?? diagnosis?.run_slug ?? cost?.run_slug ?? runEvidence?.run_slug ?? null;

  const blockers = releaseBlockers({
    validation,
    packageReport,
    compareReport,
    diagnosis,
    cloudRun,
  });
  const warnings = releaseWarnings({ packageReport, cost });

  return {
    project_dir: projectDir,
    generated_at: new Date().toISOString(),
    readiness: {
      ok: blockers.length === 0,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      blockers,
      warnings,
    },
    local: {
      validation: {
        ok: validation.ok,
        language: validation.language,
        issue_count: validation.issues.length,
        error_count: validation.issues.filter((issue) => issue.severity === 'error').length,
        warning_count: validation.issues.filter((issue) => issue.severity === 'warn').length,
        issues: validation.issues,
      },
      package: packageReport,
    },
    cloud: {
      run_slug: cloudRun,
      run_evidence: runEvidenceEvidence(runEvidence),
      compare: compareEvidence(compareReport),
      diagnosis: diagnosisEvidence(diagnosis),
      cost: costEvidence(cost),
    },
    platform_constraints: {
      upload_api_available: true,
      publish_api_available: true,
      publish_api: 'POST /api/v2/workers/{workerId}/versions (multipart/form-data: scraper_file + title + description + categories)',
      reason: 'CoreClaw API v2 documents worker version creation (upload) and update via POST/PUT /api/v2/workers/{workerId}/versions. Use "coreclaw release publish <worker_slug>" to publish a built ZIP.',
      docs: [
        'developer-guide/deployment.md',
        'developer-guide/publishing-and-monetization/publish-your-worker.md',
      ],
    },
    next_commands: nextReleaseCommands(projectDir, options),
    console_steps: consoleSteps(),
  };
}

function packageEvidence(packagePath, language) {
  const report = inspectPackage(packagePath);
  const validation = validatePackageReport(report, { language });
  return {
    package_path: packagePath,
    package_size: report.package_size,
    package_size_human: report.package_size_human,
    entry_count: report.entry_count,
    root_entries: report.root_entries,
    largest_entries: report.largest_entries,
    language: validation.language,
    language_label: validation.language_label,
    ok: validation.ok,
    issues: validation.issues,
  };
}

function compareEvidence(report) {
  if (!report) {
    return null;
  }
  const summary = report.summary ?? null;
  return {
    ok: Boolean(summary?.ok ?? report.ok),
    schema_version: summary?.schema_version ?? report.summary_schema_version ?? null,
    counts: summary?.counts ?? {
      shared: report.shared_count,
      only_cloud: report.only_cloud_count,
      only_local: report.only_local_count,
      value_diffs: report.value_diff_count,
      cloud_status_issues: report.cloud_result_status_issue_count,
      local_status_issues: report.local_result_status_issue_count,
      cloud_output_schema_issues: report.cloud_output_schema_issue_count,
      local_output_schema_issues: report.local_output_schema_issue_count,
    },
  };
}

function runEvidenceEvidence(report) {
  if (!report) {
    return null;
  }
  return {
    run_slug: report.run_slug ?? null,
    generated_at: report.generated_at ?? null,
    has_detail: Boolean(report.detail),
    has_logs: Boolean(report.logs?.response),
    has_results: Boolean(report.results?.response),
    has_export: Boolean(report.export?.response),
    export_download_path: report.export?.download_path ?? report.files?.export_download ?? null,
    optional_error_count: report.optional_errors?.length ?? 0,
  };
}

function diagnosisEvidence(report) {
  if (!report) {
    return null;
  }
  return {
    run_slug: report.run_slug ?? null,
    status: report.status ?? null,
    status_label: report.status_label ?? null,
    issue_count: report.issues?.length ?? 0,
    issues: report.issues ?? [],
  };
}

function costEvidence(report) {
  if (!report) {
    return null;
  }
  return {
    run_slug: report.run_slug ?? null,
    usage_usd: report.usage_usd ?? null,
    traffic_bytes: report.traffic_bytes ?? null,
    traffic_human: report.traffic_human ?? null,
    cost_breakdown_available: report.cost_breakdown_available ?? false,
  };
}

function releaseBlockers({ validation, packageReport, compareReport, diagnosis, cloudRun }) {
  const blockers = [];
  if (!validation.ok) {
    blockers.push({
      code: 'release_validation_failed',
      message: '本地项目校验仍有 error，不能作为发布候选。',
      command: 'coreclaw validate <project> --strict',
    });
  }
  if (!packageReport) {
    blockers.push({
      code: 'release_package_missing',
      message: '缺少上传 ZIP 包证据。先运行 coreclaw pack 并传入 --package。',
      command: 'coreclaw pack <project> --output dist/worker.zip --strict',
    });
  } else if (!packageReport.ok) {
    blockers.push({
      code: 'release_package_invalid',
      message: '上传 ZIP 包检查未通过。',
      command: 'coreclaw inspect-package <zip> --project <project> --strict',
    });
  }
  if (!cloudRun) {
    blockers.push({
      code: 'release_cloud_run_missing',
      message: '缺少云端 run 证据。发布前应在 CoreClaw 平台测试候选版本。',
      command: 'coreclaw prove <project> --scraper-slug <scraper_slug> --cloud-input request.json',
    });
  }
  if (!compareReport) {
    blockers.push({
      code: 'release_cloud_compare_missing',
      message: '缺少云端/本地结果对比报告。发布前应证明平台输出与本地输出一致。',
      command: 'coreclaw prove <project> --scraper-slug <scraper_slug> --cloud-input request.json --min-shared 1 --max-diff 0',
    });
  } else if (compareEvidence(compareReport).ok !== true) {
    blockers.push({
      code: 'release_cloud_compare_failed',
      message: '云端/本地结果对比未通过。',
      command: 'coreclaw compare cloud-results.json .coreclaw/runs/<run-id> --json-summary',
    });
  }
  if (diagnosis && diagnosis.status !== undefined && diagnosis.status !== 3) {
    blockers.push({
      code: 'release_cloud_run_not_succeeded',
      message: `云端 run 状态不是成功：${diagnosis.status_label ?? diagnosis.status}`,
      command: `coreclaw runs diagnose ${diagnosis.run_slug ?? '<run_slug>'}`,
    });
  }
  return blockers;
}

function releaseWarnings({ packageReport, cost }) {
  const warnings = [];
  for (const issue of packageReport?.issues ?? []) {
    if (issue.severity === 'warn') {
      warnings.push({
        code: issue.code,
        message: issue.message,
      });
    }
  }
  if (!cost) {
    warnings.push({
      code: 'release_cost_missing',
      message: '缺少 run 用量/成本报告。可运行 coreclaw runs cost <run_slug> --output cost.json。',
    });
  }
  return warnings;
}

function nextReleaseCommands(projectDir, options = {}) {
  const commands = [];
  if (!options.package) {
    commands.push(`coreclaw pack "${projectDir}" --output dist/${path.basename(projectDir)}.zip --strict`);
  }
  commands.push(`coreclaw prove "${projectDir}" --scraper-slug <scraper_slug> --cloud-input request.json --min-shared 1 --max-diff 0`);
  if (options.cloudRun) {
    commands.push(`coreclaw runs diagnose ${options.cloudRun} --output diagnosis.json`);
    commands.push(`coreclaw runs cost ${options.cloudRun} --output cost.json`);
  }
  return commands;
}

function consoleSteps() {
  return [
    '在 CoreClaw Console 上传 ZIP，或通过 GitHub import 选择 branch/tag/commit。',
    '等待平台 build 完成并检查 build 日志。',
    '在测试环境运行候选版本，保存 run_slug。',
    '使用 coreclaw runs results/export、compare、diagnose、cost 收集证据。',
    '私有脚本可继续内部运行；公开 Store 发布需在 Console 点击 Submit and Publish to Store 并等待审核。',
  ];
}

function readJsonEvidence(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(stripBom(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new CliError(`Cannot read ${label} ${resolved}: ${error.message}`);
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function printReleaseDossier(report) {
  console.log(`CoreClaw release dossier: ${report.project_dir}`);
  console.log(`Ready: ${report.readiness.ok ? 'yes' : 'no'} (${report.readiness.blocker_count} blocker, ${report.readiness.warning_count} warning)`);
  if (report.cloud.run_slug) {
    console.log(`Cloud run: ${report.cloud.run_slug}`);
  }
  if (report.local.package) {
    console.log(`Package: ${report.local.package.package_path} (${report.local.package.package_size_human})`);
  }
  for (const blocker of report.readiness.blockers) {
    console.log(`[BLOCKER] ${blocker.code}: ${blocker.message}`);
  }
  for (const warning of report.readiness.warnings) {
    console.log(`[WARN] ${warning.code}: ${warning.message}`);
  }
  console.log('Console steps:');
  for (const step of report.console_steps) {
    console.log(`  - ${step}`);
  }
}

function renderReleaseDossierMarkdown(report) {
  const lines = [
    '# CoreClaw 发布交付报告',
    '',
    `项目：\`${report.project_dir}\``,
    '',
    `状态：${report.readiness.ok ? '可作为发布候选' : '仍有阻塞项'}`,
    '',
    `阻塞项：${report.readiness.blocker_count}，警告：${report.readiness.warning_count}`,
    '',
  ];

  if (report.cloud.run_slug) {
    lines.push(`云端 run：\`${report.cloud.run_slug}\``, '');
  }
  if (report.local.package) {
    lines.push(`上传包：\`${report.local.package.package_path}\` (${report.local.package.package_size_human})`, '');
  }

  lines.push('## 阻塞项', '');
  if (report.readiness.blockers.length === 0) {
    lines.push('- 无', '');
  } else {
    for (const blocker of report.readiness.blockers) {
      lines.push(`- ${blocker.code}: ${blocker.message}`);
    }
    lines.push('');
  }

  lines.push('## 证据摘要', '');
  lines.push(`- 本地校验：${report.local.validation.ok ? '通过' : '未通过'}`);
  lines.push(`- 上传包：${report.local.package?.ok ? '通过' : '缺失或未通过'}`);
  lines.push(`- 云端对比：${report.cloud.compare?.ok ? '通过' : '缺失或未通过'}`);
  lines.push(`- 云端诊断：${report.cloud.diagnosis ? `${report.cloud.diagnosis.status_label ?? report.cloud.diagnosis.status}` : '缺失'}`);
  lines.push(`- 成本报告：${report.cloud.cost ? `$${report.cloud.cost.usage_usd ?? 'unknown'}` : '缺失'}`);
  lines.push('');

  lines.push('## Console 手工步骤', '');
  for (const step of report.console_steps) {
    lines.push(`- ${step}`);
  }
  lines.push('');

  lines.push('## 平台限制', '');
  lines.push(report.platform_constraints.reason);
  lines.push('');
  return `${lines.join('\n')}\n`;
}
