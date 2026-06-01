import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { detectProject, validateProject } from '../validation/project.js';

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
  const rootDir = resolveProjectPath(rootPath);
  const workerDirs = discoverWorkerDirs(rootDir, options);
  const results = [];

  for (const workerDir of workerDirs) {
    results.push(auditWorker(workerDir));
  }

  const report = {
    root: rootDir,
    generated_at: new Date().toISOString(),
    totals: summarize(results),
    workers: results,
  };

  if (options.output) {
    const outFile = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.markdown) {
    const outFile = path.resolve(process.cwd(), options.markdown);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, renderMarkdown(report), 'utf8');
  }

  printAuditSummary(report);

  if (report.totals.errors > 0 && !options.soft) {
    throw new CliError(`Audit found ${report.totals.errors} worker(s) with errors.`);
  }

  return report;
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

function auditWorker(workerDir) {
  try {
    const result = validateProject(workerDir);
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    const warnings = result.issues.filter((issue) => issue.severity === 'warn');
    return {
      name: path.basename(workerDir),
      path: workerDir,
      language: result.language,
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass',
      error_count: errors.length,
      warning_count: warnings.length,
      issues: result.issues,
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
      issues: [{
        severity: 'error',
        code: 'audit_exception',
        message: error.message,
      }],
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
  };
}

function printAuditSummary(report) {
  console.log(`Audited ${report.totals.workers} worker(s): ${report.totals.pass} pass, ${report.totals.warn} warn, ${report.totals.errors} error.`);
  for (const worker of report.workers) {
    const marker = worker.status.toUpperCase().padEnd(5, ' ');
    console.log(`[${marker}] ${worker.name} (${worker.language ?? 'unknown'}) errors=${worker.error_count} warnings=${worker.warning_count}`);
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
    `Summary: ${report.totals.workers} worker(s), ${report.totals.pass} pass, ${report.totals.warn} warn, ${report.totals.errors} error.`,
    '',
    '| Worker | Language | Status | Errors | Warnings |',
    '| --- | --- | --- | ---: | ---: |',
  ];

  for (const worker of report.workers) {
    lines.push(`| ${worker.name} | ${worker.language ?? ''} | ${worker.status} | ${worker.error_count} | ${worker.warning_count} |`);
  }

  lines.push('');

  for (const worker of report.workers.filter((item) => item.issues.length > 0)) {
    lines.push(`## ${worker.name}`);
    lines.push('');
    for (const issue of worker.issues) {
      lines.push(`- **${issue.severity.toUpperCase()}**: ${issue.message}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
