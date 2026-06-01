import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectFiles, createWorkerZip } from '../src/pack/zip.js';

test('collectFiles excludes cloud-irrelevant local artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');

  assert.deepEqual(collectFiles(dir).sort(), ['input_schema.json', 'main.js']);
});

test('createWorkerZip creates a portable archive with only worker files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-zip-'));
  fs.writeFileSync(path.join(dir, 'main.js'), 'console.log("ok")\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}\n');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}\n');

  const outFile = path.join(dir, 'dist', 'worker.zip');
  createWorkerZip({ projectDir: dir, outFile });

  assert.equal(fs.existsSync(outFile), true);
  const listing = spawnSync('tar', ['-tf', outFile], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.deepEqual(
    listing.stdout.trim().split(/\r?\n/).sort(),
    ['input_schema.json', 'main.js'],
  );
});
