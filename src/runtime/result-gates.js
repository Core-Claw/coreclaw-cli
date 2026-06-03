import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';

const DEFAULT_STATUS_FIELDS = ['status'];
const DEFAULT_FAIL_VALUES = ['fail', 'failed', 'failure', 'error'];

export function enforceResultStatusGate(runDir, options = {}) {
  if (!shouldRequireStatusGate(options)) {
    return [];
  }

  const issues = resultStatusIssues(runDir, options);
  if (issues.length > 0) {
    throw new CliError(formatResultStatusGateMessage(issues, runDir));
  }
  return issues;
}

export function resultStatusIssues(runDir, options = {}) {
  const rows = readResultRows(runDir);
  return resultStatusIssuesFromRows(rows, options);
}

export function resultStatusIssuesFromValues(values, options = {}) {
  return resultStatusIssuesFromRows(values.map((value, index) => ({ index: index + 1, value })), options);
}

function resultStatusIssuesFromRows(rows, options = {}) {
  const fields = parseListOption(options.resultStatusFields, DEFAULT_STATUS_FIELDS);
  const failValues = new Set(parseListOption(options.resultFailValues, DEFAULT_FAIL_VALUES).map((value) => value.toLowerCase()));
  const issues = [];

  for (const row of rows) {
    const value = row?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    for (const field of fields) {
      const raw = value[field];
      if (raw === undefined || raw === null) {
        continue;
      }
      const normalized = String(raw).trim().toLowerCase();
      if (failValues.has(normalized)) {
        issues.push({
          index: row.index ?? issues.length + 1,
          field,
          value: raw,
          row: value,
        });
      }
    }
  }

  return issues;
}

export function shouldRequireStatusGate(options = {}) {
  return Boolean(options.requireStatusOk || options.requireResultStatusOk);
}

function readResultRows(runDir) {
  const resultsPath = path.join(runDir, 'results.ndjson');
  if (!fs.existsSync(resultsPath)) {
    return [];
  }

  const text = fs.readFileSync(resultsPath, 'utf8').trim();
  if (!text) {
    return [];
  }

  return text.split(/\r?\n/).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new CliError(`Invalid JSON in ${resultsPath} line ${index + 1}: ${error.message}`);
    }
  });
}

function parseListOption(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatResultStatusGateMessage(issues, runDir) {
  const preview = issues.slice(0, 5)
    .map((issue) => `#${issue.index} ${issue.field}=${JSON.stringify(issue.value)}`)
    .join(', ');
  const suffix = issues.length > 5 ? `, and ${issues.length - 5} more` : '';
  return `Run produced ${issues.length} result row(s) with failing status values (${preview}${suffix}). See ${runDir}.`;
}
