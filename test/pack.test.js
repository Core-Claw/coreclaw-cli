import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFiles, copyWorkerFiles, createWorkerZip } from '../src/pack/zip.js';
import { prepareUploadProject } from '../src/pack/upload-project.js';

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
  assert.deepEqual(listZipEntries(outFile).sort(), ['input_schema.json', 'main.js']);
});

test('createWorkerZip preserves executable file mode for upload binaries', () => {
  const archive = createZipWithExecutableEntry();
  const entry = listZipEntryDetails(archive).find((item) => item.name === 'main');

  assert.equal(entry.attributes >>> 16, 0o100755);
});

test('prepareUploadProject builds Go upload binary in a staging directory', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-go-source-'));
  fs.writeFileSync(path.join(source, 'main.go'), 'package main\nfunc main() {}\n');
  fs.writeFileSync(path.join(source, 'go.mod'), 'module test\n');
  fs.writeFileSync(path.join(source, 'go.sum'), '');
  fs.writeFileSync(path.join(source, 'input_schema.json'), '{}\n');
  fs.mkdirSync(path.join(source, '.coreclaw'));
  fs.writeFileSync(path.join(source, '.coreclaw', 'local.json'), '{}\n');

  const calls = [];
  const uploadProject = prepareUploadProject(
    { language: 'go', projectDir: source },
    {
      go: 'custom-go',
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        fs.writeFileSync(path.join(options.cwd, 'main'), 'linux-binary');
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  );

  try {
    assert.notEqual(uploadProject.projectDir, source);
    assert.equal(fs.existsSync(path.join(source, 'main')), false);
    assert.equal(fs.readFileSync(path.join(uploadProject.projectDir, 'main'), 'utf8'), 'linux-binary');
    assert.equal(fs.existsSync(path.join(uploadProject.projectDir, '.coreclaw')), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'custom-go');
    assert.deepEqual(calls[0].args, ['build', '-o', 'main', './main.go']);
    assert.equal(calls[0].options.env.CGO_ENABLED, '0');
    assert.equal(calls[0].options.env.GOOS, 'linux');
    assert.equal(calls[0].options.env.GOARCH, 'amd64');
  } finally {
    const stagedDir = uploadProject.projectDir;
    uploadProject.cleanup();
    assert.equal(fs.existsSync(stagedDir), false);
  }
});

test('copyWorkerFiles stages only uploadable worker files', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-stage-source-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-stage-target-'));
  fs.writeFileSync(path.join(source, 'main.js'), 'console.log("ok")\n');
  fs.writeFileSync(path.join(source, 'input_schema.json'), '{}\n');
  fs.mkdirSync(path.join(source, 'lib'));
  fs.writeFileSync(path.join(source, 'lib', 'helper.js'), 'module.exports = {}\n');
  fs.mkdirSync(path.join(source, '.coreclaw'));
  fs.writeFileSync(path.join(source, '.coreclaw', 'summary.json'), '{}\n');
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.writeFileSync(path.join(source, 'node_modules', 'dep.js'), '');
  fs.mkdirSync(path.join(source, 'dist'));
  fs.writeFileSync(path.join(source, 'dist', 'worker.zip'), '');

  const manifest = copyWorkerFiles(source, target);

  assert.deepEqual(manifest.sort(), ['input_schema.json', 'lib/helper.js', 'main.js']);
  assert.equal(fs.existsSync(path.join(target, 'main.js')), true);
  assert.equal(fs.existsSync(path.join(target, 'lib', 'helper.js')), true);
  assert.equal(fs.existsSync(path.join(target, '.coreclaw')), false);
  assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(target, 'dist')), false);
});

function listZipEntries(filePath) {
  const data = fs.readFileSync(filePath);
  return listZipEntryDetails(data).map((entry) => entry.name);
}

function createZipWithExecutableEntry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-executable-'));
  const binary = path.join(dir, 'main');
  fs.writeFileSync(binary, 'binary\n');
  fs.chmodSync(binary, 0o755);
  const outFile = path.join(dir, 'worker.zip');
  createWorkerZip({ projectDir: dir, outFile });
  return fs.readFileSync(outFile);
}

function listZipEntryDetails(data) {
  const endOffset = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    entries.push({
      name: data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      attributes: data.readUInt32LE(cursor + 38),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(data) {
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('ZIP end of central directory not found');
}
