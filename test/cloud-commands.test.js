import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { accountCommand } from '../src/commands/account.js';
import { runsCommand } from '../src/commands/runs.js';
import { workersCommand } from '../src/commands/workers.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { readCloudRows } from '../src/compare/rows.js';
import { CliError } from '../src/utils/errors.js';

test('account info prints balance summary via v2 GET /api/v2/users/account', async () => {
  const calls = [];
  const output = await captureConsole(() => accountCommand(['info'], {
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success', data: { balance: '10.00', balance_expiration_at: 1782091200 } });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/users/account');
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(calls[0].request.headers.authorization, 'Bearer test-key');
  assert.match(output.stdout, /CoreClaw account/);
  assert.match(output.stdout, /Balance: 10.00/);
  assert.equal(output.result.data.balance, '10.00');
});

test('workers detail prints version and input schema via v2 GET /api/v2/workers/{id}/input-schema', async () => {
  const output = await captureConsole(() => workersCommand(['detail', 'WORKER'], {
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v2/workers/WORKER') {
        return jsonResponse({ code: 0, data: { version: 'v1.0.5', title: 'Demo' } });
      }
      if (pathname === '/api/v2/workers/WORKER/input-schema') {
        return jsonResponse({ code: 0, data: { properties: [{ name: 'urls', type: 'array', editor: 'requestList', required: true }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Worker WORKER/);
  assert.match(output.stdout, /Version: v1.0.5/);
  assert.match(output.stdout, /urls \(array, requestList, required\)/);
});

test('workers run posts input at top level to v2 /api/v2/workers/{id}/runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ keyword: 'coffee', limit: 10 }));
  const calls = [];

  const output = await captureConsole(() => workersCommand(['run', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'auto',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url.includes('/api/v2/workers/WORKER?') || url.endsWith('/api/v2/workers/WORKER')) {
        return jsonResponse({ code: 0, data: { version: 'v2.0.0' } });
      }
      return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUN123' } });
    },
  }));

  assert.match(output.stdout, /Run started: RUN123/);
  const runRequest = calls.find((call) => call.url.endsWith('/api/v2/workers/WORKER/runs'));
  assert.deepEqual(JSON.parse(runRequest.request.body), {
    input: { keyword: 'coffee', limit: 10 },
    version: 'v2.0.0',
    is_async: true,
  });
});

test('workers run waits for cloud completion and writes results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-wait-'));
  const inputPath = path.join(dir, 'input.json');
  const resultsPath = path.join(dir, 'cloud-results.json');
  fs.writeFileSync(inputPath, JSON.stringify({ keyword: 'coffee' }));
  const detailStatuses = ['running', 'succeeded'];

  const output = await captureConsole(() => workersCommand(['run', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'v2.0.0',
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    resultsOutput: resultsPath,
    sleepImpl: async () => {},
    fetchImpl: async (url, request) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v2/workers/WORKER/runs') {
        return jsonResponse({ code: 0, data: { run_slug: 'RUN123' } });
      }
      if (pathname === '/api/v2/worker-runs/RUN123') {
        return jsonResponse({ code: 0, data: { slug: 'RUN123', status: detailStatuses.shift() } });
      }
      if (pathname === '/api/v2/worker-runs/RUN123/result') {
        return jsonResponse({
          code: 0,
          data: {
            count: 1,
            headers: [{ key: 'title', label: 'title', format: 'text' }],
            list: [{ title: 'Cloud result' }],
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run started: RUN123/);
  assert.match(output.stdout, /Waiting for cloud run: RUN123/);
  assert.match(output.stdout, /Run finished: Succeeded/);
  assert.match(output.stdout, /Results: .*cloud-results\.json/);
  assert.deepEqual(readCloudRows(resultsPath), [{ title: 'Cloud result' }]);
  assert.equal(output.result.detail.status, 'succeeded');
  assert.equal(output.result.results_path, resultsPath);
});

test('workers run wait fails when the cloud run does not succeed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-fail-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ keyword: 'coffee' }));

  await assert.rejects(
    () => workersCommand(['run', 'WORKER'], {
      apiKey: 'test-key',
      input: inputPath,
      version: 'v2.0.0',
      wait: true,
      waitTimeout: '1s',
      pollInterval: '1ms',
      fetchImpl: async (url) => {
        const { pathname } = new URL(url);
        if (pathname === '/api/v2/workers/WORKER/runs') {
          return jsonResponse({ code: 0, data: { run_slug: 'RUNFAILED' } });
        }
        if (pathname === '/api/v2/worker-runs/RUNFAILED') {
          return jsonResponse({ code: 0, data: { slug: 'RUNFAILED', status: 'failed' } });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    }),
    (error) => error instanceof CliError
      && /ended with status failed/.test(error.message)
      && /coreclaw runs logs RUNFAILED/.test(error.message),
  );
});

test('runs results writes CoreClaw result-list response usable by compare', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-results-'));
  const outputPath = path.join(dir, 'cloud-results.json');

  const output = await captureConsole(() => runsCommand(['results', 'RUN'], {
    apiKey: 'test-key',
    output: outputPath,
    pageIndex: '2',
    pageSize: '50',
    fetchImpl: fakeFetchFor({
      '/api/v2/worker-runs/RUN/result': {
        code: 0,
        message: 'success',
        data: {
          count: 1,
          headers: [{ key: 'title', label: 'title', format: 'text' }],
          list: [{ title: 'Example' }],
          page_index: 2,
          page_size: 50,
        },
      },
    }),
  }));

  assert.match(output.stdout, /Results: 1 row/);
  assert.match(output.stdout, /cloud-results\.json/);
  assert.deepEqual(readCloudRows(outputPath), [{ title: 'Example' }]);
});

test('runs diagnose summarizes failed status, error logs, and next commands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-diagnose-'));
  const outputPath = path.join(dir, 'diagnosis.json');

  const output = await captureConsole(() => runsCommand(['diagnose', 'RUNFAILED'], {
    apiKey: 'test-key',
    output: outputPath,
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v2/worker-runs/RUNFAILED') {
        return jsonResponse({ code: 0, data: { slug: 'RUNFAILED', status: 'failed', err_msg: 'Runtime exited', scraper_slug: 'WORKER', results: 0 } });
      }
      if (pathname === '/api/v2/worker-runs/RUNFAILED/log') {
        return jsonResponse({ code: 0, data: { list: [{ type: 'error', content: 'boom', timestamp: 1700000000 }] } });
      }
      if (pathname === '/api/v2/worker-runs/RUNFAILED/result') {
        return jsonResponse({ code: 0, data: { count: 0, list: [] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Status: Failed/);
  assert.match(output.stdout, /RUN_FAILED/);
  assert.match(output.stdout, /coreclaw runs rerun RUNFAILED/);
});

test('runs cost reports usage and traffic from the run detail', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-cost-'));
  const outputPath = path.join(dir, 'cost.json');

  const output = await captureConsole(() => runsCommand(['cost', 'RUNCOST'], {
    apiKey: 'test-key',
    output: outputPath,
    fetchImpl: fakeFetchFor({
      '/api/v2/worker-runs/RUNCOST': {
        code: 0,
        data: { slug: 'RUNCOST', status: 'failed', err_msg: 'Failed', usage: '0.12', traffic: 2048, results: 0, duration: 30 },
      },
    }),
  }));

  assert.match(output.stdout, /Usage: \$0.12/);
  assert.match(output.stdout, /2\.0 KB/);
});

test('runs collect bundles detail, logs, results, and export', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-collect-'));
  const jsonPath = path.join(dir, 'evidence.json');
  const markdownPath = path.join(dir, 'evidence.md');

  const output = await captureConsole(() => runsCommand(['collect', 'RUNCOLLECT'], {
    apiKey: 'test-key',
    output: jsonPath,
    markdown: markdownPath,
    pageSize: '5',
    format: 'json',
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v2/worker-runs/RUNCOLLECT') {
        return jsonResponse({ code: 0, data: { slug: 'RUNCOLLECT', status: 'succeeded', scraper_slug: 'WORKER', results: 3 } });
      }
      if (pathname === '/api/v2/worker-runs/RUNCOLLECT/log') {
        return jsonResponse({ code: 0, data: { list: [{ type: 'info', content: 'done', timestamp: 1700000000 }] } });
      }
      if (pathname === '/api/v2/worker-runs/RUNCOLLECT/result') {
        return jsonResponse({ code: 0, data: { count: 1, list: [{ title: 'row' }] } });
      }
      if (pathname === '/api/v2/worker-runs/RUNCOLLECT/result/export') {
        return jsonResponse({ code: 0, data: { download_url: 'https://signed.example.com/x.json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run evidence: RUNCOLLECT/);
  assert.match(output.stdout, /Export: https:\/\/signed\.example\.com\/x\.json/);
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
});

test('runs abort sends POST to v2 abort path', async () => {
  const calls = [];
  await captureConsole(() => runsCommand(['abort', 'RUN123'], {
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success' });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-runs/RUN123/abort');
  assert.equal(calls[0].request.method, 'POST');
});

test('runs rerun sends POST with callback_url to v2 rerun path', async () => {
  const calls = [];
  await captureConsole(() => runsCommand(['rerun', 'RUN123'], {
    apiKey: 'test-key',
    callbackUrl: 'https://example.com/webhook',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, data: { run_slug: 'RUN456' } });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-runs/RUN123/rerun');
  assert.deepEqual(JSON.parse(calls[0].request.body), { callback_url: 'https://example.com/webhook', is_async: true });
});

test('runs export requires download_url when download output is requested', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-export-missing-url-'));

  await assert.rejects(
    () => runsCommand(['export', 'RUN'], {
      apiKey: 'test-key',
      downloadOutput: path.join(dir, 'export.json'),
      fetchImpl: fakeFetchFor({
        '/api/v2/worker-runs/RUN/result/export': { code: 0, message: 'success', data: {} },
      }),
    }),
    (error) => error instanceof CliError && /did not include data\.download_url/.test(error.message),
  );
});

test('runs export rejects unsupported formats', async () => {
  await assert.rejects(
    () => runsCommand(['export', 'RUN'], {
      apiKey: 'test-key',
      format: 'pdf',
      fetchImpl: async () => jsonResponse({ code: 0, data: {} }),
    }),
    (error) => error instanceof CliError && /--format must be one of/.test(error.message),
  );
});

test('tasks create posts worker_id, title, input to v2 /api/v2/worker-tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tasks-create-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ keyword: 'coffee' }));
  const calls = [];

  const output = await captureConsole(() => tasksCommand(['create', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    title: 'Daily coffee',
    description: 'desc',
    scheduleType: '1',
    scheduleEnabled: '1',
    scheduleTime: '09:00',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, data: { slug: 'demo-task' } });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-tasks');
  assert.deepEqual(JSON.parse(calls[0].request.body), {
    worker_id: 'WORKER',
    title: 'Daily coffee',
    input: { keyword: 'coffee' },
    description: 'desc',
    schedule_type: 1,
    schedule_enabled: 1,
    schedule_time: '09:00',
  });
  assert.match(output.stdout, /Task created: demo-task/);
});

test('tasks get prints task detail via v2 GET /api/v2/worker-tasks/{id}', async () => {
  const output = await captureConsole(() => tasksCommand(['get', 'demo-task'], {
    apiKey: 'test-key',
    fetchImpl: fakeFetchFor({
      '/api/v2/worker-tasks/demo-task': {
        code: 0,
        data: { slug: 'demo-task', title: 'Daily coffee', worker_id: 'WORKER', version: 'v1', schedule_type: 1, schedule_enabled: 1 },
      },
    }),
  }));

  assert.match(output.stdout, /Task: demo-task/);
  assert.match(output.stdout, /Title: Daily coffee/);
  assert.match(output.stdout, /Worker: WORKER/);
});

test('tasks input put updates task input via v2 PUT /api/v2/worker-tasks/{id}/input', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tasks-input-put-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ keyword: 'tea' }));
  const calls = [];

  const output = await captureConsole(() => tasksCommand(['input', 'put', 'demo-task'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'v2',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success' });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-tasks/demo-task/input');
  assert.equal(calls[0].request.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].request.body), { input: { keyword: 'tea' }, version: 'v2' });
  assert.match(output.stdout, /Task input updated: demo-task/);
});

test('tasks delete sends DELETE to v2 path', async () => {
  const calls = [];
  await captureConsole(() => tasksCommand(['delete', 'demo-task'], {
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      return jsonResponse({ code: 0, message: 'success' });
    },
  }));

  assert.equal(calls[0].url, 'https://openapi.coreclaw.com/api/v2/worker-tasks/demo-task');
  assert.equal(calls[0].request.method, 'DELETE');
});

test('tasks run can wait and save results', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tasks-run-wait-'));
  const resultsPath = path.join(dir, 'task-results.json');
  const detailStatuses = ['running', 'succeeded'];

  const output = await captureConsole(() => tasksCommand(['run', 'TASK'], {
    apiKey: 'test-key',
    callbackUrl: 'https://example.com/webhook',
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    resultsOutput: resultsPath,
    sleepImpl: async () => {},
    fetchImpl: async (url, request) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v2/worker-tasks/TASK/runs') {
        assert.deepEqual(JSON.parse(request.body), { callback_url: 'https://example.com/webhook', is_async: true });
        return jsonResponse({ code: 0, data: { run_slug: 'TASK-RUN' } });
      }
      if (pathname === '/api/v2/worker-runs/TASK-RUN') {
        return jsonResponse({ code: 0, data: { slug: 'TASK-RUN', status: detailStatuses.shift(), results: 1 } });
      }
      if (pathname === '/api/v2/worker-runs/TASK-RUN/result') {
        return jsonResponse({ code: 0, data: { count: 1, list: [{ title: 'Task result' }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Task run started: TASK-RUN/);
  assert.match(output.stdout, /Run finished: Succeeded/);
  assert.deepEqual(readCloudRows(resultsPath), [{ title: 'Task result' }]);
});

function fakeFetchFor(responsesByPath) {
  return async (url) => {
    const { pathname } = new URL(url);
    const response = responsesByPath[pathname];
    if (!response) {
      throw new Error(`Unexpected URL: ${url}`);
    }
    return jsonResponse(response);
  };
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const stdout = [];
  const stderr = [];
  let result;
  console.log = (...args) => stdout.push(args.join(' '));
  console.error = (...args) => stderr.push(args.join(' '));
  console.warn = (...args) => stderr.push(args.join(' '));
  try {
    result = await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
  return {
    result,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}
