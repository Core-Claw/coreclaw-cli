import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreClawClient, resolveApiKey } from '../src/cloud/client.js';
import { CliError } from '../src/utils/errors.js';

test('resolveApiKey prefers explicit options and falls back to CORECLAW_API_KEY', () => {
  assert.equal(resolveApiKey({ apiKey: 'from-option' }, { CORECLAW_API_KEY: 'from-env' }), 'from-option');
  assert.equal(resolveApiKey({}, { CORECLAW_API_KEY: 'from-env' }), 'from-env');
  assert.equal(resolveApiKey({}, {}), null);
});

test('accountInfo sends authenticated POST request without leaking the api key in errors', async () => {
  const calls = [];
  const client = createCoreClawClient({
    apiKey: 'test-secret-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 20001, message: 'Invalid API key', data: null });
    },
  });

  await assert.rejects(
    () => client.accountInfo(),
    (error) => error instanceof CliError
      && /CoreClaw API \/api\/v1\/account\/info failed with code 20001: Invalid API key/.test(error.message)
      && !error.message.includes('test-secret-key'),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v1/account/info');
  assert.equal(calls[0].request.method, 'POST');
  assert.equal(calls[0].request.headers['api-key'], 'test-secret-key');
  assert.equal(calls[0].request.headers['content-type'], 'application/json');
  assert.equal(calls[0].request.body, '{}');
});

test('workerDetail is public and does not require an api key', async () => {
  const calls = [];
  const client = createCoreClawClient({
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { version: 'v1.0.5' } });
    },
  });

  const response = await client.workerDetail('worker slug');

  assert.deepEqual(response.data, { version: 'v1.0.5' });
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/scraper?slug=worker+slug');
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(Object.hasOwn(calls[0].request.headers, 'api-key'), false);
});

test('authenticated endpoints require a CoreClaw API key', async () => {
  const client = createCoreClawClient({ fetchImpl: async () => jsonResponse({ code: 0, data: {} }) });

  await assert.rejects(
    () => client.runDetail('RUN'),
    (error) => error instanceof CliError
      && /CoreClaw API key is required/.test(error.message)
      && /CORECLAW_API_KEY/.test(error.message),
  );
});

test('runResults sends documented pagination fields', async () => {
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

  const response = await client.runResults({ runSlug: 'RUN', pageIndex: 2, pageSize: 50 });

  assert.equal(response.data.count, 1);
  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v1/run/result/list');
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    run_slug: 'RUN',
    page_index: 2,
    page_size: 50,
  });
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
    () => client.accountInfo(),
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
