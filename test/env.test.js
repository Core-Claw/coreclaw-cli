import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntimeEnv, checkBrowserAvailability, lightpandaCdpEndpointFromDomain, publicEnvSnapshot, resolveBrowserEndpoints } from '../src/runtime/env.js';

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
  assert.equal(env.LightpandaDomain, undefined);
  assert.equal(env.CDP_ENDPOINT, undefined);
  assert.equal(env.BROWSER_WS_ENDPOINT, undefined);
  assert.deepEqual(publicEnvSnapshot(env), {
    PROXY_AUTH: null,
    PROXY_DOMAIN: null,
    ChromeWs: 'cloud-browser:9222',
    ChromeHttp: 'cloud-http:9515',
    LightpandaDomain: null,
    CDP_ENDPOINT: null,
    BROWSER_WS_ENDPOINT: null,
    CORECLAW_LOCAL: '1',
    CORECLAW_MOCK_NETWORK: null,
    CORECLAW_TMP_DIR: null,
  });
});

test('buildRuntimeEnv exposes LightpandaDomain with proxy auth placeholders', () => {
  const env = buildRuntimeEnv({
    baseEnv: {},
    lightpandaDomain: '127.0.0.1:9333',
  });

  assert.equal(env.LightpandaDomain, '127.0.0.1:9333');
  assert.equal(env.PROXY_AUTH, 'coreclaw-local:coreclaw-local');
  assert.equal(publicEnvSnapshot(env).LightpandaDomain, '127.0.0.1:9333');
});

test('lightpandaCdpEndpointFromDomain follows documented normalization rules', () => {
  assert.equal(
    lightpandaCdpEndpointFromDomain('lightpanda-inner.coreclaw.com'),
    'ws://lightpanda-inner.coreclaw.com/devtools/browser/new',
  );
  assert.equal(
    lightpandaCdpEndpointFromDomain('ws://127.0.0.1:9222/devtools/browser/new/'),
    'ws://127.0.0.1:9222/devtools/browser/new',
  );
  assert.equal(
    lightpandaCdpEndpointFromDomain('https://lightpanda.example/cdp'),
    'https://lightpanda.example/cdp',
  );
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

test('resolveBrowserEndpoints includes Lightpanda CDP normalization', async () => {
  const endpoints = await resolveBrowserEndpoints({
    baseEnv: {},
    lightpandaDomain: 'lightpanda-inner.coreclaw.com/',
    discoverLocalChrome: false,
  });

  assert.equal(endpoints.lightpandaDomain, 'lightpanda-inner.coreclaw.com/');
  assert.equal(endpoints.lightpandaCdpEndpoint, 'ws://lightpanda-inner.coreclaw.com/devtools/browser/new');
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

test('checkBrowserAvailability accepts discovered Chrome without probing again', async () => {
  const result = await checkBrowserAvailability({
    browserEndpoints: {
      discoveredLocalChrome: true,
      cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/test-id',
    },
    fetchImpl: async () => {
      throw new Error('should not probe discovered Chrome');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'cdp');
  assert.equal(result.source, 'discovery');
});

test('checkBrowserAvailability probes host-style Chrome CDP endpoints', async () => {
  const urls = [];
  const result = await checkBrowserAvailability({
    browserEndpoints: {
      chromeWs: '127.0.0.1:9222',
      chromeHttp: '127.0.0.1:9222',
      discoveredLocalChrome: false,
    },
    fetchImpl: async (url) => {
      urls.push(url);
      assert.equal(url, 'http://127.0.0.1:9222/json/version');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test-id',
          };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'cdp');
  assert.equal(result.endpoint, 'ws://127.0.0.1:9222/devtools/browser/test-id');
  assert.deepEqual(urls, ['http://127.0.0.1:9222/json/version']);
});

test('checkBrowserAvailability can accept Selenium WebDriver status endpoints', async () => {
  const urls = [];
  const result = await checkBrowserAvailability({
    browserEndpoints: {
      chromeWs: '127.0.0.1:9333',
      chromeHttp: '127.0.0.1:9515',
      discoveredLocalChrome: false,
    },
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith('/json/version')) {
        return {
          ok: false,
          status: 404,
          async json() {
            return {};
          },
        };
      }
      assert.equal(url, 'http://127.0.0.1:9515/status');
      return {
        ok: true,
        status: 200,
        async json() {
          return { value: { ready: true } };
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'webdriver');
  assert.deepEqual(urls, [
    'http://127.0.0.1:9515/json/version',
    'http://127.0.0.1:9333/json/version',
    'http://127.0.0.1:9515/status',
  ]);
});
