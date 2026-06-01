import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareCommand } from '../src/commands/compare.js';
import { compareRows, resolveLocalRowsPath } from '../src/compare/rows.js';
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
});

test('compareRows supports explicit key fields', () => {
  const report = compareRows(
    [{ id: 'a', value: 1 }],
    [{ id: 'a', value: 2 }],
    { keyFields: 'id' },
  );

  assert.equal(report.shared_count, 1);
  assert.equal(report.value_diff_count, 1);
});

test('resolveLocalRowsPath accepts a run directory and prefers export.ndjson', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-compare-run-'));
  fs.writeFileSync(path.join(runDir, 'results.ndjson'), '{"value":{"raw":true}}\n');
  fs.writeFileSync(path.join(runDir, 'export.ndjson'), '{"value":{"projected":true}}\n');

  assert.equal(resolveLocalRowsPath(runDir), path.join(runDir, 'export.ndjson'));
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
