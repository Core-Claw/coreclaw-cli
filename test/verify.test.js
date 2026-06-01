import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildVerifyCompareOptions,
  buildVerifyRunOptions,
  resolveVerifyCompareOutput,
  resolveVerifyOutput,
} from '../src/commands/verify.js';

test('buildVerifyRunOptions defaults to a one-row upload preflight gate', () => {
  assert.deepEqual(buildVerifyRunOptions({ timeoutMs: '30s' }), {
    timeoutMs: '30s',
    python: 'python',
    node: 'node',
    go: 'go',
    minResults: '1',
  });
});

test('buildVerifyRunOptions preserves explicit runtime options', () => {
  assert.deepEqual(buildVerifyRunOptions({
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
  }), {
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
    node: 'node',
    go: 'go',
  });
});

test('resolveVerifyOutput writes packages under .coreclaw/verify by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-output-'));
  const outFile = resolveVerifyOutput(dir);
  const parts = path.relative(dir, outFile).split(path.sep);

  assert.equal(path.basename(outFile), `${path.basename(dir)}.zip`);
  assert.equal(parts[0], '.coreclaw');
  assert.equal(parts[1], 'verify');
  assert.equal(fs.existsSync(path.dirname(outFile)), true);
});

test('resolveVerifyOutput respects explicit output path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-output-explicit-'));
  const outFile = resolveVerifyOutput(dir, { output: path.join(dir, 'dist', 'worker.zip') });

  assert.equal(outFile, path.join(dir, 'dist', 'worker.zip'));
});

test('buildVerifyCompareOptions passes cloud parity gates to compare', () => {
  assert.deepEqual(
    buildVerifyCompareOptions({
      keyFields: 'username,site,urlUser',
      minShared: '1',
      maxDiff: '0',
      maxOnlyLocal: '2',
      maxOnlyCloud: '3',
    }, 'report.json'),
    {
      keyFields: 'username,site,urlUser',
      minShared: '1',
      maxDiff: '0',
      maxOnlyLocal: '2',
      maxOnlyCloud: '3',
      output: 'report.json',
    },
  );
});

test('resolveVerifyCompareOutput defaults to the local run directory', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-'));

  assert.equal(resolveVerifyCompareOutput(runDir), path.join(runDir, 'cloud-comparison.json'));
});

test('resolveVerifyCompareOutput respects explicit compare report path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-explicit-'));
  const reportPath = path.join(dir, 'reports', 'compare.json');

  assert.equal(resolveVerifyCompareOutput(path.join(dir, 'run'), { compareOutput: reportPath }), reportPath);
});
