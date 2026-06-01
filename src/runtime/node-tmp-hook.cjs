const fs = require('node:fs');
const path = require('node:path');

const runtimeTmp = process.env.CORECLAW_TMP_DIR;

if (runtimeTmp) {
  const originalFsPromisesMkdir = fs.promises.mkdir;
  const originalFsPromisesReadFile = fs.promises.readFile;
  const originalFsPromisesWriteFile = fs.promises.writeFile;
  const originalMkdirSync = fs.mkdirSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;

  fs.promises.mkdir = async function mkdir(filePath, ...args) {
    return originalFsPromisesMkdir.call(this, mapTmpPath(filePath), ...args);
  };
  fs.promises.readFile = async function readFile(filePath, ...args) {
    return originalFsPromisesReadFile.call(this, mapTmpPath(filePath), ...args);
  };
  fs.promises.writeFile = async function writeFile(filePath, ...args) {
    return originalFsPromisesWriteFile.call(this, mapTmpPath(filePath), ...args);
  };
  fs.mkdirSync = function mkdirSync(filePath, ...args) {
    return originalMkdirSync.call(this, mapTmpPath(filePath), ...args);
  };
  fs.readFileSync = function readFileSync(filePath, ...args) {
    return originalReadFileSync.call(this, mapTmpPath(filePath), ...args);
  };
  fs.writeFileSync = function writeFileSync(filePath, ...args) {
    return originalWriteFileSync.call(this, mapTmpPath(filePath), ...args);
  };
}

function mapTmpPath(filePath) {
  if (typeof filePath !== 'string') {
    return filePath;
  }

  const normalized = filePath.replace(/\\/g, '/');
  if (normalized === '/tmp') {
    return runtimeTmp;
  }
  if (!normalized.startsWith('/tmp/')) {
    return filePath;
  }

  return path.join(runtimeTmp, normalized.slice('/tmp/'.length));
}
