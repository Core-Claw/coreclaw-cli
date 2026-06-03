import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChecks, checkLocalChrome, doctorCommand, runToolCheck } from '../src/commands/doctor.js';
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

async function withCapturedConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}
