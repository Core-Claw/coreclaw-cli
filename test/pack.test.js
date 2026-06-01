import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  assert.deepEqual(listZipEntries(outFile).sort(), ['input_schema.json', 'main.js']);
});

function listZipEntries(filePath) {
  const data = fs.readFileSync(filePath);
  const endOffset = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const names = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    names.push(data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

function findEndOfCentralDirectory(data) {
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('ZIP end of central directory not found');
}
