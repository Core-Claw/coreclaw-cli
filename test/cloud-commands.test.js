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

test('account info prints balance and traffic summary', async () => {
  const output = await captureConsole(() => accountCommand(['info'], {
    apiKey: 'test-key',
    fetchImpl: fakeFetchFor({
      '/api/v1/account/info': { code: 0, message: 'success', data: { balance: '10.00', traffic: '1000' } },
    }),
  }));

  assert.match(output.stdout, /CoreClaw account/);
  assert.match(output.stdout, /Balance: 10.00/);
  assert.match(output.stdout, /Traffic: 1000/);
  assert.equal(output.result.data.balance, '10.00');
});

test('workers detail prints version and required custom fields', async () => {
  const output = await captureConsole(() => workersCommand(['detail', 'WORKER'], {
    fetchImpl: fakeFetchFor({
      '/api/scraper': {
        code: 0,
        message: 'success',
        data: {
          version: 'v1.0.5',
          parameters: {
            system: { cpus: 0.125, memory: 512, execute_limit_time_seconds: 1800 },
            custom: { properties: [{ name: 'urls', type: 'array', title: 'URLs', required: true }] },
          },
        },
      },
    }),
  }));

  assert.match(output.stdout, /Worker WORKER/);
  assert.match(output.stdout, /Version: v1.0.5/);
  assert.match(output.stdout, /urls \(array, required\)/);
});

test('workers run uses version from worker detail when version is auto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    parameters: {
      system: { cpus: 0.125, memory: 512, execute_limit_time_seconds: 1800, max_total_charge: 0, max_total_traffic: 0 },
      custom: { urls: [{ url: 'https://example.com' }] },
    },
  }));
  const calls = [];

  const output = await captureConsole(() => workersCommand(['run', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'auto',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url.includes('/api/scraper?')) {
        return jsonResponse({ code: 0, message: 'success', data: { version: 'v2.0.0' } });
      }
      return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUN123' } });
    },
  }));

  assert.match(output.stdout, /Run started: RUN123/);
  const runRequest = calls.find((call) => call.url.endsWith('/api/v1/scraper/run'));
  assert.deepEqual(JSON.parse(runRequest.request.body), {
    scraper_slug: 'WORKER',
    version: 'v2.0.0',
    input: {
      parameters: {
        system: { cpus: 0.125, memory: 512, execute_limit_time_seconds: 1800, max_total_charge: 0, max_total_traffic: 0 },
        custom: { urls: [{ url: 'https://example.com' }] },
      },
    },
    is_async: true,
  });
});

test('workers run waits for cloud completion and writes results when requested', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-wait-'));
  const inputPath = path.join(dir, 'input.json');
  const resultsPath = path.join(dir, 'cloud-results.json');
  fs.writeFileSync(inputPath, JSON.stringify({ parameters: { custom: { urls: ['https://example.com'] } } }));
  const detailStatuses = [2, 3];

  const output = await captureConsole(() => workersCommand(['run', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'auto',
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    resultsOutput: resultsPath,
    sleepImpl: async () => {},
    fetchImpl: async (url, request) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/scraper') {
        return jsonResponse({ code: 0, message: 'success', data: { version: 'v2.0.0' } });
      }
      if (pathname === '/api/v1/scraper/run') {
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUN123' } });
      }
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'RUN123', status: detailStatuses.shift() } });
      }
      if (pathname === '/api/v1/run/result/list') {
        assert.deepEqual(JSON.parse(request.body), { run_slug: 'RUN123', page_index: 1, page_size: 100 });
        return jsonResponse({
          code: 0,
          message: 'success',
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
  assert.equal(output.result.detail.status, 3);
  assert.equal(output.result.results_path, resultsPath);
});

test('workers run waits and collects run evidence when requested', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-evidence-'));
  const inputPath = path.join(dir, 'input.json');
  const evidencePath = path.join(dir, 'run-evidence.json');
  fs.writeFileSync(inputPath, JSON.stringify({ parameters: { custom: { urls: ['https://example.com'] } } }));
  const collectCalls = [];
  const detailStatuses = [2, 3];

  const output = await captureConsole(() => workersCommand(['run', 'WORKER'], {
    apiKey: 'test-key',
    input: inputPath,
    version: 'v2.0.0',
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    runEvidenceOutput: evidencePath,
    sleepImpl: async () => {},
    collectImpl: async (positionals, collectOptions) => {
      collectCalls.push({ positionals, collectOptions });
      fs.writeFileSync(collectOptions.output, JSON.stringify({ run_slug: positionals[1] }));
      return { run_slug: positionals[1], files: { json: collectOptions.output } };
    },
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v1/scraper/run') {
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUN123' } });
      }
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'RUN123', status: detailStatuses.shift(), results: 1 } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run started: RUN123/);
  assert.match(output.stdout, /Waiting for cloud run: RUN123/);
  assert.match(output.stdout, /Run finished: Succeeded/);
  assert.match(output.stdout, /Run evidence: .*run-evidence\.json/);
  assert.equal(collectCalls.length, 1);
  assert.deepEqual(collectCalls[0].positionals, ['collect', 'RUN123']);
  assert.equal(collectCalls[0].collectOptions.output, evidencePath);
  assert.equal(collectCalls[0].collectOptions.pageSize, 100);
  assert.equal(output.result.detail.status, 3);
  assert.equal(output.result.run_evidence_path, evidencePath);
});

test('workers run wait fails when the cloud run does not succeed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-workers-run-fail-'));
  const inputPath = path.join(dir, 'input.json');
  fs.writeFileSync(inputPath, JSON.stringify({ parameters: { custom: { urls: ['https://example.com'] } } }));

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
        if (pathname === '/api/v1/scraper/run') {
          return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'RUNFAILED' } });
        }
        if (pathname === '/api/v1/run/detail') {
          return jsonResponse({ code: 0, message: 'success', data: { slug: 'RUNFAILED', status: 4 } });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    }),
    (error) => error instanceof CliError
      && /ended with status 4/.test(error.message)
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
      '/api/v1/run/result/list': {
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

test('runs diagnose summarizes status, logs, results, and next commands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-diagnose-'));
  const outputPath = path.join(dir, 'diagnosis.json');
  const calls = [];

  const output = await captureConsole(() => runsCommand(['diagnose', 'RUNFAILED'], {
    apiKey: 'test-key',
    output: outputPath,
    pageSize: '3',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      const { pathname } = new URL(url);
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            slug: 'RUNFAILED',
            status: 4,
            err_msg: 'Browser timed out',
            scraper_slug: 'WORKER',
            scraper_title: 'Worker title',
            version: 'v1.2.3',
            results: 0,
            usage: '0.10',
            traffic: '20',
          },
        });
      }
      if (pathname === '/api/v1/run/last/log') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            all_logs_url: 'https://example.com/all.log',
            list: [
              { timestamp: 1770000000, type: 2, content: 'Starting worker' },
              { timestamp: 1770000001, type: 4, content: 'Timeout while opening page' },
            ],
          },
        });
      }
      if (pathname === '/api/v1/run/result/list') {
        assert.deepEqual(JSON.parse(request.body), { run_slug: 'RUNFAILED', page_index: 1, page_size: 3 });
        return jsonResponse({ code: 0, message: 'success', data: { count: 0, list: [] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run diagnosis: RUNFAILED/);
  assert.match(output.stdout, /Status: Failed \(4\)/);
  assert.match(output.stdout, /Error: Browser timed out/);
  assert.match(output.stdout, /Recent error logs:/);
  assert.match(output.stdout, /Timeout while opening page/);
  assert.match(output.stdout, /coreclaw runs logs RUNFAILED/);
  assert.match(output.stdout, /coreclaw runs rerun RUNFAILED --callback-url https:\/\/example\.com\/webhook/);
  assert.match(output.stdout, /Wrote: .*diagnosis\.json/);

  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(report.run_slug, 'RUNFAILED');
  assert.equal(report.status_label, 'Failed');
  assert.equal(report.results.count, 0);
  assert.equal(report.logs.error_count, 1);
  assert.equal(report.issues.some((issue) => issue.message.includes('Browser timed out')), true);
  assert.equal(report.next_commands.includes('coreclaw runs logs RUNFAILED'), true);
  assert.equal(output.result.issues.length, report.issues.length);
  assert.equal(calls.length, 3);
});

test('runs diagnose json-output prints the machine-readable report', async () => {
  const output = await captureConsole(() => runsCommand(['diagnose', 'RUNOK'], {
    apiKey: 'test-key',
    jsonOutput: true,
    fetchImpl: fakeFetchFor({
      '/api/v1/run/detail': {
        code: 0,
        message: 'success',
        data: { slug: 'RUNOK', status: 3, scraper_slug: 'WORKER', version: 'v1.0.0', results: 2 },
      },
      '/api/v1/run/last/log': {
        code: 0,
        message: 'success',
        data: { list: [{ timestamp: 1770000000, type: 2, content: 'Done' }] },
      },
      '/api/v1/run/result/list': {
        code: 0,
        message: 'success',
        data: { count: 2, list: [{ title: 'A' }, { title: 'B' }] },
      },
    }),
  }));

  const report = JSON.parse(output.stdout);
  assert.equal(report.run_slug, 'RUNOK');
  assert.equal(report.status_label, 'Succeeded');
  assert.equal(report.results.sample_count, 2);
  assert.equal(report.next_commands.includes('coreclaw runs results RUNOK --output cloud-results.json'), true);
});

test('runs diagnose continues when optional logs or results calls fail', async () => {
  const output = await captureConsole(() => runsCommand(['diagnose', 'RUNPARTIAL'], {
    apiKey: 'test-key',
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: { slug: 'RUNPARTIAL', status: 4, err_msg: 'Runtime exited', scraper_slug: 'WORKER', results: 0 },
        });
      }
      if (pathname === '/api/v1/run/last/log') {
        return jsonResponse({ code: 1001, message: 'Logs are not ready', data: null });
      }
      if (pathname === '/api/v1/run/result/list') {
        return jsonResponse({ code: 1002, message: 'Results are not available', data: null });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run diagnosis: RUNPARTIAL/);
  assert.match(output.stdout, /Optional CoreClaw API data unavailable/);
  assert.equal(output.result.optional_errors.length, 2);
  assert.equal(output.result.logs.count, 0);
  assert.equal(output.result.results.count, 0);
  assert.equal(output.result.issues.some((issue) => issue.code === 'OPTIONAL_API_UNAVAILABLE'), true);
});

test('runs cost reports documented usage and traffic fields without inventing a breakdown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-cost-'));
  const outputPath = path.join(dir, 'cost.json');

  const output = await captureConsole(() => runsCommand(['cost', 'RUNCOST'], {
    apiKey: 'test-key',
    output: outputPath,
    fetchImpl: fakeFetchFor({
      '/api/v1/run/detail': {
        code: 0,
        message: 'success',
        data: {
          slug: 'RUNCOST',
          status: 3,
          scraper_slug: 'WORKER',
          scraper_title: 'Worker title',
          version: 'v1.0.0',
          results: 12,
          usage: '0.0217',
          traffic: 23108,
          duration: 7,
          origin: 'api',
          started_at: 1773305309,
          finished_at: 1773305316,
        },
      },
    }),
  }));

  assert.match(output.stdout, /Run cost: RUNCOST/);
  assert.match(output.stdout, /Usage: \$0\.0217/);
  assert.match(output.stdout, /Traffic: 23 KB \(23108 bytes\)/);
  assert.match(output.stdout, /Duration: 7s/);
  assert.match(output.stdout, /Cost breakdown: not available from current CoreClaw API/);
  assert.match(output.stdout, /Wrote: .*cost\.json/);

  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(report.run_slug, 'RUNCOST');
  assert.equal(report.usage_usd, '0.0217');
  assert.equal(report.traffic_bytes, 23108);
  assert.equal(report.traffic_human, '23 KB');
  assert.equal(report.cost_breakdown_available, false);
  assert.equal(report.platform_gap, 'CoreClaw Run Detail exposes aggregate usage and traffic only; CPU, memory, proxy, browser, and CAPTCHA cost breakdowns require a future platform API.');
  assert.equal(output.result.usage_usd, '0.0217');
});

test('runs cost json-output prints machine-readable usage report', async () => {
  const output = await captureConsole(() => runsCommand(['cost', 'RUNCOST'], {
    apiKey: 'test-key',
    jsonOutput: true,
    fetchImpl: fakeFetchFor({
      '/api/v1/run/detail': {
        code: 0,
        message: 'success',
        data: { slug: 'RUNCOST', status: 4, err_msg: 'Failed', usage: '0', traffic: 0, results: 0 },
      },
    }),
  }));

  const report = JSON.parse(output.stdout);
  assert.equal(report.run_slug, 'RUNCOST');
  assert.equal(report.status_label, 'Failed');
  assert.equal(report.usage_usd, '0');
  assert.equal(report.traffic_human, '0 B');
  assert.equal(report.next_commands.includes('coreclaw runs detail RUNCOST'), true);
});

test('runs collect writes a run evidence bundle with diagnosis, cost, results, logs, and export data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-collect-'));
  const outputPath = path.join(dir, 'run-evidence.json');
  const markdownPath = path.join(dir, 'run-evidence.md');
  const downloadPath = path.join(dir, 'run-export.json');
  const calls = [];

  const output = await captureConsole(() => runsCommand(['collect', 'RUNCOLLECT'], {
    apiKey: 'test-key',
    output: outputPath,
    markdown: markdownPath,
    downloadOutput: downloadPath,
    pageSize: '5',
    format: 'json',
    fetchImpl: async (url, request = {}) => {
      calls.push({ url, request });
      const { pathname } = new URL(url);
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            slug: 'RUNCOLLECT',
            status: 3,
            scraper_slug: 'WORKER',
            scraper_title: 'Worker title',
            version: 'v1.0.0',
            results: 2,
            usage: '0.031',
            traffic: 4096,
            duration: 9,
          },
        });
      }
      if (pathname === '/api/v1/run/last/log') {
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            all_logs_url: 'https://example.com/all.log',
            list: [
              { timestamp: 1770000000, type: 2, content: 'Started' },
              { timestamp: 1770000001, type: 2, content: 'Finished' },
            ],
          },
        });
      }
      if (pathname === '/api/v1/run/result/list') {
        assert.deepEqual(JSON.parse(request.body), { run_slug: 'RUNCOLLECT', page_index: 1, page_size: 5 });
        return jsonResponse({
          code: 0,
          message: 'success',
          data: {
            count: 2,
            headers: [{ key: 'title', label: 'title', format: 'text' }],
            list: [{ title: 'A' }, { title: 'B' }],
          },
        });
      }
      if (pathname === '/api/v1/run/result/export') {
        assert.deepEqual(JSON.parse(request.body), {
          run_slug: 'RUNCOLLECT',
          filter_keys: [],
          format: 'json',
        });
        return jsonResponse({ code: 0, message: 'success', data: { download_url: 'https://example.com/export.json' } });
      }
      if (url === 'https://example.com/export.json') {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from('[{"title":"A"},{"title":"B"}]\n', 'utf8'),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Run evidence: RUNCOLLECT/);
  assert.match(output.stdout, /Status: Succeeded \(3\)/);
  assert.match(output.stdout, /Results: 2/);
  assert.match(output.stdout, /Export: https:\/\/example\.com\/export\.json/);
  assert.match(output.stdout, /Downloaded: .*run-export\.json/);
  assert.match(output.stdout, /Wrote: .*run-evidence\.json/);
  assert.match(output.stdout, /Markdown: .*run-evidence\.md/);

  const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(report.run_slug, 'RUNCOLLECT');
  assert.equal(report.diagnosis.status_label, 'Succeeded');
  assert.equal(report.diagnosis.results.sample_count, 2);
  assert.equal(report.cost.traffic_human, '4.1 KB');
  assert.equal(report.results.response.data.count, 2);
  assert.equal(report.logs.response.data.list.length, 2);
  assert.equal(report.export.response.data.download_url, 'https://example.com/export.json');
  assert.equal(report.export.download_path, downloadPath);
  assert.equal(output.result.files.json, outputPath);
  assert.equal(output.result.files.markdown, markdownPath);
  assert.equal(fs.readFileSync(downloadPath, 'utf8'), '[{"title":"A"},{"title":"B"}]\n');

  const markdown = fs.readFileSync(markdownPath, 'utf8');
  assert.match(markdown, /^# CoreClaw run evidence/m);
  assert.match(markdown, /RUNCOLLECT/);
  assert.match(markdown, /Succeeded/);
  assert.equal(calls.length, 5);
});

test('runs export parses filter keys and prints download url', async () => {
  const output = await captureConsole(() => runsCommand(['export', 'RUN'], {
    apiKey: 'test-key',
    format: 'json',
    filterKeys: 'title,url',
    fetchImpl: async (url, request) => {
      assert.deepEqual(JSON.parse(request.body), {
        run_slug: 'RUN',
        filter_keys: ['title', 'url'],
        format: 'json',
      });
      return jsonResponse({ code: 0, message: 'success', data: { download_url: 'https://example.com/export.json' } });
    },
  }));

  assert.match(output.stdout, /https:\/\/example\.com\/export\.json/);
});

test('runs export downloads returned export file without sending API key to signed URL', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-export-'));
  const downloadPath = path.join(dir, 'export.json');
  const calls = [];

  const output = await captureConsole(() => runsCommand(['export', 'RUN'], {
    apiKey: 'test-key',
    format: 'json',
    downloadOutput: downloadPath,
    fetchImpl: async (url, request = {}) => {
      calls.push({ url, request });
      if (url.endsWith('/api/v1/run/result/export')) {
        return jsonResponse({ code: 0, message: 'success', data: { download_url: 'https://example.com/export.json' } });
      }
      if (url === 'https://example.com/export.json') {
        assert.equal(request.headers?.['api-key'], undefined);
        const bytes = Buffer.from('[{"title":"Downloaded"}]\n', 'utf8');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.equal(fs.readFileSync(downloadPath, 'utf8'), '[{"title":"Downloaded"}]\n');
  assert.match(output.stdout, /Downloaded: .*export\.json/);
  assert.equal(output.result.download_path, downloadPath);
  assert.equal(calls.length, 2);
});

test('runs export requires download_url when download output is requested', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-runs-export-missing-url-'));

  await assert.rejects(
    () => runsCommand(['export', 'RUN'], {
      apiKey: 'test-key',
      downloadOutput: path.join(dir, 'export.json'),
      fetchImpl: fakeFetchFor({
        '/api/v1/run/result/export': { code: 0, message: 'success', data: {} },
      }),
    }),
    (error) => error instanceof CliError && /did not include data\.download_url/.test(error.message),
  );
});

test('tasks run requires callback URL from the documented API contract', async () => {
  await assert.rejects(
    () => tasksCommand(['run', 'TASK'], { apiKey: 'test-key', fetchImpl: async () => jsonResponse({ code: 0 }) }),
    (error) => error instanceof CliError && /--callback-url is required/.test(error.message),
  );
});

test('tasks run can wait, save results, and collect run evidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-tasks-run-wait-'));
  const resultsPath = path.join(dir, 'task-results.json');
  const evidencePath = path.join(dir, 'task-evidence.json');
  const collectCalls = [];
  const detailStatuses = [2, 3];

  const output = await captureConsole(() => tasksCommand(['run', 'TASK'], {
    apiKey: 'test-key',
    callbackUrl: 'https://example.com/webhook',
    wait: true,
    waitTimeout: '1s',
    pollInterval: '1ms',
    resultsOutput: resultsPath,
    runEvidenceOutput: evidencePath,
    sleepImpl: async () => {},
    collectImpl: async (positionals, collectOptions) => {
      collectCalls.push({ positionals, collectOptions });
      fs.writeFileSync(collectOptions.output, JSON.stringify({ run_slug: positionals[1] }));
      return { run_slug: positionals[1], files: { json: collectOptions.output } };
    },
    fetchImpl: async (url, request) => {
      const { pathname } = new URL(url);
      if (pathname === '/api/v1/task/run') {
        assert.deepEqual(JSON.parse(request.body), {
          task_slug: 'TASK',
          callback_url: 'https://example.com/webhook',
        });
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'TASK-RUN' } });
      }
      if (pathname === '/api/v1/run/detail') {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'TASK-RUN', status: detailStatuses.shift(), results: 1 } });
      }
      if (pathname === '/api/v1/run/result/list') {
        assert.deepEqual(JSON.parse(request.body), { run_slug: 'TASK-RUN', page_index: 1, page_size: 100 });
        return jsonResponse({ code: 0, message: 'success', data: { count: 1, list: [{ title: 'Task result' }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  }));

  assert.match(output.stdout, /Task run started: TASK-RUN/);
  assert.match(output.stdout, /Waiting for task run: TASK-RUN/);
  assert.match(output.stdout, /Run finished: Succeeded/);
  assert.match(output.stdout, /Results: .*task-results\.json/);
  assert.match(output.stdout, /Run evidence: .*task-evidence\.json/);
  assert.deepEqual(readCloudRows(resultsPath), [{ title: 'Task result' }]);
  assert.equal(collectCalls.length, 1);
  assert.deepEqual(collectCalls[0].positionals, ['collect', 'TASK-RUN']);
  assert.equal(collectCalls[0].collectOptions.output, evidencePath);
  assert.equal(output.result.detail.status, 3);
  assert.equal(output.result.results_path, resultsPath);
  assert.equal(output.result.run_evidence_path, evidencePath);
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
