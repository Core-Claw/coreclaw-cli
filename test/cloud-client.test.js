import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreClawClient, resolveApiKey } from '../src/cloud/client.js';
import { CliError } from '../src/utils/errors.js';

test('resolveApiKey prefers explicit options and falls back to CORECLAW_API_KEY', () => {
  assert.equal(resolveApiKey({ apiKey: 'from-option' }, { CORECLAW_API_KEY: 'from-env' }), 'from-option');
  assert.equal(resolveApiKey({}, { CORECLAW_API_KEY: 'from-env' }), 'from-env');
  assert.equal(resolveApiKey({}, {}), null);
});

test('getAccount sends authenticated GET request with Bearer auth and v2 path', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-secret-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 20001, message: 'Invalid API key', data: null });
    },
  });

  await assert.rejects(
    () => client.getAccount(),
    (error) => error instanceof CliError
      && /CoreClaw API \/api\/v2\/users\/account failed with code 20001: Invalid API key/.test(error.message)
      && !error.message.includes('test-secret-key'),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/users/account');
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(calls[0].request.headers.authorization, 'Bearer test-secret-key');
  assert.equal(calls[0].request.headers['api-key'], undefined);
  assert.equal(calls[0].request.body, undefined);
});

test('listStore is public and does not require an api key or send auth headers', async () => {
  const calls = [];
  const client = createCoreClawClient({
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { scraper: [{ slug: 'demo' }] } });
    },
  });

  const response = await client.listStore({ keyword: 'foo', limit: 5 });

  assert.deepEqual(response.data, { scraper: [{ slug: 'demo' }] });
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/store?keyword=foo&limit=5');
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(Object.hasOwn(calls[0].request.headers, 'authorization'), false);
});

test('listProxyRegions is public and passes language query param', async () => {
  const calls = [];
  const client = createCoreClawClient({
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, data: { list: [{ code: 'US', name: 'United States' }] } });
    },
  });

  await client.listProxyRegions({ language: 'zh' });

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/proxy/region?language=zh');
  assert.equal(Object.hasOwn(calls[0].request.headers, 'authorization'), false);
});

test('authenticated endpoints require a CoreClaw API key', async () => {
  const client = createCoreClawClient({ fetchImpl: async () => jsonResponse({ code: 0, data: {} }) });

  await assert.rejects(
    () => client.getWorkerRun('RUN'),
    (error) => error instanceof CliError
      && /CoreClaw API key is required/.test(error.message)
      && /CORECLAW_API_KEY/.test(error.message),
  );
});

test('listWorkerRunResults sends v2 offset/limit pagination as query params', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({
        code: 0,
        message: 'success',
        data: { count: 1, list: [{ title: 'row' }], page_index: 2, page_size: 50 },
      });
    },
  });

  const response = await client.listWorkerRunResults('RUN', { offset: 50, limit: 50 });

  assert.equal(response.data.count, 1);
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-runs/RUN/result?offset=50&limit=50');
  assert.equal(calls[0].request.method, 'GET');
});

test('runWorker wraps flat input under input.parameters.custom (v2 contract)', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'run-123' } });
    },
  });

  const response = await client.runWorker('demo-worker', {
    input: { keyword: 'coffee', limit: 10 },
    version: '1.0.0',
    isAsync: true,
  });

  assert.equal(response.data.run_slug, 'run-123');
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/workers/demo-worker/runs');
  assert.equal(calls[0].request.method, 'POST');
  assert.equal(calls[0].request.headers.authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    input: { parameters: { custom: { keyword: 'coffee', limit: 10 } } },
    version: '1.0.0',
    is_async: true,
  });
});

test('runWorker leaves already-wrapped input untouched', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'run-456' } });
    },
  });

  const wrapped = { parameters: { custom: { keyword: 'tea' } } };
  await client.runWorker('demo-worker', { input: wrapped, isAsync: true });

  assert.deepEqual(JSON.parse(calls[0].request.body).input, wrapped);
});

test('runWorker omits input when none is provided', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'run-789' } });
    },
  });

  await client.runWorker('demo-worker', { isAsync: true });
  assert.equal(JSON.parse(calls[0].request.body).input, undefined);
});

test('createWorkerTask wraps flat input under input.parameters.custom', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { slug: 'demo-task' } });
    },
  });

  const response = await client.createWorkerTask({
    workerId: 'demo-worker',
    title: 'Daily coffee scrape',
    input: { keyword: 'coffee' },
    scheduleType: 1,
    scheduleEnabled: 1,
    scheduleTime: '09:00',
  });

  assert.equal(response.data.slug, 'demo-task');
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-tasks');
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    worker_id: 'demo-worker',
    title: 'Daily coffee scrape',
    input: { parameters: { custom: { keyword: 'coffee' } } },
    schedule_type: 1,
    schedule_enabled: 1,
    schedule_time: '09:00',
  });
});

test('abortWorkerRun sends POST with no body to v2 abort path', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success' });
    },
  });

  await client.abortWorkerRun('run-123');

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-runs/run-123/abort');
  assert.equal(calls[0].request.method, 'POST');
  assert.equal(calls[0].request.body, undefined);
});

test('exportWorkerRunResults passes format and filter_keys as query params', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, data: { download_url: 'https://signed.example.com/x.csv' } });
    },
  });

  await client.exportWorkerRunResults('run-123', { format: 'csv', filterKeys: ['title', 'url'] });

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-runs/run-123/result/export?format=csv&filter_keys=title%2Curl');
});

test('error responses surface details array when present', async () => {
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async () => jsonResponse({
      code: 11000,
      message: 'invalid argument',
      details: ['worker_id is required', 'title is required'],
      request_id: 'req-1',
    }, { ok: false, status: 400 }),
  });

  await assert.rejects(
    () => client.createWorkerTask({ workerId: '', title: '', input: {} }),
    (error) => error instanceof CliError
      && /code 11000: invalid argument/.test(error.message)
      && /worker_id is required; title is required/.test(error.message),
  );
});

test('invalid JSON responses become CLI errors', async () => {
  const client = createCoreClawClient({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => 'not json',
    }),
  });

  await assert.rejects(
    () => client.getAccount(),
    (error) => error instanceof CliError && /Invalid JSON response from CoreClaw API/.test(error.message),
  );
});

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}
