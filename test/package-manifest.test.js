import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

test('npm package manifest includes examples without runtime artifacts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = new Set(manifest.files);

  for (const required of [
    'examples/coreclaw-audit-profile.json',
    'examples/node-hello-cloud-output.json',
    'examples/node-hello/main.js',
    'examples/node-hello/package.json',
    'examples/node-hello/input_schema.json',
    'examples/node-hello/output_schema.json',
    'examples/python-hello/main.py',
    'examples/python-hello/requirements.txt',
    'docs/roadmap.md',
    'CONTRIBUTING.md',
  ]) {
    assert.equal(files.has(required), true, `${required} should be published`);
  }

  assert.equal(files.has('examples'), false, 'publish example source files explicitly instead of the whole examples directory');
  assert.equal([...files].some((entry) => entry.includes('node_modules')), false);
  assert.equal([...files].some((entry) => entry.includes('.coreclaw')), false);
});
