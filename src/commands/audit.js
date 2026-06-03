import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { detectProject, formatIssueMarkdown, validateProject } from '../validation/project.js';

const IGNORED_DIRS = new Set([
  '.coreclaw',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'venv',
]);

export async function auditCommand(rootPath = '.', options = {}) {
  const auditOptions = resolveAuditOptions(options);
  const rootDir = resolveProjectPath(rootPath);
  const workerDirs = discoverWorkerDirs(rootDir, auditOptions);
  const ignoredIssueCodes = parseIssueCodes(auditOptions.ignoreIssueCodes);
  const results = [];

  for (const workerDir of workerDirs) {
    results.push(auditWorker(workerDir, { ignoredIssueCodes }));
  }

  const report = {
    root: rootDir,
    generated_at: new Date().toISOString(),
    options: {
      audit_profile_path: auditOptions.auditProfilePath ?? null,
      fail_on_warn: auditOptions.failOnWarn === true,
      ignored_issue_codes: [...ignoredIssueCodes].sort(),
    },
    totals: summarize(results),
    workers: results,
  };

  if (auditOptions.output) {
    const outFile = path.resolve(process.cwd(), auditOptions.output);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (auditOptions.markdown) {
    const outFile = path.resolve(process.cwd(), auditOptions.markdown);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, renderMarkdown(report), 'utf8');
  }

  printAuditSummary(report);

  if (report.totals.errors > 0 && !auditOptions.soft) {
    throw new CliError(`Audit found ${report.totals.errors} worker(s) with errors.`);
  }
  if (auditOptions.failOnWarn === true && report.totals.warn > 0 && !auditOptions.soft) {
    throw new CliError(`Audit found ${report.totals.warn} worker(s) with warnings and --fail-on-warn is enabled.`);
  }

  return report;
}

function resolveAuditOptions(options = {}) {
  if (!options.auditProfile) {
    return options;
  }

  const { profile, profilePath } = readAuditProfile(options.auditProfile);
  const explicitOptions = definedOptions(options);
  return {
    ...profile,
    ...explicitOptions,
    auditProfilePath: profilePath,
    ignoreIssueCodes: mergeIssueCodeOptions(profile.ignoreIssueCodes, explicitOptions.ignoreIssueCodes),
  };
}

export function discoverWorkerDirs(rootDir, options = {}) {
  const recursive = options.recursive !== false;
  const includeAllMainDirs = options.all === true;
  const candidates = new Set();

  if (isWorkerDir(rootDir)) {
    return [rootDir];
  }

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (isWorkerDir(fullPath) && (includeAllMainDirs || isProductWorkerDir(fullPath))) {
        candidates.add(fullPath);
      }

      if (recursive) {
        visit(fullPath);
      }
    }
  }

  visit(rootDir);
  return [...candidates].sort((a, b) => a.localeCompare(b));
}

function isWorkerDir(dir) {
  return ['main.py', 'main.js', 'main.go'].some((entry) => fs.existsSync(path.join(dir, entry)));
}

function isProductWorkerDir(dir) {
  return /^worker-/i.test(path.basename(dir));
}

function auditWorker(workerDir, options = {}) {
  const ignoredIssueCodes = options.ignoredIssueCodes ?? new Set();
  try {
    const result = validateProject(workerDir);
    const { activeIssues, ignoredIssues } = partitionIssues(result.issues, ignoredIssueCodes);
    const actionableIssues = activeIssues.map((issue) => withAuditCommands(issue, workerDir));
    const errors = actionableIssues.filter((issue) => issue.severity === 'error');
    const warnings = actionableIssues.filter((issue) => issue.severity === 'warn');
    return {
      name: path.basename(workerDir),
      path: workerDir,
      language: result.language,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
      error_count: errors.length,
      warning_count: warnings.length,
      ignored_issue_count: ignoredIssues.length,
      issues: actionableIssues,
      ignored_issues: ignoredIssues,
    };
  } catch (error) {
    let language = null;
    try {
      language = detectProject(workerDir).language;
    } catch {
      // Keep null; the project is not detectable.
    }
    return {
      name: path.basename(workerDir),
      path: workerDir,
      language,
      status: 'error',
      error_count: 1,
      warning_count: 0,
      ignored_issue_count: 0,
      issues: [{
        severity: 'error',
        code: 'audit_exception',
        message: error.message,
      }],
      ignored_issues: [],
    };
  }
}

function summarize(results) {
  return {
    workers: results.length,
    pass: results.filter((result) => result.status === 'pass').length,
    warn: results.filter((result) => result.status === 'warn').length,
    errors: results.filter((result) => result.status === 'error').length,
    issue_count: results.reduce((sum, result) => sum + result.issues.length, 0),
    ignored_issue_count: results.reduce((sum, result) => sum + result.ignored_issues.length, 0),
  };
}

function printAuditSummary(report) {
  const ignored = report.totals.ignored_issue_count > 0 ? `, ${report.totals.ignored_issue_count} ignored issue(s)` : '';
  console.log(`Audited ${report.totals.workers} worker(s): ${report.totals.pass} pass, ${report.totals.warn} warn, ${report.totals.errors} error${ignored}.`);
  for (const worker of report.workers) {
    const marker = worker.status.toUpperCase().padEnd(5, ' ');
    const ignoredCount = worker.ignored_issue_count > 0 ? ` ignored=${worker.ignored_issue_count}` : '';
    console.log(`[${marker}] ${worker.name} (${worker.language ?? 'unknown'}) errors=${worker.error_count} warnings=${worker.warning_count}${ignoredCount}`);
  }
}

function renderMarkdown(report) {
  const lines = [
    '# CoreClaw Worker Audit',
    '',
    `Generated: ${report.generated_at}`,
    '',
    `Root: \`${report.root}\``,
    '',
    `Summary: ${report.totals.workers} worker(s), ${report.totals.pass} pass, ${report.totals.warn} warn, ${report.totals.errors} error, ${report.totals.ignored_issue_count} ignored issue(s).`,
    '',
    '| Worker | Language | Status | Errors | Warnings | Ignored |',
    '| --- | --- | --- | ---: | ---: | ---: |',
  ];

  for (const worker of report.workers) {
    lines.push(`| ${worker.name} | ${worker.language ?? ''} | ${worker.status} | ${worker.error_count} | ${worker.warning_count} | ${worker.ignored_issue_count} |`);
  }

  lines.push('');

  for (const worker of report.workers.filter((item) => item.issues.length > 0 || item.ignored_issues.length > 0)) {
    lines.push(`## ${worker.name}`);
    lines.push('');
    for (const issue of worker.issues) {
      lines.push(formatIssueMarkdown(issue));
    }
    for (const issue of worker.ignored_issues) {
      lines.push(formatIssueMarkdown({
        ...issue,
        severity: `ignored ${issue.severity}`.toUpperCase(),
      }));
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function readAuditProfile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const profileDir = path.dirname(resolved);
  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid audit profile JSON in ${resolved}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`Audit profile must be a JSON object: ${resolved}`);
  }

  const profile = {};
  const allowedKeys = new Set([
    'all',
    'failOnWarn',
    'ignoreIssueCodes',
    'markdown',
    'output',
    'recursive',
    'soft',
  ]);
  for (const [rawKey, value] of Object.entries(parsed)) {
    const key = toCamel(rawKey);
    if (!allowedKeys.has(key)) {
      throw new CliError(`Unsupported audit profile field "${rawKey}" in ${resolved}.`);
    }
    if (value !== undefined && value !== null) {
      profile[key] = normalizeAuditProfileValue(value, resolved, key);
    }
  }

  return {
    profile: resolveAuditProfilePaths(profile, profileDir),
    profilePath: resolved,
  };
}

function normalizeAuditProfileValue(value, filePath, key) {
  if (key === 'ignoreIssueCodes') {
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        if (typeof item !== 'string') {
          throw new CliError(`Audit profile field "ignore_issue_codes" item ${index} in ${filePath} must be a string.`);
        }
        return item.trim();
      }).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value;
    }
    throw new CliError(`Audit profile field "ignore_issue_codes" in ${filePath} must be a string or string array.`);
  }

  if (['failOnWarn', 'all', 'recursive', 'soft'].includes(key)) {
    if (typeof value !== 'boolean') {
      throw new CliError(`Audit profile field "${key}" in ${filePath} must be a boolean.`);
    }
    return value;
  }

  if (['output', 'markdown'].includes(key)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new CliError(`Audit profile field "${key}" in ${filePath} must be a non-empty string.`);
    }
    return value.trim();
  }

  return value;
}

function resolveAuditProfilePaths(profile, profileDir) {
  const resolved = { ...profile };
  for (const key of ['output', 'markdown']) {
    if (typeof resolved[key] === 'string' && resolved[key] && !path.isAbsolute(resolved[key])) {
      resolved[key] = path.resolve(profileDir, resolved[key]);
    }
  }
  return resolved;
}

function definedOptions(options) {
  return Object.fromEntries(Object.entries(options).filter(([_key, value]) => value !== undefined && value !== null));
}

function mergeIssueCodeOptions(profileValue, optionValue) {
  return [...new Set([...parseIssueCodes(profileValue), ...parseIssueCodes(optionValue)])];
}

function parseIssueCodes(value) {
  if (value === undefined || value === null || value === '') {
    return new Set();
  }
  const values = Array.isArray(value) ? value : String(value).split(',');
  return new Set(values.map((item) => String(item).trim()).filter(Boolean));
}

function partitionIssues(issues, ignoredIssueCodes) {
  const activeIssues = [];
  const ignoredIssues = [];
  for (const issue of issues) {
    if (issue.code && ignoredIssueCodes.has(issue.code)) {
      ignoredIssues.push(issue);
    } else {
      activeIssues.push(issue);
    }
  }
  return { activeIssues, ignoredIssues };
}

function withAuditCommands(issue, workerDir) {
  return {
    ...issue,
    commands: auditIssueCommands(workerDir),
  };
}

function auditIssueCommands(workerDir) {
  return [
    `node ./bin/coreclaw.js validate "${workerDir}" --strict`,
    `node ./bin/coreclaw.js verify "${workerDir}" --strict --min-results 1`,
  ];
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toCamel(value) {
  return value.replace(/[_-]([a-z])/g, (_match, letter) => letter.toUpperCase());
}
