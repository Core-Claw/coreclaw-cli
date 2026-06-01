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
  stageVerifyProject,
} from '../src/commands/verify.js';

test('buildVerifyRunOptions defaults to a one-row upload preflight gate', () => {
  assert.deepEqual(buildVerifyRunOptions({ timeoutMs: '30s' }), {
    timeoutMs: '30s',
    python: 'python',
    node: 'node',
    go: 'go',
    minResults: '1',
    install: true,
  });
});

test('buildVerifyRunOptions preserves explicit runtime options', () => {
  assert.deepEqual(buildVerifyRunOptions({
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
    install: false,
  }), {
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
    install: false,
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

test('stageVerifyProject copies only uploadable files to a temporary project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-stage-source-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '');

  const staged = stageVerifyProject(dir);

  assert.equal(staged.staged, true);
  assert.notEqual(staged.projectDir, dir);
  assert.equal(path.dirname(staged.projectDir), path.join(dir, '.coreclaw', 'staging'));
  assert.deepEqual(staged.manifest.sort(), ['input_schema.json', 'main.js']);
  assert.equal(fs.existsSync(path.join(staged.projectDir, 'main.js')), true);
  assert.equal(fs.existsSync(path.join(staged.projectDir, '.coreclaw')), false);
  assert.equal(fs.existsSync(path.join(staged.projectDir, 'node_modules')), false);

  fs.rmSync(staged.projectDir, { recursive: true, force: true });
});

test('stageVerifyProject can be disabled for source-directory debugging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-no-stage-'));

  assert.deepEqual(stageVerifyProject(dir, { staging: false }), {
    projectDir: dir,
    staged: false,
    manifest: null,
  });
});
