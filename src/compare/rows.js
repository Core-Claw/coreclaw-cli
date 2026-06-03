import fs from 'node:fs';
import path from 'node:path';
import { resultStatusIssuesFromValues, shouldRequireStatusGate } from '../runtime/result-gates.js';
import { validateOutputSchemaRow } from '../runtime/run-store.js';
import { CliError } from '../utils/errors.js';

export function readCloudRows(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const text = stripBom(fs.readFileSync(resolved, 'utf8'));
  if (looksLikeCsv(filePath, text)) {
    return parseCsvRows(text, resolved);
  }
  const parsed = parseJsonText(text, filePath);
  return extractCloudRows(parsed, filePath);
}

export function readOutputSchema(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const parsed = readJson(resolved);
  if (!Array.isArray(parsed)) {
    throw new CliError(`Output schema must be a JSON array: ${resolved}`);
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
  const ignoreFields = parseFieldList(options.ignoreFields);
  const ignoreKeys = parseFieldList(options.ignoreKeys);
  const ignoreKeySet = new Set(ignoreKeys);
  const keyOf = (row) => keyFields.length > 0
    ? keyFields.map((field) => valueAtPath(row, field) ?? '').join('\t')
    : defaultKeyOf(row);
  const shouldCompareRow = (row) => !ignoreKeySet.has(keyOf(row));
  const comparisonCloudRows = cloudRows.filter(shouldCompareRow);
  const comparisonLocalRows = localRows.filter(shouldCompareRow);

  const cloudDuplicateKeys = duplicateKeys(comparisonCloudRows, keyOf);
  const localDuplicateKeys = duplicateKeys(comparisonLocalRows, keyOf);
  const cloudMap = new Map(comparisonCloudRows.map((row) => [keyOf(row), row]));
  const localMap = new Map(comparisonLocalRows.map((row) => [keyOf(row), row]));
  const shared = comparisonLocalRows.filter((row) => cloudMap.has(keyOf(row)));
  const onlyCloud = comparisonCloudRows.filter((row) => !localMap.has(keyOf(row)));
  const onlyLocal = comparisonLocalRows.filter((row) => !cloudMap.has(keyOf(row)));
  const valueDiffs = shared
    .map((local) => {
      const cloud = cloudMap.get(keyOf(local));
      const comparableCloud = omitFields(cloud, ignoreFields);
      const comparableLocal = omitFields(local, ignoreFields);
      return {
        key: keyOf(local),
        local,
        cloud,
        changed_fields: changedFieldPaths(comparableCloud, comparableLocal),
      };
    })
    .filter(({ changed_fields: changedFields }) => changedFields.length > 0);
  const valueDiffFieldCounts = countChangedFields(valueDiffs);
  const cloudStatusIssues = resultStatusIssuesFromValues(cloudRows, options);
  const localStatusIssues = resultStatusIssuesFromValues(localRows, options);
  const outputSchema = Array.isArray(options.outputSchema) ? options.outputSchema : [];
  const cloudOutputSchemaIssues = resultOutputSchemaIssues(cloudRows, outputSchema);
  const localOutputSchemaIssues = resultOutputSchemaIssues(localRows, outputSchema);

  return {
    ok: true,
    key_fields: keyFields,
    ignored_fields: ignoreFields,
    ignored_keys: ignoreKeys,
    cloud_count: cloudRows.length,
    local_count: localRows.length,
    ignored_cloud_row_count: cloudRows.length - comparisonCloudRows.length,
    ignored_local_row_count: localRows.length - comparisonLocalRows.length,
    shared_count: shared.length,
    only_cloud_count: onlyCloud.length,
    only_local_count: onlyLocal.length,
    value_diff_count: valueDiffs.length,
    cloud_duplicate_key_count: cloudDuplicateKeys.length,
    local_duplicate_key_count: localDuplicateKeys.length,
    cloud_result_status_issue_count: cloudStatusIssues.length,
    local_result_status_issue_count: localStatusIssues.length,
    cloud_output_schema_issue_count: cloudOutputSchemaIssues.length,
    local_output_schema_issue_count: localOutputSchemaIssues.length,
    cloud_first_10_keys: cloudRows.slice(0, 10).map(keyOf),
    local_first_10_keys: localRows.slice(0, 10).map(keyOf),
    only_cloud_first_20: onlyCloud.slice(0, 20),
    only_local_first_20: onlyLocal.slice(0, 20),
    value_diff_first_20: valueDiffs.slice(0, 20),
    value_diff_fields_top_20: valueDiffFieldCounts.slice(0, 20),
    cloud_duplicate_keys_first_20: cloudDuplicateKeys.slice(0, 20),
    local_duplicate_keys_first_20: localDuplicateKeys.slice(0, 20),
    cloud_result_status_issues_first_20: cloudStatusIssues.slice(0, 20),
    local_result_status_issues_first_20: localStatusIssues.slice(0, 20),
    cloud_output_schema_issues_first_20: cloudOutputSchemaIssues.slice(0, 20),
    local_output_schema_issues_first_20: localOutputSchemaIssues.slice(0, 20),
  };
}

function duplicateKeys(rows, keyOf) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([_key, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function countChangedFields(valueDiffs) {
  const counts = new Map();
  for (const diff of valueDiffs) {
    for (const field of diff.changed_fields) {
      counts.set(field, (counts.get(field) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([field, count]) => ({ field, count }))
    .sort((left, right) => right.count - left.count || left.field.localeCompare(right.field));
}

function changedFieldPaths(left, right, prefix = '') {
  if (stableStringify(left) === stableStringify(right)) {
    return [];
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return [prefix || '<row>'];
  }

  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
  return keys.flatMap((key) => changedFieldPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assertCompareThresholds(report, options = {}) {
  const minShared = parseOptionalNonNegativeInteger(options.minShared, '--min-shared');
  const maxDiff = parseOptionalNonNegativeInteger(options.maxDiff, '--max-diff');
  const maxOnlyLocal = parseOptionalNonNegativeInteger(options.maxOnlyLocal, '--max-only-local');
  const maxOnlyCloud = parseOptionalNonNegativeInteger(options.maxOnlyCloud, '--max-only-cloud');

  if (minShared !== null && report.shared_count < minShared) {
    throw new CliError(withCompareDiagnostics(report, `Comparison shared_count=${report.shared_count}, expected at least ${minShared}.`));
  }
  if (maxDiff !== null && report.value_diff_count > maxDiff) {
    throw new CliError(withCompareDiagnostics(report, `Comparison value_diff_count=${report.value_diff_count}, expected at most ${maxDiff}.`));
  }
  if (maxOnlyLocal !== null && report.only_local_count > maxOnlyLocal) {
    throw new CliError(withCompareDiagnostics(report, `Comparison only_local_count=${report.only_local_count}, expected at most ${maxOnlyLocal}.`));
  }
  if (maxOnlyCloud !== null && report.only_cloud_count > maxOnlyCloud) {
    throw new CliError(withCompareDiagnostics(report, `Comparison only_cloud_count=${report.only_cloud_count}, expected at most ${maxOnlyCloud}.`));
  }
  if (options.requireUniqueKeys) {
    const duplicateCount = report.cloud_duplicate_key_count + report.local_duplicate_key_count;
    if (duplicateCount > 0) {
      throw new CliError(withCompareDiagnostics(report, `Comparison has ${duplicateCount} duplicate key(s): cloud=${report.cloud_duplicate_key_count}, local=${report.local_duplicate_key_count}.`));
    }
  }
  if (shouldRequireStatusGate(options)) {
    const issueCount = report.cloud_result_status_issue_count + report.local_result_status_issue_count;
    if (issueCount > 0) {
      throw new CliError(withCompareDiagnostics(report, `Comparison has ${issueCount} failing result status row(s): cloud=${report.cloud_result_status_issue_count}, local=${report.local_result_status_issue_count}.`));
    }
  }
  if (options.requireOutputSchemaMatch) {
    const issueCount = report.cloud_output_schema_issue_count + report.local_output_schema_issue_count;
    if (issueCount > 0) {
      throw new CliError(withCompareDiagnostics(report, `Comparison has ${issueCount} output_schema mismatch issue(s): cloud=${report.cloud_output_schema_issue_count}, local=${report.local_output_schema_issue_count}.`));
    }
  }
}

function withCompareDiagnostics(report, message) {
  const parts = [];
  if (report.only_cloud_count > 0) {
    parts.push(`only_cloud=${summarizeRows(report.only_cloud_first_20)}`);
  }
  if (report.only_local_count > 0) {
    parts.push(`only_local=${summarizeRows(report.only_local_first_20)}`);
  }
  if (report.value_diff_count > 0) {
    parts.push(`value_diff=${summarizeDiffs(report.value_diff_first_20)}`);
  }
  if (report.cloud_result_status_issue_count > 0) {
    parts.push(`cloud_status=${summarizeStatusIssues(report.cloud_result_status_issues_first_20)}`);
  }
  if (report.local_result_status_issue_count > 0) {
    parts.push(`local_status=${summarizeStatusIssues(report.local_result_status_issues_first_20)}`);
  }
  if (parts.length === 0) {
    return message;
  }
  return `${message} ${parts.join('; ')}`;
}

function summarizeRows(rows) {
  return rows.slice(0, 5).map((row) => row.contract_id ?? row.check_name ?? row.id ?? stableStringify(row).slice(0, 80)).join(',');
}

function summarizeDiffs(diffs) {
  return diffs.slice(0, 5).map((diff) => `${diff.key}:${diff.changed_fields.slice(0, 5).join('|')}`).join(',');
}

function summarizeStatusIssues(issues) {
  return issues.slice(0, 5).map((issue) => {
    const row = issue.row ?? {};
    const key = row.contract_id ?? row.check_name ?? row.id ?? `row${issue.index}`;
    return `${key}:${issue.field}=${issue.value}`;
  }).join(',');
}

function resultOutputSchemaIssues(rows, outputSchema) {
  if (!Array.isArray(outputSchema) || outputSchema.length === 0) {
    return [];
  }
  return rows.flatMap((row, index) => validateOutputSchemaRow(outputSchema, row, index + 1));
}

function readJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  return parseJsonText(stripBom(fs.readFileSync(resolved, 'utf8')), filePath);
}

function parseJsonText(text, filePath) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function looksLikeCsv(filePath, text) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    return true;
  }
  const trimmed = text.trimStart();
  return trimmed !== '' && !trimmed.startsWith('[') && !trimmed.startsWith('{');
}

function parseCsvRows(text, filePath) {
  const records = parseCsvRecords(text, filePath);
  if (records.length === 0) {
    return [];
  }
  const headers = records[0].map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => header === '')) {
    throw new CliError(`Cloud CSV export must have non-empty header names: ${filePath}`);
  }
  const duplicateHeaders = duplicateHeaderNames(headers);
  if (duplicateHeaders.length > 0) {
    throw new CliError(`Cloud CSV export has duplicate header name(s): ${duplicateHeaders.join(', ')} in ${filePath}`);
  }
  return records.slice(1)
    .filter((record) => record.some((value) => value !== ''))
    .map((record, index) => {
      if (record.length !== headers.length) {
        throw new CliError(`Cloud CSV export row ${index + 2} has ${record.length} column(s), expected ${headers.length}: ${filePath}`);
      }
      return Object.fromEntries(headers.map((header, columnIndex) => [header, record[columnIndex]]));
    });
}

function parseCsvRecords(text, filePath) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  let afterQuotedField = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuotedField = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuotedField) {
      if (char === ',') {
        record.push(field);
        field = '';
        quotedField = false;
        afterQuotedField = false;
        continue;
      }
      if (char === '\r' || char === '\n') {
        record.push(field);
        field = '';
        quotedField = false;
        afterQuotedField = false;
        if (char === '\r' && text[index + 1] === '\n') {
          index += 1;
        }
        records.push(record);
        record = [];
        continue;
      }
      if (char === ' ' || char === '\t') {
        continue;
      }
      throw new CliError(`Invalid CSV quote at ${filePath}:${records.length + 1}.`);
    }

    if (char === '"') {
      if (field === '') {
        inQuotes = true;
        quotedField = true;
        continue;
      }
      throw new CliError(`Invalid CSV quote at ${filePath}:${records.length + 1}.`);
    }
    if (char === ',') {
      record.push(field);
      field = '';
      quotedField = false;
      continue;
    }
    if (char === '\r' || char === '\n') {
      record.push(field);
      field = '';
      quotedField = false;
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      records.push(record);
      record = [];
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new CliError(`Unclosed CSV quote in ${filePath}.`);
  }
  if (field !== '' || quotedField || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function duplicateHeaderNames(headers) {
  const seen = new Set();
  const duplicates = new Set();
  for (const header of headers) {
    if (seen.has(header)) {
      duplicates.add(header);
    }
    seen.add(header);
  }
  return Array.from(duplicates);
}

function extractCloudRows(value, filePath) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    throw new CliError(`Cloud output must be a JSON array or CoreClaw result-list response object: ${filePath}`);
  }

  for (const fieldPath of cloudRowArrayPaths()) {
    const candidate = valueAtPath(value, fieldPath);
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const downloadUrl = valueAtPath(value, 'data.download_url') ?? valueAtPath(value, 'download_url');
  if (downloadUrl) {
    throw new CliError(`Cloud output JSON contains only an export download_url, not result rows: ${filePath}. Download the JSON export file first, or use the /api/v1/run/result/list response JSON.`);
  }
  throw new CliError(`Cloud output must be a JSON array or contain result rows at data.list, data.rows, data.items, rows, items, or results: ${filePath}`);
}

function cloudRowArrayPaths() {
  return [
    'data.list',
    'data.rows',
    'data.items',
    'data.results',
    'data.records',
    'data.result.list',
    'data.result.rows',
    'data.result.items',
    'data.result.results',
    'list',
    'rows',
    'items',
    'results',
    'records',
    'data',
  ];
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseKeyFields(value) {
  return parseFieldList(value);
}

function parseFieldList(value) {
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

function omitFields(value, fieldPaths) {
  if (fieldPaths.length === 0) {
    return value;
  }
  const clone = structuredCloneFallback(value);
  for (const fieldPath of fieldPaths) {
    deleteAtPath(clone, fieldPath);
  }
  return clone;
}

function deleteAtPath(value, fieldPath) {
  if (!fieldPath) {
    return;
  }
  const parts = fieldPath.split('.');
  let current = value;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object') {
      return;
    }
    current = current[part];
  }
  if (current && typeof current === 'object') {
    delete current[parts.at(-1)];
  }
}

function structuredCloneFallback(value) {
  if (globalThis.structuredClone) {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
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
