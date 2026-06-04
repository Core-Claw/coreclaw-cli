import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { assertCompareThresholds, compareRows, readCloudRows, readLocalRows, readOutputSchema, resolveLocalRowsPath } from '../compare/rows.js';

export async function compareCommand(cloudPath, localPath, options = {}) {
  if (!cloudPath || !localPath) {
    throw new CliError('compare requires <cloud.json> and <local-run-or-ndjson>.');
  }

  const compareOptions = resolveCompareOptions(options);
  const resolvedCloudPath = path.resolve(process.cwd(), cloudPath);
  const resolvedLocalPath = resolveLocalRowsPath(localPath);
  const cloudRows = readCloudRows(resolvedCloudPath);
  const localRows = readLocalRows(resolvedLocalPath);
  const outputSchema = compareOptions.outputSchema ? readOutputSchema(compareOptions.outputSchema) : undefined;
  const ignoreKeys = resolveIgnoreKeys(compareOptions);
  const report = {
    cloud_path: resolvedCloudPath,
    local_path: resolvedLocalPath,
    compare_profile_path: options.compareProfile ? path.resolve(process.cwd(), options.compareProfile) : null,
    output_schema_path: compareOptions.outputSchema ? path.resolve(process.cwd(), compareOptions.outputSchema) : null,
    ignore_keys_file_path: compareOptions.ignoreKeysFile ? path.resolve(process.cwd(), compareOptions.ignoreKeysFile) : null,
    ...compareRows(cloudRows, localRows, { ...compareOptions, outputSchema, ignoreKeys }),
  };
  report.summary_schema_version = 1;
  report.summary = buildCompareSummary(report);

  if (compareOptions.output) {
    const outPath = path.resolve(process.cwd(), compareOptions.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (compareOptions.jsonSummary) {
    console.log(JSON.stringify(report.summary));
  } else {
    printCompareReport(report);
  }
  assertCompareThresholds(report, compareOptions);
  return report;
}

function resolveCompareOptions(options) {
  if (!options.compareProfile) {
    return options;
  }
  const profile = readCompareProfile(options.compareProfile);
  const explicitOptions = definedOptions(options);
  return {
    ...profile,
    ...explicitOptions,
    ignoreKeys: mergeListOptions(profile.ignoreKeys, explicitOptions.ignoreKeys),
    ignoreFields: mergeListOptions(profile.ignoreFields, explicitOptions.ignoreFields),
  };
}

function definedOptions(options) {
  return Object.fromEntries(Object.entries(options).filter(([_key, value]) => value !== undefined && value !== null));
}

function readCompareProfile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  const profileDir = path.dirname(resolved);
  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid compare profile JSON in ${resolved}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`Compare profile must be a JSON object: ${resolved}`);
  }

  const profile = {};
  for (const [rawKey, value] of Object.entries(parsed)) {
    const key = toCamel(rawKey);
    if (value !== undefined && value !== null) {
      profile[key] = normalizeProfileValue(value, resolved, rawKey);
    }
  }
  return resolveProfilePaths(profile, profileDir);
}

function resolveProfilePaths(profile, profileDir) {
  const resolved = { ...profile };
  for (const key of ['outputSchema', 'ignoreKeysFile', 'output']) {
    if (typeof resolved[key] === 'string' && resolved[key] && !path.isAbsolute(resolved[key])) {
      resolved[key] = path.resolve(profileDir, resolved[key]);
    }
  }
  return resolved;
}

function normalizeProfileValue(value, filePath, key) {
  if (Array.isArray(value)) {
    if (!['key_fields', 'keyFields', 'ignore_fields', 'ignoreFields', 'ignore_keys', 'ignoreKeys', 'result_status_fields', 'resultStatusFields', 'result_fail_values', 'resultFailValues'].includes(key)) {
      throw new CliError(`Compare profile field "${key}" in ${filePath} does not accept an array.`);
    }
    return value.map((item, index) => {
      if (typeof item !== 'string') {
        throw new CliError(`Compare profile field "${key}" item ${index} in ${filePath} must be a string.`);
      }
      return item.trim();
    }).filter(Boolean).join(',');
  }
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  throw new CliError(`Compare profile field "${key}" in ${filePath} must be a string, number, boolean, or supported string array.`);
}

function mergeListOptions(profileValue, optionValue) {
  if (profileValue === undefined || profileValue === null || profileValue === '') {
    return optionValue;
  }
  if (optionValue === undefined || optionValue === null || optionValue === '') {
    return profileValue;
  }
  return uniqueList([...parseList(profileValue), ...parseList(optionValue)]).join(',');
}

function resolveIgnoreKeys(options) {
  const inlineKeys = parseList(options.ignoreKeys);
  const fileKeys = options.ignoreKeysFile ? readIgnoreKeysFile(options.ignoreKeysFile) : [];
  return uniqueList([...inlineKeys, ...fileKeys]);
}

function readIgnoreKeysFile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ignore keys file ${resolved}: ${error.message}`);
  }

  const trimmed = stripBom(text).trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseArrayIgnoreKeys(parsed, resolved);
      }
      if (parsed && typeof parsed === 'object') {
        const keys = parsed.ignore_keys ?? parsed.ignoreKeys;
        if (Array.isArray(keys)) {
          return parseArrayIgnoreKeys(keys, resolved);
        }
      }
    } catch (error) {
      throw new CliError(`Invalid ignore keys JSON in ${resolved}: ${error.message}`);
    }
    throw new CliError(`Ignore keys JSON must be an array or an object with ignore_keys/ignoreKeys: ${resolved}`);
  }

  return parseList(trimmed.replace(/^\s*#.*$/gm, '').replace(/\r?\n/g, ','));
}

function parseArrayIgnoreKeys(values, filePath) {
  return values.map((value, index) => {
    if (typeof value !== 'string') {
      throw new CliError(`Ignore key at ${filePath}[${index}] must be a string.`);
    }
    return value.trim();
  }).filter(Boolean);
}

function parseList(value) {
  if (!value) {
    return [];
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueList(values) {
  return Array.from(new Set(values));
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toCamel(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printCompareReport(report) {
  console.log(`Cloud rows: ${report.cloud_count}`);
  console.log(`Local rows: ${report.local_count}`);
  if (report.ignored_keys?.length > 0) {
    console.log(`Ignored comparison keys: ${report.ignored_keys.length} (cloud rows=${report.ignored_cloud_row_count}, local rows=${report.ignored_local_row_count})`);
  }
  console.log(`Shared rows: ${report.shared_count}`);
  console.log(`Only cloud: ${report.only_cloud_count}`);
  console.log(`Only local: ${report.only_local_count}`);
  console.log(`Value diffs: ${report.value_diff_count}`);
  console.log(`Cloud duplicate keys: ${report.cloud_duplicate_key_count}`);
  console.log(`Local duplicate keys: ${report.local_duplicate_key_count}`);
  if (report.value_diff_fields_top_20?.length > 0) {
    const fields = report.value_diff_fields_top_20.slice(0, 5).map((item) => `${item.field}=${item.count}`).join(', ');
    console.log(`Top diff fields: ${fields}`);
  }
  console.log(`Cloud status issues: ${report.cloud_result_status_issue_count}`);
  console.log(`Local status issues: ${report.local_result_status_issue_count}`);
  console.log(`Cloud output_schema issues: ${report.cloud_output_schema_issue_count}`);
  console.log(`Local output_schema issues: ${report.local_output_schema_issue_count}`);
}

function buildCompareSummary(report) {
  const ok = [
    report.only_cloud_count,
    report.only_local_count,
    report.value_diff_count,
    report.cloud_duplicate_key_count,
    report.local_duplicate_key_count,
    report.cloud_result_status_issue_count,
    report.local_result_status_issue_count,
    report.cloud_output_schema_issue_count,
    report.local_output_schema_issue_count,
  ].every((count) => count === 0);

  return {
    schema_version: 1,
    ok,
    exit_code_hint: ok ? 0 : 1,
    counts: {
      cloud_rows: report.cloud_count,
      local_rows: report.local_count,
      ignored_cloud_rows: report.ignored_cloud_row_count,
      ignored_local_rows: report.ignored_local_row_count,
      shared: report.shared_count,
      only_cloud: report.only_cloud_count,
      only_local: report.only_local_count,
      value_diffs: report.value_diff_count,
      cloud_duplicate_keys: report.cloud_duplicate_key_count,
      local_duplicate_keys: report.local_duplicate_key_count,
      cloud_status_issues: report.cloud_result_status_issue_count,
      local_status_issues: report.local_result_status_issue_count,
      cloud_output_schema_issues: report.cloud_output_schema_issue_count,
      local_output_schema_issues: report.local_output_schema_issue_count,
    },
    paths: {
      cloud: report.cloud_path,
      local: report.local_path,
      compare_profile: report.compare_profile_path,
      output_schema: report.output_schema_path,
      ignore_keys_file: report.ignore_keys_file_path,
    },
    keys: {
      key_fields: report.key_fields,
      ignored_fields: report.ignored_fields,
      ignored_keys: report.ignored_keys,
    },
    top_diff_fields: report.value_diff_fields_top_20 ?? [],
  };
}
