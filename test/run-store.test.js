import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from '../src/runtime/run-store.js';

test('RunStore writes upload manifests for staged preflight runs', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-run-store-project-'));
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-run-store-worker-'));
  const manifest = ['input_schema.json', 'main.js'];
  const store = new RunStore({
    projectDir: workerDir,
    artifactProjectDir: projectDir,
    runId: 'run-id',
    input: {},
    env: {},
    command: { command: 'node', args: ['main.js'], cwd: workerDir },
    uploadManifest: manifest,
  });

  store.init();

  const manifestPath = path.join(projectDir, '.coreclaw', 'runs', 'run-id', 'upload_manifest.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifest);
  assert.equal(store.summary().project_dir, projectDir);
  assert.equal(store.summary().worker_dir, workerDir);
  assert.equal(store.summary().upload_manifest_path, manifestPath);
});
