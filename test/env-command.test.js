import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envCommand } from '../src/commands/env.js';

test('envCommand reports masked CoreClaw runtime variables without running a worker', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-env-command-'));
  const output = await captureConsole(() => envCommand(projectDir, {
    cloudProxy: true,
    proxyAuth: 'user:secret',
    proxyDomain: 'proxy.example:6000',
    chromeWs: 'browser.example:9222/devtools/browser/test',
    lightpandaDomain: 'lightpanda-inner.coreclaw.com',
    discoverChrome: false,
  }));

  const report = output.result;
  assert.equal(report.project_dir, projectDir);
  assert.equal(report.env.PROXY_AUTH, 'user:***');
  assert.equal(report.env.PROXY_DOMAIN, 'proxy.example:6000');
  assert.equal(report.env.ChromeWs, 'browser.example:9222/devtools/browser/test');
  assert.equal(report.env.ChromeHttp, 'browser.example:9222');
  assert.equal(report.env.LightpandaDomain, 'lightpanda-inner.coreclaw.com');
  assert.equal(report.browser_endpoints.lightpanda_cdp_endpoint, 'ws://lightpanda-inner.coreclaw.com/devtools/browser/new');
  assert.equal(report.notes.some((note) => note.includes('does not start local proxy')), true);
  assert.match(output.stdout, /CoreClaw runtime environment/);
  assert.match(output.stdout, /PROXY_AUTH=user:\*\*\*/);
  assert.doesNotMatch(output.stdout, /secret/);
});

test('envCommand json-output prints a single structured report on stdout', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-env-command-json-'));
  const output = await captureConsole(() => envCommand(projectDir, {
    jsonOutput: true,
    cloudProxy: true,
    discoverChrome: false,
  }));
  const report = JSON.parse(output.stdout);

  assert.equal(report.project_dir, projectDir);
  assert.equal(report.env.PROXY_AUTH, 'coreclaw-local:***');
  assert.equal(report.env.PROXY_DOMAIN, '127.0.0.1:6000');
  assert.equal(output.stderr.trim(), '');
  assert.deepEqual(output.result, report);
});

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const stdout = [];
  const stderr = [];
  let result;
  console.log = (...args) => stdout.push(args.join(' '));
  console.error = (...args) => stderr.push(args.join(' '));
  console.warn = (...args) => stderr.push(args.join(' '));
  try {
    result = await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  return {
    result,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}
