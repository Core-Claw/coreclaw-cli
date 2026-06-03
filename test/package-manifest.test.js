import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXAMPLE_WORKERS } from '../src/examples/catalog.js';

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
    'examples/node-http-proxy/main.js',
    'examples/node-http-proxy/package.json',
    'examples/node-http-proxy/input_schema.json',
    'examples/node-http-proxy/output_schema.json',
    'examples/node-lightpanda-cdp/main.js',
    'examples/node-lightpanda-cdp/package.json',
    'examples/node-lightpanda-cdp/input_schema.json',
    'examples/node-lightpanda-cdp/output_schema.json',
    'examples/python-hello/main.py',
    'examples/python-hello/requirements.txt',
    'tools/generate-command-docs.js',
    'docs/commands.md',
    'docs/roadmap.md',
    'CONTRIBUTING.md',
  ]) {
    assert.equal(files.has(required), true, `${required} should be published`);
  }

  assert.equal(files.has('examples'), false, 'publish example source files explicitly instead of the whole examples directory');
  assert.equal([...files].some((entry) => entry.includes('node_modules')), false);
  assert.equal([...files].some((entry) => entry.includes('.coreclaw')), false);
});

test('example catalog points at existing example worker directories', () => {
  const exampleDirs = fs.readdirSync(path.join(ROOT, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `examples/${entry.name}`)
    .sort();
  const catalogDirs = EXAMPLE_WORKERS.map((example) => example.path).sort();

  assert.deepEqual(catalogDirs, exampleDirs);
  for (const example of EXAMPLE_WORKERS) {
    assert.match(example.verify, new RegExp(escapeRegExp(example.path)));
    assert.equal(fs.existsSync(path.join(ROOT, example.path, 'README.md')), true);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
