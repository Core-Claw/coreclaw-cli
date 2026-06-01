import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installCommandForProject, runProcess } from '../src/runtime/executor.js';

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
    assert.deepEqual(args, ['/d', '/s', '/c', 'npm', 'ci']);
  } else {
    assert.equal(command, 'npm');
    assert.deepEqual(args, ['ci']);
  }
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
