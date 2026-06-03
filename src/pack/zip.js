import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { toPosixPath } from '../utils/paths.js';

const EXCLUDED_DIRS = new Set([
  '.git',
  '.coreclaw',
  '.coreclaw-python-venv',
  'node_modules',
  '__pycache__',
  '__tests__',
  '.pytest_cache',
  '.venv',
  'venv',
  'coverage',
  'dist',
  'build',
  'tests',
]);

const EXCLUDED_EXTENSIONS = new Set(['.pyc', '.pyo', '.log']);

export function createWorkerZip({ projectDir, outFile }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (fs.existsSync(outFile)) {
    fs.rmSync(outFile, { force: true });
  }

  const manifest = collectFiles(projectDir);
  const zip = buildZipArchive(manifest.map((relative) => {
    const filePath = path.join(projectDir, relative);
    return {
      name: relative,
      data: fs.readFileSync(filePath),
      mode: uploadFileMode(relative, fs.statSync(filePath).mode),
    };
  }));
  fs.writeFileSync(outFile, zip);
  return outFile;
}

export function copyWorkerFiles(projectDir, targetDir) {
  const manifest = collectFiles(projectDir);
  for (const relative of manifest) {
    const source = path.join(projectDir, relative);
    const target = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  return manifest;
}

export function previewUploadFiles(projectDir) {
  return collectFiles(projectDir);
}

export function buildZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(toPosixPath(entry.name), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(fileAttributes(entry), 38);
    centralHeader.writeUInt32LE(offset, 42);

    const localRecord = Buffer.concat([localHeader, name, compressed]);
    localParts.push(localRecord);
    centralParts.push(Buffer.concat([centralHeader, name]));
    offset += localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function fileAttributes(entry) {
  const mode = Number.isInteger(entry.mode) ? entry.mode : 0o100644;
  return ((mode & 0xffff) << 16) >>> 0;
}

function uploadFileMode(relative, mode) {
  if (toPosixPath(relative) === 'main') {
    return (mode & ~0o777) | 0o755;
  }
  return mode;
}

export function collectFiles(rootDir, currentDir = rootDir) {
  const files = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relative = path.relative(rootDir, fullPath);
    if (shouldExclude(entry, fullPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, fullPath));
    } else if (entry.isFile()) {
      files.push(toPosixPath(relative));
    }
  }

  return files;
}

function shouldExclude(entry, fullPath) {
  if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
    return true;
  }

  if (entry.isFile() && EXCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
    return true;
  }

  return false;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_item, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
