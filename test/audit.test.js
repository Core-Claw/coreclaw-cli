import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverWorkerDirs } from '../src/commands/audit.js';

test('discoverWorkerDirs finds product worker roots and skips ignored directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-'));
  const worker = path.join(root, 'worker-one');
  const nested = path.join(root, 'group', 'worker-two');
  const sourceLike = path.join(root, 'library', 'src');
  const ignored = path.join(root, 'node_modules', 'worker-three');
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(sourceLike, { recursive: true });
  fs.mkdirSync(ignored, { recursive: true });
  fs.writeFileSync(path.join(worker, 'main.js'), '');
  fs.writeFileSync(path.join(nested, 'main.py'), '');
  fs.writeFileSync(path.join(sourceLike, 'main.js'), '');
  fs.writeFileSync(path.join(ignored, 'main.js'), '');

  assert.deepEqual(
    discoverWorkerDirs(root).map((dir) => path.basename(dir)).sort(),
    ['worker-one', 'worker-two'],
  );
});

test('discoverWorkerDirs all mode includes non-product worker-like roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-all-'));
  const worker = path.join(root, 'worker-one');
  const example = path.join(root, 'examples', 'node-hello');
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(example, { recursive: true });
  fs.writeFileSync(path.join(worker, 'main.js'), '');
  fs.writeFileSync(path.join(example, 'main.js'), '');

  assert.deepEqual(
    discoverWorkerDirs(root, { all: true }).map((dir) => path.basename(dir)).sort(),
    ['node-hello', 'worker-one'],
  );
});
