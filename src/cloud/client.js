import { CliError } from '../utils/errors.js';

export const DEFAULT_API_BASE_URL = 'https://openapi.coreclaw.com';

export function resolveApiKey(options = {}, env = process.env) {
  const key = options.apiKey ?? env.CORECLAW_API_KEY ?? null;
  if (typeof key !== 'string') {
    return null;
  }
  const trimmed = key.trim();
  return trimmed || null;
}

export function createCoreClawClient({
  apiKey = null,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new CliError('CoreClaw API requests require fetch support. Use Node.js 18+ or provide fetchImpl.');
  }

  const request = async (method, endpoint, {
    body,
    query,
    auth = true,
  } = {}) => {
    const requiresAuth = auth !== false;
    if (requiresAuth && !apiKey) {
      throw new CliError('CoreClaw API key is required. Set CORECLAW_API_KEY or pass --api-key.');
    }

    const url = buildUrl(apiBaseUrl, endpoint, query);
    const headers = { 'content-type': 'application/json' };
    if (requiresAuth) {
      headers['api-key'] = apiKey;
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
    } catch (error) {
      throw new CliError(`CoreClaw API ${endpoint} request failed: ${error.message}`);
    }

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new CliError(`Invalid JSON response from CoreClaw API ${endpoint}: ${error.message}`);
    }

    if (!response.ok) {
      const message = parsed?.message ? `: ${parsed.message}` : '';
      throw new CliError(`CoreClaw API ${endpoint} HTTP ${response.status}${message}`);
    }

    if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'code') && parsed.code !== 0) {
      const message = parsed.message ? `: ${parsed.message}` : '';
      throw new CliError(`CoreClaw API ${endpoint} failed with code ${parsed.code}${message}`);
    }

    return parsed;
  };

  return {
    accountInfo: () => request('POST', '/api/v1/account/info'),
    searchWorkers: ({ search, limit } = {}) => request('GET', '/api/store', {
      query: { search, limit },
      auth: false,
    }),
    workerDetail: (scraperSlug) => request('GET', '/api/scraper', {
      query: { slug: scraperSlug },
      auth: false,
    }),
    runWorker: ({ scraperSlug, version, input, isAsync = true, callbackUrl = null }) => request('POST', '/api/v1/scraper/run', {
      body: stripEmpty({
        scraper_slug: scraperSlug,
        version,
        input,
        callback_url: callbackUrl,
        is_async: isAsync,
      }),
    }),
    abortRun: (runSlug) => request('POST', '/api/v1/scraper/abort', {
      body: { run_slug: runSlug },
    }),
    listRuns: ({ pageIndex = 1, pageSize = 20, status = 0, scraperSlug = null } = {}) => request('POST', '/api/v1/run/list', {
      body: stripEmpty({
        page_index: pageIndex,
        page_size: pageSize,
        status,
        scraper_slug: scraperSlug,
      }),
    }),
    runDetail: (runSlug) => request('POST', '/api/v1/run/detail', {
      body: { run_slug: runSlug },
    }),
    runResults: ({ runSlug, pageIndex = 1, pageSize = 20 } = {}) => request('POST', '/api/v1/run/result/list', {
      body: {
        run_slug: runSlug,
        page_index: pageIndex,
        page_size: pageSize,
      },
    }),
    runLogs: (runSlug) => request('POST', '/api/v1/run/last/log', {
      body: { run_slug: runSlug },
    }),
    exportRun: ({ runSlug, filterKeys = [], format = 'json' } = {}) => request('POST', '/api/v1/run/result/export', {
      body: {
        run_slug: runSlug,
        filter_keys: filterKeys,
        format,
      },
    }),
    rerun: ({ runSlug, callbackUrl } = {}) => request('POST', '/api/v1/rerun', {
      body: {
        run_slug: runSlug,
        callback_url: callbackUrl,
      },
    }),
    runTask: ({ taskSlug, callbackUrl } = {}) => request('POST', '/api/v1/task/run', {
      body: {
        task_slug: taskSlug,
        callback_url: callbackUrl,
      },
    }),
  };
}

function buildUrl(apiBaseUrl, endpoint, query = {}) {
  const url = new URL(endpoint, apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function stripEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined && item !== null && item !== ''),
  );
}
