export function buildRuntimeEnv({
  baseEnv = process.env,
  overrides = {},
  proxyAuth,
  proxyDomain,
  chromeWs,
  chromeHttp,
  cdpEndpoint,
  browserWsEndpoint,
  cloudProxy = false,
  mockNetwork = false,
  runtimeTmpDir = null,
}) {
  const env = {
    ...baseEnv,
    CORECLAW_LOCAL: '1',
  };

  const hasExplicitProxyAuth = proxyAuth !== undefined && proxyAuth !== '';
  const hasExplicitProxyDomain = proxyDomain !== undefined && proxyDomain !== '';
  const shouldEnableProxy = cloudProxy || hasExplicitProxyAuth || hasExplicitProxyDomain;
  if (shouldEnableProxy) {
    env.PROXY_AUTH = hasExplicitProxyAuth ? proxyAuth : baseEnv.PROXY_AUTH ?? 'coreclaw-local:coreclaw-local';
    env.PROXY_DOMAIN = hasExplicitProxyDomain ? proxyDomain : baseEnv.PROXY_DOMAIN ?? '127.0.0.1:6000';
  } else {
    delete env.PROXY_AUTH;
    delete env.PROXY_DOMAIN;
  }

  delete env.CDP_ENDPOINT;
  delete env.BROWSER_WS_ENDPOINT;

  env.ChromeWs = chromeWs ?? baseEnv.ChromeWs ?? '127.0.0.1:9222';
  env.ChromeHttp = chromeHttp ?? baseEnv.ChromeHttp ?? chromeHttpFromChromeWs(env.ChromeWs);
  if (cdpEndpoint !== undefined && cdpEndpoint !== '') {
    env.CDP_ENDPOINT = cdpEndpoint;
  }
  if (browserWsEndpoint !== undefined && browserWsEndpoint !== '') {
    env.BROWSER_WS_ENDPOINT = browserWsEndpoint;
  }

  if (mockNetwork) {
    env.CORECLAW_MOCK_NETWORK = '1';
  }

  if (runtimeTmpDir) {
    env.CORECLAW_TMP_DIR = runtimeTmpDir;
    env.TMPDIR = runtimeTmpDir;
    env.TMP = runtimeTmpDir;
    env.TEMP = runtimeTmpDir;
  }

  Object.assign(env, overrides);

  return env;
}

export function publicEnvSnapshot(env) {
  return {
    PROXY_AUTH: env.PROXY_AUTH ? maskSecret(env.PROXY_AUTH) : null,
    PROXY_DOMAIN: env.PROXY_DOMAIN ?? null,
    ChromeWs: env.ChromeWs ?? null,
    ChromeHttp: env.ChromeHttp ?? null,
    CDP_ENDPOINT: env.CDP_ENDPOINT ? maskEndpoint(env.CDP_ENDPOINT) : null,
    BROWSER_WS_ENDPOINT: env.BROWSER_WS_ENDPOINT ? maskEndpoint(env.BROWSER_WS_ENDPOINT) : null,
    CORECLAW_LOCAL: env.CORECLAW_LOCAL ?? null,
    CORECLAW_MOCK_NETWORK: env.CORECLAW_MOCK_NETWORK ?? null,
    CORECLAW_TMP_DIR: env.CORECLAW_TMP_DIR ?? null,
  };
}

export async function resolveBrowserEndpoints({
  baseEnv = process.env,
  chromeWs,
  chromeHttp,
  discoverLocalChrome = true,
  localChromeHost = '127.0.0.1:9222',
  fetchImpl = globalThis.fetch,
} = {}) {
  const explicitChromeWs = chromeWs ?? baseEnv.ChromeWs;
  const explicitChromeHttp = chromeHttp ?? baseEnv.ChromeHttp;
  if (explicitChromeWs) {
    return {
      chromeWs: explicitChromeWs,
      chromeHttp: explicitChromeHttp ?? chromeHttpFromChromeWs(explicitChromeWs),
      cdpEndpoint: baseEnv.CDP_ENDPOINT ?? fullEndpointFromChromeWs(explicitChromeWs),
      browserWsEndpoint: baseEnv.BROWSER_WS_ENDPOINT ?? fullEndpointFromChromeWs(explicitChromeWs),
      discoveredLocalChrome: false,
    };
  }

  const existingFullEndpoint = baseEnv.CDP_ENDPOINT ?? baseEnv.BROWSER_WS_ENDPOINT;
  if (existingFullEndpoint) {
    return {
      chromeWs: chromeWsAddressFromEndpoint(existingFullEndpoint),
      chromeHttp: explicitChromeHttp ?? chromeHttpFromChromeWs(chromeWsAddressFromEndpoint(existingFullEndpoint)),
      cdpEndpoint: baseEnv.CDP_ENDPOINT ?? existingFullEndpoint,
      browserWsEndpoint: baseEnv.BROWSER_WS_ENDPOINT ?? existingFullEndpoint,
      discoveredLocalChrome: false,
    };
  }

  if (discoverLocalChrome && fetchImpl) {
    const discoveredEndpoint = await discoverLocalChromeEndpoint(localChromeHost, fetchImpl);
    if (discoveredEndpoint) {
      return {
        chromeWs: chromeWsAddressFromEndpoint(discoveredEndpoint),
        chromeHttp: explicitChromeHttp ?? localChromeHost,
        cdpEndpoint: discoveredEndpoint,
        browserWsEndpoint: discoveredEndpoint,
        discoveredLocalChrome: true,
      };
    }
  }

  return {
    chromeWs: localChromeHost,
    chromeHttp: explicitChromeHttp ?? localChromeHost,
    cdpEndpoint: undefined,
    browserWsEndpoint: undefined,
    discoveredLocalChrome: false,
  };
}

export async function checkBrowserAvailability({
  browserEndpoints,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1000,
} = {}) {
  if (browserEndpoints?.discoveredLocalChrome && browserEndpoints.cdpEndpoint) {
    return {
      ok: true,
      kind: 'cdp',
      source: 'discovery',
      endpoint: browserEndpoints.cdpEndpoint,
      probes: [],
    };
  }

  const probes = [];
  if (!fetchImpl) {
    return { ok: false, probes };
  }

  const cdpUrls = unique([
    browserProbeUrl(browserEndpoints?.chromeHttp, '/json/version'),
    browserProbeUrl(chromeHttpFromChromeWs(browserEndpoints?.chromeWs), '/json/version'),
  ].filter(Boolean));

  for (const url of cdpUrls) {
    const probe = { kind: 'cdp', url: maskEndpoint(url) };
    probes.push(probe);
    try {
      const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      probe.status = response.status ?? null;
      if (!response.ok) {
        continue;
      }
      const metadata = await response.json();
      if (typeof metadata?.webSocketDebuggerUrl === 'string' && metadata.webSocketDebuggerUrl.startsWith('ws')) {
        return {
          ok: true,
          kind: 'cdp',
          source: 'probe',
          endpoint: metadata.webSocketDebuggerUrl,
          probes,
        };
      }
    } catch (error) {
      probe.error = error.message;
    }
  }

  const webdriverUrls = unique([
    browserProbeUrl(browserEndpoints?.chromeHttp, '/status'),
  ].filter(Boolean));

  for (const url of webdriverUrls) {
    const probe = { kind: 'webdriver', url: maskEndpoint(url) };
    probes.push(probe);
    try {
      const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      probe.status = response.status ?? null;
      if (response.ok) {
        return {
          ok: true,
          kind: 'webdriver',
          source: 'probe',
          endpoint: url,
          probes,
        };
      }
    } catch (error) {
      probe.error = error.message;
    }
  }

  return { ok: false, probes };
}

export function withNodeTmpHook(env, hookPath, options = {}) {
  const hookOption = `--require=${hookPath}`;
  const currentOptions = env.NODE_OPTIONS ?? '';
  const nodeOptions = currentOptions.includes(hookOption)
    ? currentOptions
    : [currentOptions, hookOption].filter(Boolean).join(' ');
  const nextEnv = {
    ...env,
    NODE_OPTIONS: nodeOptions,
    CORECLAW_NODE_TMP_HOOK: '1',
  };
  if (options.workerDir) {
    nextEnv.CORECLAW_WORKER_DIR = options.workerDir;
  }
  return nextEnv;
}

function maskSecret(value) {
  if (!value) {
    return value;
  }
  const [username] = String(value).split(':');
  return `${username}:***`;
}

function maskEndpoint(value) {
  return String(value).replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

function fullEndpointFromChromeWs(value) {
  const text = String(value).trim();
  if (text.startsWith('ws://') || text.startsWith('wss://')) {
    return text;
  }
  return undefined;
}

function chromeWsAddressFromEndpoint(value) {
  return String(value).trim().replace(/^wss?:\/\//i, '');
}

function chromeHttpFromChromeWs(value) {
  return String(value ?? '127.0.0.1:9222')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/devtools\/browser\/.*$/i, '')
    .replace(/\/ws\?.*$/i, '');
}

async function discoverLocalChromeEndpoint(host, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetchImpl(`http://${host}/json/version`, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const metadata = await response.json();
    const endpoint = metadata?.webSocketDebuggerUrl;
    if (typeof endpoint === 'string' && endpoint.startsWith('ws')) {
      return endpoint;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithTimeout(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function browserProbeUrl(value, pathname) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(text)
    ? text.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:')
    : `http://${text}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function unique(values) {
  return Array.from(new Set(values));
}
