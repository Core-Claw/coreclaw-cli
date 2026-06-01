import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLocalChrome } from '../src/commands/doctor.js';

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
