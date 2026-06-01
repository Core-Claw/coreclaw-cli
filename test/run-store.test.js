import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore, validateOutputSchemaRow } from '../src/runtime/run-store.js';

test('validateOutputSchemaRow reports missing, extra, and non-object results', () => {
  const outputSchema = [
    { name: 'title', type: 'string' },
    { name: 'url', type: 'string' },
  ];

  assert.deepEqual(
    validateOutputSchemaRow(outputSchema, { title: 'Example', extra: true }, 1).map((issue) => issue.code),
    ['result_missing_output_schema_field', 'result_field_not_in_output_schema'],
  );
  assert.deepEqual(
    validateOutputSchemaRow(outputSchema, ['not', 'an', 'object'], 2).map((issue) => issue.code),
    ['result_row_not_object'],
  );
});

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

test('RunStore records output_schema drift issues for pushed rows', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-run-store-schema-'));
  const store = new RunStore({
    projectDir,
    runId: 'run-id',
    input: {},
    env: {},
    command: { command: 'node', args: ['main.js'], cwd: projectDir },
    outputSchema: [
      { name: 'title', type: 'string' },
      { name: 'url', type: 'string' },
    ],
  });

  store.init();
  store.recordResult(JSON.stringify({ title: 'Example', extra: true }));

  const issuesPath = path.join(projectDir, '.coreclaw', 'runs', 'run-id', 'output_schema_issues.json');
  const issues = JSON.parse(fs.readFileSync(issuesPath, 'utf8'));
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.code), [
    'result_missing_output_schema_field',
    'result_field_not_in_output_schema',
  ]);
  assert.equal(store.summary().output_schema_issue_count, 2);
  assert.equal(store.summary().output_schema_issues_path, issuesPath);
});
