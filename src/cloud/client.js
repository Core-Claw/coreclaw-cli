import { CliError } from '../utils/errors.js';

export const DEFAULT_API_BASE_URL = 'https://openapi.coreclaw.com';

/**
 * CoreClaw API v2 client.
 *
 * Covers all 37 operations in the source OpenAPI document
 * (exported-api-docs/openapi.json). The published public contract documents
 * 34 of these; the other 3 — getWorkerInternal, createWorkerVersion,
 * updateWorkerVersion — are internal/version-management operations that the
 * published spec excludes (also intentionally unavailable via MCP). They are
 * kept here as preview capabilities (release publish uses createWorkerVersion)
 * but are NOT part of the documented public API and may change without notice.
 *
 * Auth: HTTP Bearer (Authorization: Bearer <token>), with two fallback modes
 * also supported by v2 — the legacy api-key header and ?token= query
 * (QueryTokenAuth). This client sends Bearer. Public endpoints (store,
 * proxy/region, input-schema) send no auth.
 *
 * Response envelope: { code, message, data, request_id }. code === 0 means success.
 * Error envelope: { code, message, details?, request_id? } returned on HTTP 4xx/5xx.
 */

const V2 = '/api/v2';

// Operations whose published spec marks them as public (no auth required).
// Note: getWorkerInternal is intentionally NOT here — it is an excluded
// internal operation in the published contract. It is still callable as a
// preview feature but sends auth like any authenticated operation.
const PUBLIC_OPERATIONS = new Set([
  'listStore',
  'listProxyRegions',
  'getWorkerInputSchema',
]);

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
  FormDataImpl = globalThis.FormData,
  BlobImpl = globalThis.Blob,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new CliError('CoreClaw API requests require fetch support. Use Node.js 18+ or provide fetchImpl.');
  }

  const request = async (method, endpoint, {
    body,
    query,
    jsonBody = true,
    auth = true,
  } = {}) => {
    const requiresAuth = auth !== false;
    if (requiresAuth && !apiKey) {
      throw new CliError('CoreClaw API key is required. Set CORECLAW_API_KEY or pass --api-key.');
    }

    const url = buildUrl(apiBaseUrl, endpoint, requiresAuth ? { ...query, ...(apiKey ? { token: null } : {}) } : query, apiKey);
    const headers = {};
    if (requiresAuth) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    let payload;
    if (body !== undefined && body !== null) {
      if (jsonBody) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(stripEmpty(body));
      } else {
        payload = body; // pre-built FormData / binary
      }
    } else if (method !== 'GET' && method !== 'DELETE' && jsonBody) {
      // v2 allows empty bodies on POST (abort/run-task have no body). Send nothing.
      payload = undefined;
    }

    let response;
    try {
      response = await fetchImpl(url, { method, headers, body: payload });
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

    if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'code') && parsed.code !== 0) {
      const details = Array.isArray(parsed?.details) && parsed.details.length > 0 ? ` (${parsed.details.join('; ')})` : '';
      const message = parsed.message ? `: ${parsed.message}` : '';
      throw new CliError(`CoreClaw API ${endpoint} failed with code ${parsed.code}${message}${details}`);
    }

    if (!response.ok) {
      const message = parsed?.message ? `: ${parsed.message}` : '';
      throw new CliError(`CoreClaw API ${endpoint} HTTP ${response.status}${message}`);
    }

    return parsed;
  };

  // ---- Account ----
  const getAccount = () => request('GET', `${V2}/users/account`);

  // ---- Store (public) ----
  const listStore = ({ keyword, offset, limit } = {}) => request('GET', `${V2}/store`, {
    query: { keyword, offset, limit },
    auth: false,
  });

  // ---- Proxy (public) ----
  const listProxyRegions = ({ language } = {}) => request('GET', `${V2}/proxy/region`, {
    query: { language },
    auth: false,
  });

  // ---- Workers ----
  const listWorkers = ({ keyword, offset, limit } = {}) => request('GET', `${V2}/workers`, {
    query: { keyword, offset, limit },
  });

  const getWorker = (workerId) => request('GET', `${V2}/workers/${encodePathParam(workerId)}`);

  const getWorkerInputSchema = (workerId) => request('GET', `${V2}/workers/${encodePathParam(workerId)}/input-schema`, {
    auth: false,
  });

  // Preview: /internal is excluded from the published public contract. Kept as
  // a preview capability; requires auth like any authenticated operation.
  const getWorkerInternal = (workerId) => request('GET', `${V2}/workers/${encodePathParam(workerId)}/internal`);

  const runWorker = (workerId, {
    input,
    version,
    isAsync = true,
    callbackUrl,
    limit,
    offset,
  } = {}) => request('POST', `${V2}/workers/${encodePathParam(workerId)}/runs`, {
    body: stripEmpty({
      input: wrapWorkerInput(input),
      version,
      is_async: isAsync,
      callback_url: callbackUrl,
      limit,
      offset,
    }),
  });

  const createWorkerVersion = (workerId, {
    scraperFile, // Buffer or Blob
    title,
    description,
    categories,
    icon,
  }) => {
    if (!scraperFile) {
      throw new CliError('createWorkerVersion requires a scraper_file (zip buffer or Blob).');
    }
    const form = buildMultipartVersion({ scraperFile, title, description, categories, icon }, FormDataImpl, BlobImpl);
    return request('POST', `${V2}/workers/${encodePathParam(workerId)}/versions`, {
      body: form,
      jsonBody: false,
    });
  };

  const updateWorkerVersion = (workerId, version, {
    scraperFile, title, description, categories, icon,
  }) => {
    if (!scraperFile) {
      throw new CliError('updateWorkerVersion requires a scraper_file (zip buffer or Blob).');
    }
    const form = buildMultipartVersion({ scraperFile, title, description, categories, icon }, FormDataImpl, BlobImpl);
    return request('PUT', `${V2}/workers/${encodePathParam(workerId)}/versions/${encodePathParam(version)}`, {
      body: form,
      jsonBody: false,
    });
  };

  // ---- Worker runs (by runId = run slug) ----
  const listWorkerRuns = ({ workerId, status, offset, limit } = {}) => request('GET', `${V2}/worker-runs`, {
    query: { worker_id: workerId, status, offset, limit },
  });

  const getWorkerRun = (runId) => request('GET', `${V2}/worker-runs/${encodePathParam(runId)}`);

  const getWorkerRunLog = (runId) => request('GET', `${V2}/worker-runs/${encodePathParam(runId)}/log`);

  const listWorkerRunResults = (runId, { offset, limit } = {}) => request('GET', `${V2}/worker-runs/${encodePathParam(runId)}/result`, {
    query: { offset, limit },
  });

  const exportWorkerRunResults = (runId, { format = 'json', filterKeys } = {}) => request('GET', `${V2}/worker-runs/${encodePathParam(runId)}/result/export`, {
    query: { format, filter_keys: joinFilterKeys(filterKeys) },
  });

  const abortWorkerRun = (runId) => request('POST', `${V2}/worker-runs/${encodePathParam(runId)}/abort`);

  const rerunWorkerRun = (runId, { callbackUrl, isAsync = true, limit, offset } = {}) => request('POST', `${V2}/worker-runs/${encodePathParam(runId)}/rerun`, {
    body: stripEmpty({ callback_url: callbackUrl, is_async: isAsync, limit, offset }),
  });

  // ---- Worker runs (last, scoped to the caller or to a specific worker) ----
  // The spec exposes both a caller-scoped "last" and a worker-scoped "last" variant
  // (/api/v2/workers/{workerId}/runs/last/*). When workerId is provided we hit the
  // worker-scoped path; otherwise the caller-scoped path.
  const getLastWorkerRun = ({ workerId } = {}) => request('GET', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last`);

  const getLastWorkerRunLog = ({ workerId } = {}) => request('GET', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last/log`);

  const listLastWorkerRunResults = ({ workerId, offset, limit } = {}) => request('GET', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last/result`, {
    query: { offset, limit },
  });

  const exportLastWorkerRunResults = ({ workerId, format = 'json', filterKeys } = {}) => request('GET', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last/export`, {
    query: { format, filter_keys: joinFilterKeys(filterKeys) },
  });

  const abortLastWorkerRun = ({ workerId } = {}) => request('POST', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last/abort`);

  const rerunLastWorkerRun = ({ workerId, callbackUrl, isAsync = true, limit, offset } = {}) => request('POST', `${V2}/workers${workerId ? `/${encodePathParam(workerId)}` : ''}/runs/last/rerun`, {
    body: stripEmpty({ callback_url: callbackUrl, is_async: isAsync, limit, offset }),
  });

  // Worker-scoped last-run aliases (operationIds: getWorkerLastRun, getWorkerLastRunLog, etc.).
  const getWorkerLastRun = (workerId) => getLastWorkerRun({ workerId });
  const getWorkerLastRunLog = (workerId) => getLastWorkerRunLog({ workerId });
  const listWorkerLastRunResults = (workerId, { offset, limit } = {}) => listLastWorkerRunResults({ workerId, offset, limit });
  const exportWorkerLastRunResults = (workerId, { format, filterKeys } = {}) => exportLastWorkerRunResults({ workerId, format, filterKeys });
  const abortWorkerLastRun = (workerId) => abortLastWorkerRun({ workerId });
  const rerunWorkerLastRun = (workerId, { callbackUrl, isAsync, limit, offset } = {}) => rerunLastWorkerRun({ workerId, callbackUrl, isAsync, limit, offset });

  // ---- Worker tasks ----
  const listWorkerTasks = ({ workerId, offset, limit } = {}) => request('GET', `${V2}/worker-tasks`, {
    query: { worker_id: workerId, offset, limit },
  });

  const createWorkerTask = ({
    workerId, title, input, version, description,
    scheduleType, scheduleEnabled, scheduleWeekday, scheduleDay, scheduleTime, scheduleOnceDate,
  }) => request('POST', `${V2}/worker-tasks`, {
    body: stripEmpty({
      worker_id: workerId,
      title,
      input: wrapWorkerInput(input),
      version,
      description,
      schedule_type: scheduleType,
      schedule_enabled: scheduleEnabled,
      schedule_weekday: scheduleWeekday,
      schedule_day: scheduleDay,
      schedule_time: scheduleTime,
      schedule_once_date: scheduleOnceDate,
    }),
  });

  const getWorkerTask = (workerTaskId) => request('GET', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}`);

  const updateWorkerTask = (workerTaskId, {
    title, description,
    scheduleType, scheduleEnabled, scheduleWeekday, scheduleDay, scheduleTime, scheduleOnceDate,
  }) => request('PUT', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}`, {
    body: stripEmpty({
      title,
      description,
      schedule_type: scheduleType,
      schedule_enabled: scheduleEnabled,
      schedule_weekday: scheduleWeekday,
      schedule_day: scheduleDay,
      schedule_time: scheduleTime,
      schedule_once_date: scheduleOnceDate,
    }),
  });

  const deleteWorkerTask = (workerTaskId) => request('DELETE', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}`);

  const getWorkerTaskInput = (workerTaskId) => request('GET', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}/input`);

  const updateWorkerTaskInput = (workerTaskId, { input, version }) => request('PUT', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}/input`, {
    body: stripEmpty({ input: wrapWorkerInput(input), version }),
  });

  const runWorkerTask = (workerTaskId, { callbackUrl, isAsync = true, limit, offset } = {}) => request('POST', `${V2}/worker-tasks/${encodePathParam(workerTaskId)}/runs`, {
    body: stripEmpty({ callback_url: callbackUrl, is_async: isAsync, limit, offset }),
  });

  return {
    // Account
    getAccount,
    // Store / proxy (public)
    listStore,
    listProxyRegions,
    // Workers
    listWorkers,
    getWorker,
    getWorkerInputSchema,
    getWorkerInternal,
    runWorker,
    createWorkerVersion,
    updateWorkerVersion,
    // Worker runs (by runId)
    listWorkerRuns,
    getWorkerRun,
    getWorkerRunLog,
    listWorkerRunResults,
    exportWorkerRunResults,
    abortWorkerRun,
    rerunWorkerRun,
    // Worker runs (last)
    getLastWorkerRun,
    getLastWorkerRunLog,
    listLastWorkerRunResults,
    exportLastWorkerRunResults,
    abortLastWorkerRun,
    rerunLastWorkerRun,
    // Worker-scoped last-run aliases (operationIds from openapi spec)
    getWorkerLastRun,
    getWorkerLastRunLog,
    listWorkerLastRunResults,
    exportWorkerLastRunResults,
    abortWorkerLastRun,
    rerunWorkerLastRun,
    // Worker tasks
    listWorkerTasks,
    createWorkerTask,
    getWorkerTask,
    updateWorkerTask,
    deleteWorkerTask,
    getWorkerTaskInput,
    updateWorkerTaskInput,
    runWorkerTask,
  };
}

function buildUrl(apiBaseUrl, endpoint, query = {}, apiKey = null) {
  const url = new URL(endpoint, apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (key === 'token' && value === null) {
      // token is added below only when Authorization header is unavailable; skip here.
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function encodePathParam(value) {
  return encodeURIComponent(String(value));
}

function joinFilterKeys(filterKeys) {
  if (!filterKeys) {
    return undefined;
  }
  if (Array.isArray(filterKeys)) {
    return filterKeys.length > 0 ? filterKeys.join(',') : undefined;
  }
  return String(filterKeys);
}

function stripEmpty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([_key, item]) => item !== undefined && item !== null && item !== ''),
  );
}

/**
 * v2 runWorker requires Worker form fields under `input.parameters.custom`.
 * Users typically pass a flat input file (the same shape used for local runs),
 * e.g. `{ keywords: ["coffee"], max_results: 1 }`. Wrap such raw input so the
 * caller does not have to know the v2 envelope. If the input is already wrapped
 * (has `parameters.custom`) or is explicitly absent/null, leave it untouched.
 *
 * Verified 2026-07-24: flat `input` is rejected with code 11000; the wrapped
 * form is accepted and returns data.run_slug.
 */
function wrapWorkerInput(input) {
  if (input === undefined || input === null) {
    return input;
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  if (
    input.parameters &&
    typeof input.parameters === 'object' &&
    Object.prototype.hasOwnProperty.call(input.parameters, 'custom')
  ) {
    return input;
  }
  return { parameters: { custom: input } };
}

function buildMultipartVersion({ scraperFile, title, description, categories, icon }, FormDataImpl, BlobImpl) {
  if (typeof FormDataImpl !== 'function') {
    throw new CliError('createWorkerVersion/updateWorkerVersion require global FormData (Node 18+) or a FormDataImpl.');
  }
  const form = new FormDataImpl();
  form.append('scraper_file', toBlob(scraperFile, BlobImpl), 'worker.zip');
  form.append('title', String(title ?? ''));
  form.append('description', String(description ?? ''));
  if (Array.isArray(categories)) {
    for (const category of categories) {
      form.append('categories', String(category));
    }
  }
  if (icon) {
    form.append('icon', String(icon));
  }
  return form;
}

function toBlob(scraperFile, BlobImpl) {
  if (scraperFile instanceof BlobImpl) {
    return scraperFile;
  }
  if (Buffer.isBuffer(scraperFile)) {
    return new BlobImpl([scraperFile]);
  }
  if (scraperFile instanceof Uint8Array) {
    return new BlobImpl([scraperFile]);
  }
  if (typeof scraperFile === 'string') {
    return new BlobImpl([scraperFile]);
  }
  // Already a fetch BodyInit-compatible value (Blob, File, etc.)
  return scraperFile;
}
