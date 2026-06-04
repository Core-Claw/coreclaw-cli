import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareCommand } from '../src/commands/compare.js';
import { assertCompareThresholds, compareRows, readCloudRows, readOutputSchema, resolveLocalRowsPath } from '../src/compare/rows.js';
import { CliError } from '../src/utils/errors.js';

test('compareRows reports shared, local-only, cloud-only, and changed rows', () => {
  const cloudRows = [
    { username: 'john', site: 'GitHub', urlUser: 'https://github.com/john', status: 'CLAIMED' },
    { username: 'john', site: 'X', urlUser: 'https://x.com/john', status: 'AVAILABLE' },
  ];
  const localRows = [
    { username: 'john', site: 'GitHub', urlUser: 'https://github.com/john', status: 'AVAILABLE' },
    { username: 'john', site: 'YouTube', urlUser: 'https://youtube.com/@john', status: 'CLAIMED' },
  ];

  const report = compareRows(cloudRows, localRows);

  assert.equal(report.cloud_count, 2);
  assert.equal(report.local_count, 2);
  assert.equal(report.shared_count, 1);
  assert.equal(report.only_cloud_count, 1);
  assert.equal(report.only_local_count, 1);
  assert.equal(report.value_diff_count, 1);
  assert.equal(report.cloud_duplicate_key_count, 0);
  assert.equal(report.local_duplicate_key_count, 0);
  assert.deepEqual(report.value_diff_first_20[0].changed_fields, ['status']);
  assert.deepEqual(report.value_diff_fields_top_20, [{ field: 'status', count: 1 }]);
  assert.equal(report.cloud_result_status_issue_count, 0);
  assert.equal(report.local_result_status_issue_count, 0);
  assert.equal(report.cloud_output_schema_issue_count, 0);
  assert.equal(report.local_output_schema_issue_count, 0);
});

test('compareRows supports explicit key fields', () => {
  const report = compareRows(
    [{ id: 'a', value: 1 }],
    [{ id: 'a', value: 2 }],
    { keyFields: 'id' },
  );

  assert.equal(report.shared_count, 1);
  assert.equal(report.value_diff_count, 1);
  assert.deepEqual(report.value_diff_first_20[0].changed_fields, ['value']);
});

test('compareRows reports nested changed field paths', () => {
  const report = compareRows(
    [{ id: 'a', meta: { status: 'ok', score: 1 }, tags: ['x'] }],
    [{ id: 'a', meta: { status: 'ok', score: 2 }, tags: ['x', 'y'] }],
    { keyFields: 'id' },
  );

  assert.equal(report.value_diff_count, 1);
  assert.deepEqual(report.value_diff_first_20[0].changed_fields, ['meta.score', 'tags']);
  assert.deepEqual(report.value_diff_fields_top_20, [
    { field: 'meta.score', count: 1 },
    { field: 'tags', count: 1 },
  ]);
});

test('compareRows can ignore noisy fields before value diffing', () => {
  const report = compareRows(
    [{ id: 'a', status: 'ok', completed_at: '2026-06-02T00:00:00Z', meta: { trace_id: 'cloud', score: 1 } }],
    [{ id: 'a', status: 'ok', completed_at: '2026-06-02T01:00:00Z', meta: { trace_id: 'local', score: 1 } }],
    { keyFields: 'id', ignoreFields: 'completed_at,meta.trace_id' },
  );

  assert.equal(report.value_diff_count, 0);
  assert.deepEqual(report.ignored_fields, ['completed_at', 'meta.trace_id']);
  assert.deepEqual(report.value_diff_fields_top_20, []);
});

test('compareRows can ignore profile-only comparison keys', () => {
  const report = compareRows(
    [
      { id: 'shared', status: 'ok' },
      { id: 'cloud-only-profile', status: 'ok' },
    ],
    [
      { id: 'shared', status: 'ok' },
      { id: 'local-only-profile', status: 'skipped' },
    ],
    { keyFields: 'id', ignoreKeys: 'cloud-only-profile,local-only-profile' },
  );

  assert.equal(report.cloud_count, 2);
  assert.equal(report.local_count, 2);
  assert.equal(report.ignored_cloud_row_count, 1);
  assert.equal(report.ignored_local_row_count, 1);
  assert.equal(report.shared_count, 1);
  assert.equal(report.only_cloud_count, 0);
  assert.equal(report.only_local_count, 0);
  assert.equal(report.value_diff_count, 0);
  assert.deepEqual(report.ignored_keys, ['cloud-only-profile', 'local-only-profile']);
});

test('compareRows keeps status gates on ignored comparison keys', () => {
  const report = compareRows(
    [
      { id: 'shared', status: 'ok' },
      { id: 'ignored-cloud', status: 'error' },
    ],
    [
      { id: 'shared', status: 'ok' },
      { id: 'ignored-local', status: 'fail' },
    ],
    { keyFields: 'id', ignoreKeys: 'ignored-cloud,ignored-local' },
  );

  assert.equal(report.only_cloud_count, 0);
  assert.equal(report.only_local_count, 0);
  assert.equal(report.cloud_result_status_issue_count, 1);
  assert.equal(report.local_result_status_issue_count, 1);
});

test('compareRows still reports non-ignored fields', () => {
  const report = compareRows(
    [{ id: 'a', status: 'ok', completed_at: 'cloud' }],
    [{ id: 'a', status: 'manual', completed_at: 'local' }],
    { keyFields: 'id', ignoreFields: 'completed_at' },
  );

  assert.equal(report.value_diff_count, 1);
  assert.deepEqual(report.value_diff_first_20[0].changed_fields, ['status']);
});

test('compareRows reports duplicate comparison keys', () => {
  const report = compareRows(
    [{ id: 'a', source: 'cloud-1' }, { id: 'a', source: 'cloud-2' }],
    [{ id: 'b', source: 'local-1' }, { id: 'b', source: 'local-2' }],
    { keyFields: 'id' },
  );

  assert.equal(report.cloud_duplicate_key_count, 1);
  assert.equal(report.local_duplicate_key_count, 1);
  assert.deepEqual(report.cloud_duplicate_keys_first_20, [{ key: 'a', count: 2 }]);
  assert.deepEqual(report.local_duplicate_keys_first_20, [{ key: 'b', count: 2 }]);
});

test('assertCompareThresholds includes useful diagnostics on failures', () => {
  const report = compareRows(
    [
      { contract_id: 'shared', status: 'ok' },
      { contract_id: 'cloud-only', status: 'ok' },
    ],
    [
      { contract_id: 'shared', status: 'ok' },
      { contract_id: 'local-fail', status: 'fail' },
    ],
    { keyFields: 'contract_id' },
  );

  assert.throws(
    () => assertCompareThresholds(report, { minShared: '2', requireStatusOk: true }),
    (error) => error instanceof CliError
      && /shared_count=1/.test(error.message)
      && /only_cloud=cloud-only/.test(error.message)
      && /only_local=local-fail/.test(error.message)
      && /local_status=local-fail:status=fail/.test(error.message),
  );
});

test('resolveLocalRowsPath accepts a run directory and prefers export.ndjson', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-run-'));
  fs.writeFileSync(path.join(runDir, 'results.ndjson'), '{"value":{"raw":true}}\n');
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), '{"value":{"projected":true}}\n');

  assert.equal(resolveLocalRowsPath(runDir), path.join(runDir, 'export.ndjson'));
});

test('readCloudRows accepts UTF-8 BOM cloud exports generated on Windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-bom-'));
  const cloudPath = path.join(dir, 'cloud.json');
  fs.writeFileSync(cloudPath, '\ufeff[{"url":"https://example.com"}]\n', 'utf8');

  assert.deepEqual(readCloudRows(cloudPath), [{ url: 'https://example.com' }]);
});

test('readCloudRows accepts CoreClaw result-list response wrappers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-wrapped-cloud-'));
  const listPath = path.join(dir, 'result-list.json');
  const rowsPath = path.join(dir, 'result-rows.json');
  fs.writeFileSync(listPath, JSON.stringify({
    code: 0,
    message: 'success',
    data: {
      count: 1,
      headers: [{ label: 'status', key: 'status', format: 'text' }],
      list: [{ contract_id: 'list-row', status: 'ok' }],
    },
  }));
  fs.writeFileSync(rowsPath, JSON.stringify({
    rows: [{ contract_id: 'rows-row', status: 'ok' }],
  }));

  assert.deepEqual(readCloudRows(listPath), [{ contract_id: 'list-row', status: 'ok' }]);
  assert.deepEqual(readCloudRows(rowsPath), [{ contract_id: 'rows-row', status: 'ok' }]);
});

test('readCloudRows explains export download-url responses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-export-url-'));
  const cloudPath = path.join(dir, 'export-response.json');
  fs.writeFileSync(cloudPath, JSON.stringify({
    code: 0,
    message: 'success',
    data: {
      download_url: 'https://example.com/export.json',
    },
  }));

  assert.throws(
    () => readCloudRows(cloudPath),
    (error) => error instanceof CliError
      && /contains only an export download_url/.test(error.message)
      && /Download the JSON export file first/.test(error.message),
  );
});

test('readCloudRows accepts CoreClaw CSV export files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-csv-cloud-'));
  const cloudPath = path.join(dir, 'cloud.csv');
  fs.writeFileSync(cloudPath, [
    'contract_id,status,observed',
    'shared,ok,"value, with comma"',
    'quoted,ok,"double ""quote"""',
    '',
  ].join('\n'));

  assert.deepEqual(readCloudRows(cloudPath), [
    { contract_id: 'shared', status: 'ok', observed: 'value, with comma' },
    { contract_id: 'quoted', status: 'ok', observed: 'double "quote"' },
  ]);
});

test('readCloudRows rejects malformed CSV exports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-csv-bad-'));
  const cloudPath = path.join(dir, 'cloud.csv');
  fs.writeFileSync(cloudPath, 'id,status\na,ok,extra\n');

  assert.throws(
    () => readCloudRows(cloudPath),
    (error) => error instanceof CliError && /row 2 has 3 column/.test(error.message),
  );
});

test('readOutputSchema requires a JSON array', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-schema-invalid-'));
  const schemaPath = path.join(dir, 'output_schema.json');
  fs.writeFileSync(schemaPath, '{"name":"status"}\n', 'utf8');

  assert.throws(
    () => readOutputSchema(schemaPath),
    (error) => error instanceof CliError && /Output schema must be a JSON array/.test(error.message),
  );
});

test('compareCommand writes reports and enforces thresholds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-command-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  const reportPath = path.join(dir, 'report.json');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { username: 'john', site: 'GitHub', urlUser: 'https://github.com/john', status: 'CLAIMED' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), `${JSON.stringify({
    value: { username: 'john', site: 'GitHub', urlUser: 'https://github.com/john', status: 'CLAIMED' },
  })}\n`);

  const report = await compareCommand(cloudPath, runDir, { output: reportPath, minShared: '1', maxDiff: '0' });

  assert.equal(report.shared_count, 1);
  assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).shared_count, 1);
  await assert.rejects(
    () => compareCommand(cloudPath, runDir, { minShared: '2' }),
    (error) => error instanceof CliError && /expected at least 2/.test(error.message),
  );
});

test('compareCommand can print a stable JSON summary for CI and dashboards', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-json-summary-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { id: 'shared', status: 'ok', value: 2 },
    { id: 'cloud-only', status: 'ok', value: 3 },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), [
    JSON.stringify({ value: { id: 'shared', status: 'ok', value: 1 } }),
    JSON.stringify({ value: { id: 'local-only', status: 'ok', value: 4 } }),
    '',
  ].join('\n'));

  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    const report = await compareCommand(cloudPath, runDir, {
      keyFields: 'id',
      jsonSummary: true,
    });

    assert.equal(report.summary_schema_version, 1);
    assert.equal(report.summary.ok, false);
    assert.equal(report.summary.exit_code_hint, 1);
    assert.equal(report.summary.counts.shared, 1);
    assert.equal(report.summary.counts.only_cloud, 1);
    assert.equal(report.summary.counts.only_local, 1);
    assert.equal(report.summary.counts.value_diffs, 1);
    assert.deepEqual(report.summary.top_diff_fields, [{ field: 'value', count: 1 }]);
    assert.equal(lines.length, 1);
    const printed = JSON.parse(lines[0]);
    assert.equal(printed.schema_version, 1);
    assert.equal(printed.ok, false);
    assert.equal(printed.counts.cloud_rows, 2);
    assert.equal(printed.counts.local_rows, 2);
    assert.equal(printed.paths.cloud, cloudPath);
    assert.equal(printed.paths.local, path.join(runDir, 'export.ndjson'));
  } finally {
    console.log = originalLog;
  }
});

test('compareCommand can compare a CSV cloud export', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-command-csv-'));
  const cloudPath = path.join(dir, 'cloud.csv');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, 'contract_id,status\nshared,ok\n');
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), `${JSON.stringify({
    value: { contract_id: 'shared', status: 'ok' },
  })}\n`);

  const report = await compareCommand(cloudPath, runDir, {
    keyFields: 'contract_id',
    minShared: '1',
    maxDiff: '0',
  });

  assert.equal(report.cloud_count, 1);
  assert.equal(report.shared_count, 1);
  assert.equal(report.value_diff_count, 0);
});

test('compareCommand can fail on cloud or local result status rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-status-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { check_name: 'cloud', status: 'error' },
    { check_name: 'manual', check_status: 'manual' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), `${JSON.stringify({
    value: { check_name: 'local', status: 'ok' },
  })}\n`);

  const report = await compareCommand(cloudPath, runDir, { keyFields: 'check_name' });
  assert.equal(report.cloud_result_status_issue_count, 1);
  assert.equal(report.local_result_status_issue_count, 0);
  await assert.rejects(
    () => compareCommand(cloudPath, runDir, { requireStatusOk: true, keyFields: 'check_name' }),
    (error) => error instanceof CliError && /failing result status row/.test(error.message),
  );
  await assert.rejects(
    () => compareCommand(cloudPath, runDir, {
      requireStatusOk: true,
      resultStatusFields: 'check_status',
      resultFailValues: 'manual',
      keyFields: 'check_name',
    }),
    (error) => error instanceof CliError && /failing result status row/.test(error.message),
  );
});

test('compareCommand can enforce cloud and local output_schema shape', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-schema-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const schemaPath = path.join(dir, 'output_schema.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(schemaPath, JSON.stringify([
    { name: 'status', type: 'string' },
    { name: 'count', type: 'integer' },
  ]));
  fs.writeFileSync(cloudPath, JSON.stringify([
    { status: 'ok', count: '1', extra: true },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), `${JSON.stringify({
    value: { status: 'ok', count: 1 },
  })}\n`);

  const report = await compareCommand(cloudPath, runDir, { outputSchema: schemaPath });
  assert.equal(report.cloud_output_schema_issue_count, 2);
  assert.equal(report.local_output_schema_issue_count, 0);
  await assert.rejects(
    () => compareCommand(cloudPath, runDir, { outputSchema: schemaPath, requireOutputSchemaMatch: true }),
    (error) => error instanceof CliError && /output_schema mismatch/.test(error.message),
  );
});

test('compareCommand can require unique comparison keys', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-unique-keys-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { id: 'a', status: 'ok' },
    { id: 'a', status: 'ok' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), `${JSON.stringify({
    value: { id: 'a', status: 'ok' },
  })}\n`);

  const report = await compareCommand(cloudPath, runDir, { keyFields: 'id' });
  assert.equal(report.cloud_duplicate_key_count, 1);
  await assert.rejects(
    () => compareCommand(cloudPath, runDir, { keyFields: 'id', requireUniqueKeys: true }),
    (error) => error instanceof CliError && /duplicate key/.test(error.message),
  );
});

test('compareCommand can ignore known profile-only keys for only-row gates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-ignore-keys-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { id: 'shared', status: 'ok' },
    { id: 'cloud-only-profile', status: 'ok' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), [
    JSON.stringify({ value: { id: 'shared', status: 'ok' } }),
    JSON.stringify({ value: { id: 'local-only-profile', status: 'skipped' } }),
    '',
  ].join('\n'));

  const report = await compareCommand(cloudPath, runDir, {
    keyFields: 'id',
    ignoreKeys: 'cloud-only-profile,local-only-profile',
    maxOnlyCloud: '0',
    maxOnlyLocal: '0',
  });

  assert.equal(report.shared_count, 1);
  assert.equal(report.only_cloud_count, 0);
  assert.equal(report.only_local_count, 0);
  assert.equal(report.ignored_cloud_row_count, 1);
  assert.equal(report.ignored_local_row_count, 1);
});

test('compareCommand can read ignore keys from JSON and text files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-ignore-keys-file-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const runDir = path.join(dir, 'run');
  const arrayFile = path.join(dir, 'ignore-keys.json');
  const objectFile = path.join(dir, 'ignore-keys-object.json');
  const textFile = path.join(dir, 'ignore-keys.txt');
  fs.mkdirSync(runDir);
  fs.writeFileSync(cloudPath, JSON.stringify([
    { id: 'shared', status: 'ok' },
    { id: 'cloud-array', status: 'ok' },
    { id: 'cloud-object', status: 'ok' },
    { id: 'cloud-inline', status: 'ok' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), [
    JSON.stringify({ value: { id: 'shared', status: 'ok' } }),
    JSON.stringify({ value: { id: 'local-array', status: 'skipped' } }),
    JSON.stringify({ value: { id: 'local-object', status: 'skipped' } }),
    JSON.stringify({ value: { id: 'local-text', status: 'skipped' } }),
    JSON.stringify({ value: { id: 'local-inline', status: 'skipped' } }),
    '',
  ].join('\n'));
  fs.writeFileSync(arrayFile, JSON.stringify(['cloud-array', 'local-array']));
  fs.writeFileSync(objectFile, JSON.stringify({ ignore_keys: ['cloud-object', 'local-object'] }));
  fs.writeFileSync(textFile, '# comment\nlocal-text\n');

  const arrayReport = await compareCommand(cloudPath, runDir, {
    keyFields: 'id',
    ignoreKeysFile: arrayFile,
  });
  assert.deepEqual(arrayReport.ignored_keys, ['cloud-array', 'local-array']);
  assert.equal(arrayReport.ignored_cloud_row_count, 1);
  assert.equal(arrayReport.ignored_local_row_count, 1);
  assert.equal(arrayReport.ignore_keys_file_path, arrayFile);

  const objectReport = await compareCommand(cloudPath, runDir, {
    keyFields: 'id',
    ignoreKeysFile: objectFile,
  });
  assert.deepEqual(objectReport.ignored_keys, ['cloud-object', 'local-object']);

  const textReport = await compareCommand(cloudPath, runDir, {
    keyFields: 'id',
    ignoreKeys: 'cloud-inline,local-inline,cloud-inline',
    ignoreKeysFile: textFile,
  });
  assert.deepEqual(textReport.ignored_keys, ['cloud-inline', 'local-inline', 'local-text']);
  assert.equal(textReport.ignored_cloud_row_count, 1);
  assert.equal(textReport.ignored_local_row_count, 2);
});

test('compareCommand can apply a reusable compare profile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-profile-'));
  const cloudPath = path.join(dir, 'cloud.json');
  const schemaPath = path.join(dir, 'output_schema.json');
  const profileDir = path.join(dir, '.coreclaw', 'profiles');
  const profilePath = path.join(profileDir, 'compare-profile.json');
  const reportPath = path.join(profileDir, 'reports', 'report.json');
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(runDir);
  fs.writeFileSync(schemaPath, JSON.stringify([
    { name: 'id', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'completed_at', type: 'string' },
  ]));
  fs.writeFileSync(cloudPath, JSON.stringify([
    { id: 'shared', status: 'ok', completed_at: 'cloud' },
    { id: 'cloud-profile', status: 'ok', completed_at: 'cloud' },
    { id: 'cloud-inline', status: 'ok', completed_at: 'cloud' },
  ]));
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), [
    JSON.stringify({ value: { id: 'shared', status: 'ok', completed_at: 'local' } }),
    JSON.stringify({ value: { id: 'local-profile', status: 'skipped', completed_at: 'local' } }),
    JSON.stringify({ value: { id: 'local-inline', status: 'skipped', completed_at: 'local' } }),
    '',
  ].join('\n'));
  fs.writeFileSync(profilePath, JSON.stringify({
    key_fields: ['id'],
    ignore_fields: ['completed_at'],
    ignore_keys: ['cloud-profile', 'local-profile'],
    min_shared: 1,
    max_diff: 0,
    max_only_cloud: 0,
    max_only_local: 0,
    require_unique_keys: true,
    require_status_ok: true,
    output_schema: '../../output_schema.json',
    require_output_schema_match: true,
    output: 'reports/report.json',
  }));

  const report = await compareCommand(cloudPath, runDir, {
    compareProfile: profilePath,
    ignoreKeys: 'cloud-inline,local-inline',
  });

  assert.equal(report.compare_profile_path, profilePath);
  assert.equal(report.output_schema_path, schemaPath);
  assert.deepEqual(report.key_fields, ['id']);
  assert.deepEqual(report.ignored_fields, ['completed_at']);
  assert.deepEqual(report.ignored_keys, ['cloud-profile', 'local-profile', 'cloud-inline', 'local-inline']);
  assert.equal(report.shared_count, 1);
  assert.equal(report.only_cloud_count, 0);
  assert.equal(report.only_local_count, 0);
  assert.equal(report.value_diff_count, 0);
  assert.equal(report.cloud_output_schema_issue_count, 0);
  assert.equal(report.local_output_schema_issue_count, 0);
  assert.equal(JSON.parse(fs.readFileSync(reportPath, 'utf8')).compare_profile_path, profilePath);
});
