import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeEnv, publicEnvSnapshot, resolveBrowserEndpoints } from '../src/runtime/env.js';

test('buildRuntimeEnv defaults to local direct network without proxy variables', () => {
  const env = buildRuntimeEnv({
    baseEnv: {
      PROXY_AUTH: 'cloud-user:cloud-pass',
      PROXY_DOMAIN: 'cloud-proxy:6000',
      ChromeWs: 'cloud-browser:9222',
      ChromeHttp: 'cloud-http:9515',
      CDP_ENDPOINT: 'ws://stale-cdp',
      BROWSER_WS_ENDPOINT: 'ws://stale-browser',
    },
  });

  assert.equal(env.PROXY_AUTH, undefined);
  assert.equal(env.PROXY_DOMAIN, undefined);
  assert.equal(env.ChromeWs, 'cloud-browser:9222');
  assert.equal(env.ChromeHttp, 'cloud-http:9515');
  assert.equal(env.CDP_ENDPOINT, undefined);
  assert.equal(env.BROWSER_WS_ENDPOINT, undefined);
  assert.deepEqual(publicEnvSnapshot(env), {
    PROXY_AUTH: null,
    PROXY_DOMAIN: null,
    ChromeWs: 'cloud-browser:9222',
    ChromeHttp: 'cloud-http:9515',
    CDP_ENDPOINT: null,
    BROWSER_WS_ENDPOINT: null,
    CORECLAW_LOCAL: '1',
    CORECLAW_MOCK_NETWORK: null,
    CORECLAW_TMP_DIR: null,
  });
});

test('buildRuntimeEnv can emulate CoreClaw cloud proxy placeholders', () => {
  const env = buildRuntimeEnv({
    baseEnv: {},
    cloudProxy: true,
  });

  assert.equal(env.PROXY_AUTH, 'coreclaw-local:coreclaw-local');
  assert.equal(env.PROXY_DOMAIN, '127.0.0.1:6000');
  assert.equal(publicEnvSnapshot(env).PROXY_AUTH, 'coreclaw-local:***');
});

test('buildRuntimeEnv uses explicit proxy and runtime temp overrides', () => {
  const env = buildRuntimeEnv({
    baseEnv: {},
    proxyAuth: 'user:pass',
    proxyDomain: 'proxy.example:6000',
    runtimeTmpDir: 'E:\\worker\\tmp\\run',
  });

  assert.equal(env.PROXY_AUTH, 'user:pass');
  assert.equal(env.PROXY_DOMAIN, 'proxy.example:6000');
  assert.equal(env.CORECLAW_TMP_DIR, 'E:\\worker\\tmp\\run');
  assert.equal(env.TMPDIR, 'E:\\worker\\tmp\\run');
  assert.equal(env.TMP, 'E:\\worker\\tmp\\run');
  assert.equal(env.TEMP, 'E:\\worker\\tmp\\run');
});

test('buildRuntimeEnv derives ChromeHttp from explicit ChromeWs', () => {
  const env = buildRuntimeEnv({
    baseEnv: {},
    chromeWs: '127.0.0.1:9222/devtools/browser/test-id',
  });

  assert.equal(env.ChromeWs, '127.0.0.1:9222/devtools/browser/test-id');
  assert.equal(env.ChromeHttp, '127.0.0.1:9222');
});

test('resolveBrowserEndpoints discovers local Chrome CDP browser path', async () => {
  const endpoints = await resolveBrowserEndpoints({
    baseEnv: {},
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test-id',
        };
      },
    }),
  });

  assert.deepEqual(endpoints, {
    chromeWs: '127.0.0.1:9222/devtools/browser/test-id',
    chromeHttp: '127.0.0.1:9222',
    cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test-id',
    browserWsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test-id',
    discoveredLocalChrome: true,
  });
});

test('resolveBrowserEndpoints respects explicit ChromeWs and existing full endpoint', async () => {
  const explicit = await resolveBrowserEndpoints({
    baseEnv: {},
    chromeWs: 'browser.example/ws',
    chromeHttp: 'browser-http.example:9515',
    fetchImpl: async () => {
      throw new Error('should not discover when explicit');
    },
  });
  const inherited = await resolveBrowserEndpoints({
    baseEnv: {
      CDP_ENDPOINT: 'ws://127.0.0.1:9222/devtools/browser/existing',
    },
    fetchImpl: async () => {
      throw new Error('should not discover when inherited');
    },
  });

  assert.equal(explicit.chromeWs, 'browser.example/ws');
  assert.equal(explicit.chromeHttp, 'browser-http.example:9515');
  assert.equal(explicit.cdpEndpoint, undefined);
  assert.equal(inherited.chromeWs, '127.0.0.1:9222/devtools/browser/existing');
  assert.equal(inherited.chromeHttp, '127.0.0.1:9222');
  assert.equal(inherited.browserWsEndpoint, 'ws://127.0.0.1:9222/devtools/browser/existing');
});

test('resolveBrowserEndpoints falls back to local Chrome host when discovery is unavailable', async () => {
  const endpoints = await resolveBrowserEndpoints({
    baseEnv: {},
    fetchImpl: async () => ({
      ok: false,
      async json() {
        return {};
      },
    }),
  });

  assert.deepEqual(endpoints, {
    chromeWs: '127.0.0.1:9222',
    chromeHttp: '127.0.0.1:9222',
    cdpEndpoint: undefined,
    browserWsEndpoint: undefined,
    discoveredLocalChrome: false,
  });
});
