#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCloudRows } from '../src/compare/rows.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function usage() {
  console.log(`Usage:
  node tools/verify-platform-output.js <worker-name> <platform-output.json|csv> [--output report.json]

Workers:
  worker-definition-docs-contract-test
  worker-definition-node-puppeteer-contract-test
  worker-definition-go-contract-test
  worker-lightpanda-doc-test
`);
}

function parseArgs(argv) {
  const args = [...argv];
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }
  const worker = args.shift();
  const outputPath = args.shift();
  let reportPath = null;

  while (args.length) {
    const arg = args.shift();
    if (arg === '--output') {
      reportPath = args.shift();
      if (!reportPath) {
        throw new Error('--output requires a file path.');
      }
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!worker || !outputPath) {
    usage();
    throw new Error('worker-name and platform output path are required.');
  }

  return { worker, outputPath, reportPath };
}

const SPECS = {
  'worker-definition-docs-contract-test': {
    key: 'contract_id',
    minRows: 55,
    requiredOk: [
      'proxy-socks5-connect',
      'fingerprint-browser-cdp-connect',
      'captcha-cdp-command',
      'playwright-connect-over-cdp',
      'lightpanda-playwright-connect',
      'selenium-remote-webdriver',
      'drissionpage-cdp-connect'
    ],
    allowedNonOk: ['manual', 'skipped']
  },
  'worker-definition-node-puppeteer-contract-test': {
    key: 'contract_id',
    minRows: 8,
    requiredOk: [
      'node-required-root-files',
      'node-parameter-json',
      'node-log-levels',
      'node-result-output',
      'node-package-contract',
      'node-commonjs-sdk',
      'puppeteer-endpoint-shape',
      'puppeteer-connect'
    ],
    allowedNonOk: []
  },
  'worker-definition-go-contract-test': {
    key: 'contract_id',
    minRows: 7,
    requiredOk: [
      'go-upload-main-binary',
      'go-parameter-json',
      'go-log-levels',
      'go-result-output',
      'go-module-contract',
      'go-linux-build-contract'
    ],
    allowedNonOk: [],
    allowedFailures: ['go-required-root-files']
  },
  'worker-lightpanda-doc-test': {
    key: 'check_name',
    minRows: 1,
    requiredOk: ['page-load'],
    allowedNonOk: []
  }
};

function rowKey(row, key) {
  const value = row?.[key];
  return value == null ? '' : String(value);
}

function statusOf(row) {
  return String(row?.status ?? '').trim().toLowerCase();
}

function buildReport(worker, outputPath, rows) {
  const spec = SPECS[worker];
  if (!spec) {
    throw new Error(`Unsupported worker "${worker}". Use --help to list supported workers.`);
  }

  const byKey = new Map();
  const duplicateKeys = [];
  for (const row of rows) {
    const key = rowKey(row, spec.key);
    if (!key) {
      continue;
    }
    if (byKey.has(key)) {
      duplicateKeys.push(key);
    }
    byKey.set(key, row);
  }

  const missingRequired = [];
  const failingRequired = [];
  for (const key of spec.requiredOk) {
    const row = byKey.get(key);
    if (!row) {
      missingRequired.push(key);
      continue;
    }
    if (statusOf(row) !== 'ok') {
      failingRequired.push({
        key,
        status: row.status ?? '',
        observed: row.observed ?? row.body_preview ?? row.error ?? ''
      });
    }
  }

  const allowedNonOk = new Set(spec.allowedNonOk ?? []);
  const allowedFailures = new Set(spec.allowedFailures ?? []);
  const statusIssues = rows
    .filter((row) => {
      const status = statusOf(row);
      if (!status || status === 'ok') {
        return false;
      }
      const key = rowKey(row, spec.key);
      if (allowedFailures.has(key)) {
        return false;
      }
      return !allowedNonOk.has(status);
    })
    .map((row) => ({
      key: rowKey(row, spec.key),
      status: row.status ?? '',
      observed: row.observed ?? row.body_preview ?? row.error ?? ''
    }));

  const rowCountIssue = rows.length < spec.minRows;
  const ok = !rowCountIssue
    && missingRequired.length === 0
    && failingRequired.length === 0
    && statusIssues.length === 0
    && duplicateKeys.length === 0;

  return {
    ok,
    generated_at: new Date().toISOString(),
    worker,
    output_path: path.resolve(outputPath),
    key_field: spec.key,
    row_count: rows.length,
    min_rows: spec.minRows,
    row_count_issue: rowCountIssue,
    duplicate_key_count: duplicateKeys.length,
    duplicate_keys_first_20: duplicateKeys.slice(0, 20),
    required_ok: spec.requiredOk,
    missing_required: missingRequired,
    failing_required: failingRequired,
    status_issue_count: statusIssues.length,
    status_issues_first_20: statusIssues.slice(0, 20),
    first_20_keys: rows.map((row) => rowKey(row, spec.key)).filter(Boolean).slice(0, 20)
  };
}

function writeReport(report, reportPath) {
  const json = JSON.stringify(report, null, 2);
  if (reportPath) {
    const resolved = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, json, 'utf8');
    console.log(`Report: ${resolved}`);
  }
}

async function main() {
  const { worker, outputPath, reportPath } = parseArgs(process.argv.slice(2));
  const rows = readCloudRows(outputPath);
  const report = buildReport(worker, outputPath, rows);
  writeReport(report, reportPath);

  console.log(`Worker: ${worker}`);
  console.log(`Rows: ${report.row_count}`);
  console.log(`Required missing: ${report.missing_required.length}`);
  console.log(`Required failing: ${report.failing_required.length}`);
  console.log(`Status issues: ${report.status_issue_count}`);
  console.log(`Duplicate keys: ${report.duplicate_key_count}`);

  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Platform output verification passed.');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
