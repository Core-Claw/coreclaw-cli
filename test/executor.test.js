import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandForProject, installCommandForProject, runProcess } from '../src/runtime/executor.js';

test('runProcess kills a process after idle timeout', async () => {
  const logs = [];
  const store = {
    recordLog(level, message, source) {
      logs.push({ level, message, source });
    },
  };

  const result = await runProcess({
    command: process.execPath,
    args: ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    env: process.env,
    store,
    label: 'fixture',
    idleTimeoutMs: 500,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.idleTimedOut, true);
  assert.equal(logs.some((row) => row.message.includes('idle timeout')), true);
});

test('installCommandForProject uses Windows npm launcher when needed', () => {
  const [command, args] = installCommandForProject({
    language: 'node',
    projectDir: process.cwd(),
  });

  if (process.platform === 'win32') {
    assert.match(command, /cmd\.exe$/i);
    assert.deepEqual(args, ['/d', '/s', '/c', 'npm', 'ci', '--omit=dev']);
  } else {
    assert.equal(command, 'npm');
    assert.deepEqual(args, ['ci', '--omit=dev']);
  }
});

test('installCommandForProject omits Node devDependencies without a package lock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-node-install-'));
  const [command, args] = installCommandForProject({
    language: 'node',
    projectDir: dir,
  });

  if (process.platform === 'win32') {
    assert.match(command, /cmd\.exe$/i);
    assert.deepEqual(args, ['/d', '/s', '/c', 'npm', 'install', '--omit=dev']);
  } else {
    assert.equal(command, 'npm');
    assert.deepEqual(args, ['install', '--omit=dev']);
  }
});

test('Python command and install use the configured interpreter command', () => {
  assert.deepEqual(
    commandForProject({ language: 'python', projectDir: process.cwd() }, { python: 'py -3' }),
    ['py', ['-3', 'main.py']],
  );
  assert.deepEqual(
    installCommandForProject({ language: 'python', projectDir: process.cwd() }, { python: 'py -3' }),
    ['py', ['-3', '-m', 'pip', 'install', '-r', 'requirements.txt']],
  );
});

test('Go install uses the configured Go command', () => {
  assert.deepEqual(
    installCommandForProject({ language: 'go', projectDir: process.cwd() }, { go: 'go1.24' }),
    ['go1.24', ['mod', 'download']],
  );
});

test('commandForProject runs a staged Go upload binary when root main exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-go-executor-'));
  const binary = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
  fs.writeFileSync(binary, 'binary');

  const [command, args] = commandForProject({ language: 'go', projectDir: dir }, { go: 'custom-go' });

  assert.equal(command, binary);
  assert.deepEqual(args, []);
});

test('commandForProject falls back to go run for source-directory Go development runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-go-source-executor-'));

  const [command, args] = commandForProject({ language: 'go', projectDir: dir }, { go: 'custom-go' });

  assert.equal(command, 'custom-go');
  assert.deepEqual(args, ['run', '.']);
});

test('node tmp hook maps absolute /tmp paths into the run temp directory', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tmp-hook-'));
  const runtimeTmp = path.join(tmpRoot, 'runtime-tmp');
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const hostTmpPath = path.resolve('/tmp/coreclaw-hook-test/value.txt');
  fs.rmSync(path.dirname(hostTmpPath), { recursive: true, force: true });

  const result = await runProcess({
    command: process.execPath,
    args: [
      '-r',
      path.resolve('src/runtime/node-tmp-hook.cjs'),
      '-e',
      "const fs=require('fs').promises; (async()=>{ await fs.mkdir('/tmp/coreclaw-hook-test', {recursive:true}); await fs.writeFile('/tmp/coreclaw-hook-test/value.txt','ok'); })().catch((error)=>{ console.error(error); process.exit(1); });",
    ],
    cwd: process.cwd(),
    env: { ...process.env, CORECLAW_TMP_DIR: runtimeTmp },
    label: 'tmp-hook',
  });

  assert.equal(result.exitCode, 0);
  assert.equal(fs.existsSync(hostTmpPath), false);
  assert.equal(fs.readFileSync(path.join(runtimeTmp, 'coreclaw-hook-test', 'value.txt'), 'utf8'), 'ok');
});

test('node tmp hook does not remap worker files under /tmp', { skip: process.platform === 'win32' }, async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tmp-hook-worker-'));
  const runtimeTmp = path.join(tmpRoot, 'runtime-tmp');
  const workerDir = `/tmp/coreclaw-hook-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workerFile = `${workerDir}/main.js`;
  fs.mkdirSync(runtimeTmp, { recursive: true });
  fs.rmSync(workerDir, { recursive: true, force: true });
  fs.mkdirSync(workerDir, { recursive: true });
  fs.writeFileSync(workerFile, 'module.exports = "ok";\n');

  const result = await runProcess({
    command: process.execPath,
    args: [
      '-r',
      path.resolve('src/runtime/node-tmp-hook.cjs'),
      '-e',
      `require(${JSON.stringify(workerFile)});`,
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CORECLAW_TMP_DIR: runtimeTmp,
      CORECLAW_WORKER_DIR: workerDir,
    },
    label: 'tmp-hook-worker',
  });

  assert.equal(result.exitCode, 0);
  assert.equal(fs.existsSync(path.join(runtimeTmp, path.basename(workerDir), 'main.js')), false);
  fs.rmSync(workerDir, { recursive: true, force: true });
});
