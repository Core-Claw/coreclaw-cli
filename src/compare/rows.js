import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';

export function readCloudRows(filePath) {
  const parsed = readJson(filePath);
  if (!Array.isArray(parsed)) {
    throw new CliError(`Cloud output must be a JSON array: ${filePath}`);
  }
  return parsed;
}

export function readLocalRows(localPath) {
  const filePath = resolveLocalRowsPath(localPath);
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).map((line) => {
    const row = JSON.parse(line);
    return row.value ?? row;
  });
}

export function resolveLocalRowsPath(localPath) {
  const resolved = path.resolve(process.cwd(), localPath);
  if (!fs.existsSync(resolved)) {
    throw new CliError(`Local output path does not exist: ${resolved}`);
  }
  if (fs.statSync(resolved).isDirectory()) {
    const exportPath = path.join(resolved, 'export.ndjson');
    const resultsPath = path.join(resolved, 'results.ndjson');
    if (fs.existsSync(exportPath)) {
      return exportPath;
    }
    if (fs.existsSync(resultsPath)) {
      return resultsPath;
    }
    throw new CliError(`Run directory does not contain export.ndjson or results.ndjson: ${resolved}`);
  }
  return resolved;
}

export function compareRows(cloudRows, localRows, options = {}) {
  const keyFields = parseKeyFields(options.keyFields);
  const keyOf = (row) => keyFields.length > 0
    ? keyFields.map((field) => valueAtPath(row, field) ?? '').join('\t')
    : defaultKeyOf(row);

  const cloudMap = new Map(cloudRows.map((row) => [keyOf(row), row]));
  const localMap = new Map(localRows.map((row) => [keyOf(row), row]));
  const shared = localRows.filter((row) => cloudMap.has(keyOf(row)));
  const onlyCloud = cloudRows.filter((row) => !localMap.has(keyOf(row)));
  const onlyLocal = localRows.filter((row) => !cloudMap.has(keyOf(row)));
  const valueDiffs = shared
    .map((local) => ({ local, cloud: cloudMap.get(keyOf(local)) }))
    .filter(({ local, cloud }) => stableStringify(local) !== stableStringify(cloud));

  return {
    ok: true,
    key_fields: keyFields,
    cloud_count: cloudRows.length,
    local_count: localRows.length,
    shared_count: shared.length,
    only_cloud_count: onlyCloud.length,
    only_local_count: onlyLocal.length,
    value_diff_count: valueDiffs.length,
    cloud_first_10_keys: cloudRows.slice(0, 10).map(keyOf),
    local_first_10_keys: localRows.slice(0, 10).map(keyOf),
    only_cloud_first_20: onlyCloud.slice(0, 20),
    only_local_first_20: onlyLocal.slice(0, 20),
    value_diff_first_20: valueDiffs.slice(0, 20),
  };
}

export function assertCompareThresholds(report, options = {}) {
  const minShared = parseOptionalNonNegativeInteger(options.minShared, '--min-shared');
  const maxDiff = parseOptionalNonNegativeInteger(options.maxDiff, '--max-diff');
  const maxOnlyLocal = parseOptionalNonNegativeInteger(options.maxOnlyLocal, '--max-only-local');
  const maxOnlyCloud = parseOptionalNonNegativeInteger(options.maxOnlyCloud, '--max-only-cloud');

  if (minShared !== null && report.shared_count < minShared) {
    throw new CliError(`Comparison shared_count=${report.shared_count}, expected at least ${minShared}.`);
  }
  if (maxDiff !== null && report.value_diff_count > maxDiff) {
    throw new CliError(`Comparison value_diff_count=${report.value_diff_count}, expected at most ${maxDiff}.`);
  }
  if (maxOnlyLocal !== null && report.only_local_count > maxOnlyLocal) {
    throw new CliError(`Comparison only_local_count=${report.only_local_count}, expected at most ${maxOnlyLocal}.`);
  }
  if (maxOnlyCloud !== null && report.only_cloud_count > maxOnlyCloud) {
    throw new CliError(`Comparison only_cloud_count=${report.only_cloud_count}, expected at most ${maxOnlyCloud}.`);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function parseKeyFields(value) {
  if (!value) {
    return [];
  }
  return String(value).split(',').map((field) => field.trim()).filter(Boolean);
}

function defaultKeyOf(row) {
  if (row?.urlUser) {
    return `${row.username ?? ''}\t${row.site ?? ''}\t${row.urlUser}`;
  }
  return stableStringify(row);
}

function valueAtPath(value, fieldPath) {
  return fieldPath.split('.').reduce((current, field) => current?.[field], value);
}

function parseOptionalNonNegativeInteger(value, name) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const text = String(value);
  const parsed = Number.parseInt(text, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== text) {
    throw new CliError(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
