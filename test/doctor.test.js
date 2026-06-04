import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildChecks, checkLocalChrome, doctorCommand, runToolCheck } from '../src/commands/doctor.js';
import { readCloudRows } from '../src/compare/rows.js';
import { CliError } from '../src/utils/errors.js';

test('checkLocalChrome reports discovered ChromeWs and ChromeHttp', async () => {
  const result = await checkLocalChrome({
    localChromeHost: '127.0.0.1:9333',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/browser-id',
        };
      },
    }),
  });

  assert.equal(result.discoveredLocalChrome, true);
  assert.equal(result.chromeWs, '127.0.0.1:9333/devtools/browser/browser-id');
  assert.equal(result.chromeHttp, '127.0.0.1:9333');
});

test('checkLocalChrome falls back to host-style browser variables', async () => {
  const result = await checkLocalChrome({
    localChromeHost: '127.0.0.1:9444',
    fetchImpl: async () => ({ ok: false }),
  });

  assert.equal(result.discoveredLocalChrome, false);
  assert.equal(result.chromeWs, '127.0.0.1:9444');
  assert.equal(result.chromeHttp, '127.0.0.1:9444');
});

test('buildChecks uses configured Python and Go commands', () => {
  const checks = buildChecks({
    python: 'py -3',
    go: 'go1.24',
  });

  assert.deepEqual(
    checks.map((check) => ({ label: check.label, command: check.command, args: check.args })),
    [
      { label: 'node', command: 'node', args: ['--version'] },
      {
        label: 'npm',
        command: process.platform === 'win32' ? 'cmd.exe' : 'npm',
        args: process.platform === 'win32' ? ['/c', 'npm.cmd', '--version'] : ['--version'],
      },
      { label: 'py -3', command: 'py', args: ['-3', '--version'] },
      { label: 'py -3 pip', command: 'py', args: ['-3', '-m', 'pip', '--version'] },
      { label: 'go1.24', command: 'go1.24', args: ['version'] },
    ],
  );
});

test('runToolCheck reports non-zero exits as missing tools', () => {
  const result = runToolCheck({
    command: process.execPath,
    args: ['-e', "console.error('missing pip'); process.exit(7)"],
  });

  assert.equal(result.ok, false);
  assert.match(result.output, /missing pip/);
});

test('doctorCommand strict mode rejects missing configured tools', async () => {
  await assert.rejects(
    () => withCapturedConsole(() => doctorCommand({
      strict: true,
      python: 'missing-python-for-coreclaw-test',
      fetchImpl: async () => ({ ok: false }),
    })),
    (error) => error instanceof CliError && /doctor --strict failed/.test(error.message),
  );
});

test('doctorCommand cloud mode checks account and public worker detail without starting a run by default', async () => {
  const calls = [];
  const output = await withCapturedConsole(() => doctorCommand({
    cloud: true,
    apiKey: 'test-key',
    scraperSlug: 'WORKER',
    fetchImpl: async (url) => {
      calls.push(url);
      const { pathname } = new URL(url);
      if (pathname === '/json/version') {
        return { ok: false };
      }
      if (pathname === '/api/v1/account/info') {
        return jsonResponse({ code: 0, message: 'success', data: { balance: '10.00', traffic: '1000' } });
      }
      if (pathname === '/api/scraper') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            version: 'v2.0.0',
            parameters: { custom: { properties: [{ name: 'urls', required: true }] } },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output, /CoreClaw cloud smoke/);
  assert.match(output, /\[ OK \] CoreClaw account/);
  assert.match(output, /\[ OK \] Worker detail: WORKER version=v2\.0\.0/);
  assert.match(output, /Cloud run: skipped/);
  assert.equal(calls.some((url) => new URL(url).pathname === '/api/v1/scraper/run'), false);
});

test('doctorCommand cloud mode can run, wait, save results, and collect evidence when input is explicit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-doctor-cloud-'));
  const inputPath = path.join(dir, 'cloud-input.json');
  const resultsPath = path.join(dir, 'cloud-results.json');
  const evidencePath = path.join(dir, 'run-evidence.json');
  fs.writeFileSync(inputPath, JSON.stringify({ parameters: { custom: { urls: ['https://example.com'] } } }));
  const detailStatuses = [2, 3];
  const collectCalls = [];

  const output = await withCapturedConsole(() => doctorCommand({
    cloud: true,
    apiKey: 'test-key',
    scraperSlug: 'WORKER',
    cloudInput: inputPath,
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    resultsOutput: resultsPath,
    runEvidenceOutput: evidencePath,
    sleepImpl: async () => {},
    collectImpl: async (positionals, collectOptions) => {
      collectCalls.push({ positionals, collectOptions });
      fs.writeFileSync(collectOptions.output, JSON.stringify({ run_slug: positionals[1] }));
      return { run_slug: positionals[1], files: { json: collectOptions.output } };
    },
    fetchImpl: async (url, request) => {
      const { pathname } = new URL(url);
      if (pathname === '/json/version') {
        return { ok: false };
      }
      if (pathname === '/api/v1/account/info') {
        return jsonResponse({ code: 0, message: 'success', data: { balance: '10.00', traffic: '1000' } });
      }
      if (pathname === '/api/scraper') {
        return jsonResponse({ code: 0, message: 'success', data: { version: 'v2.0.0', parameters: { custom: { properties: [] } } } });
      }
      if (pathname === '/api/v1/scraper/run') {
        assert.deepEqual(JSON.parse(request.body), {
          scraper_slug: 'WORKER',
          version: 'v2.0.0',
          input: { parameters: { custom: { urls: ['https://example.com'] } } },
          is_async: true,
        });
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUN123' } });
      }
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'RUN123', status: detailStatuses.shift(), results: 1 } });
      }
      if (pathname === '/api/v1/run/result/list') {
        assert.deepEqual(JSON.parse(request.body), { run_slug: 'RUN123', page_index: 1, page_size: 100 });
        return jsonResponse({ code: 0, message: 'success', data: { count: 1, list: [{ title: 'Cloud result' }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output, /CoreClaw cloud smoke/);
  assert.match(output, /Cloud run started: RUN123/);
  assert.match(output, /Cloud run finished: Succeeded/);
  assert.match(output, /Cloud results: .*cloud-results\.json/);
  assert.match(output, /Run evidence: .*run-evidence\.json/);
  assert.deepEqual(readCloudRows(resultsPath), [{ title: 'Cloud result' }]);
  assert.equal(collectCalls.length, 1);
  assert.deepEqual(collectCalls[0].positionals, ['collect', 'RUN123']);
  assert.equal(collectCalls[0].collectOptions.output, evidencePath);
});

async function withCapturedConsole(callback) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    await callback();
    return lines.join('\n');
  } finally {
    console.log = originalLog;
  }
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}
