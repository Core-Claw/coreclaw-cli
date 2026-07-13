import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proveCommand } from '../src/commands/prove.js';
import { pollRunUntilTerminal } from '../src/commands/cloud-utils.js';
import { readCloudRows } from '../src/compare/rows.js';
import { CliError } from '../src/utils/errors.js';

test('proveCommand runs local preflight, cloud run, saves results, and compares', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-prove-'));
  const localRunDir = path.join(dir, '.coreclaw', 'runs', 'local-run');
  fs.mkdirSync(localRunDir, { recursive: true });
  const cloudInputPath = path.join(dir, 'cloud-input.json');
  fs.writeFileSync(cloudInputPath, JSON.stringify({
    parameters: {
      system: { cpus: 0.125, memory: 512, execute_limit_time_seconds: 1800, max_total_charge: 0, max_total_traffic: 0 },
      custom: { urls: [{ url: 'https://example.com' }] },
    },
  }));
  const calls = [];
  const compareCalls = [];

  const result = await proveCommand(dir, {
    scraperSlug: 'WORKER',
    cloudInput: cloudInputPath,
    version: 'auto',
    apiKey: 'test-key',
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (url.endsWith('/api/v2/workers/WORKER/runs')) {
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'CLOUD-RUN' } });
      }
      if (url.endsWith('/api/v2/workers/WORKER')) {
        return jsonResponse({ code: 0, message: 'success', data: { version: 'v1.2.3' } });
      }
      if (url.endsWith('/api/v2/worker-runs/CLOUD-RUN')) {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'CLOUD-RUN', status: 'succeeded', results: 1, usage: '0.01' } });
      }
      if (url.includes('/api/v2/worker-runs/CLOUD-RUN/result')) {
        return jsonResponse({ code: 0, message: 'success', data: { count: 1, list: [{ title: 'Example' }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    verifyImpl: async (projectPath, verifyOptions) => ({
      ok: true,
      project_path_seen: projectPath,
      verify_options_seen: verifyOptions,
      run_id: 'local-run',
      run_dir: localRunDir,
      result_count: 1,
      package_path: path.join(dir, 'worker.zip'),
    }),
    compareImpl: async (cloudPath, localPath, compareOptions) => {
      compareCalls.push({ cloudPath, localPath, compareOptions });
      return { ok: true, shared_count: 1, value_diff_count: 0 };
    },
    sleepImpl: async () => {},
  });

  assert.equal(result.local.run_id, 'local-run');
  assert.equal(result.cloud.run_slug, 'CLOUD-RUN');
  assert.equal(result.cloud.version, 'v1.2.3');
  assert.equal(result.cloud.detail.status, 'succeeded');
  assert.deepEqual(readCloudRows(result.cloud_results_path), [{ title: 'Example' }]);
  assert.equal(compareCalls.length, 1);
  assert.equal(compareCalls[0].cloudPath, result.cloud_results_path);
  assert.equal(compareCalls[0].localPath, localRunDir);
  assert.equal(compareCalls[0].compareOptions.output, path.join(localRunDir, 'cloud-comparison.json'));
  assert.equal(calls.some((call) => call.url.includes('/api/v2/worker-runs/CLOUD-RUN/result')), true);
});

test('proveCommand can write release-ready run evidence and dossier after comparison passes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-prove-release-'));
  const localRunDir = path.join(dir, '.coreclaw', 'runs', 'local-run');
  fs.mkdirSync(localRunDir, { recursive: true });
  const cloudInputPath = path.join(dir, 'cloud-input.json');
  const runEvidenceOutput = path.join(dir, 'run-evidence.json');
  const releaseOutput = path.join(dir, 'release-dossier.json');
  fs.writeFileSync(cloudInputPath, JSON.stringify({ parameters: { custom: { url: 'https://example.com' } } }));
  const collectCalls = [];
  const releaseCalls = [];

  const result = await proveCommand(dir, {
    scraperSlug: 'WORKER',
    cloudInput: cloudInputPath,
    version: 'v1.0.0',
    apiKey: 'test-key',
    runEvidenceOutput,
    releaseOutput,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/v2/workers/WORKER/runs')) {
        return jsonResponse({ code: 0, message: 'success', data: { run_slug: 'CLOUD-RUN' } });
      }
      if (url.endsWith('/api/v2/worker-runs/CLOUD-RUN')) {
        return jsonResponse({ code: 0, message: 'success', data: { slug: 'CLOUD-RUN', status: 'succeeded', results: 1, usage: '0.01' } });
      }
      if (url.includes('/api/v2/worker-runs/CLOUD-RUN/result')) {
        return jsonResponse({ code: 0, message: 'success', data: { count: 1, list: [{ title: 'Example' }] } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
    verifyImpl: async () => ({
      ok: true,
      run_id: 'local-run',
      run_dir: localRunDir,
      result_count: 1,
      package_path: path.join(dir, 'worker.zip'),
    }),
    compareImpl: async (_cloudPath, _localPath, compareOptions) => ({
      ok: true,
      summary: { ok: true, counts: { shared: 1, only_cloud: 0, only_local: 0, value_diffs: 0 } },
      output_seen: compareOptions.output,
    }),
    collectImpl: async (positionals, collectOptions) => {
      collectCalls.push({ positionals, collectOptions });
      fs.writeFileSync(collectOptions.output, JSON.stringify({ run_slug: positionals[1] }));
      return {
        run_slug: positionals[1],
        files: { json: collectOptions.output },
        diagnosis: { status: 'succeeded', status_label: 'Succeeded', issues: [] },
        cost: { usage_usd: '0.01', traffic_bytes: 10 },
      };
    },
    releaseImpl: async (positionals, releaseOptions) => {
      releaseCalls.push({ positionals, releaseOptions });
      fs.writeFileSync(releaseOptions.output, JSON.stringify({ ready: true, run_evidence: releaseOptions.runEvidence }));
      return {
        readiness: { ok: true },
        cloud: { run_slug: 'CLOUD-RUN' },
      };
    },
    sleepImpl: async () => {},
  });

  assert.equal(collectCalls.length, 1);
  assert.deepEqual(collectCalls[0].positionals, ['collect', 'CLOUD-RUN']);
  assert.equal(collectCalls[0].collectOptions.output, runEvidenceOutput);
  assert.equal(collectCalls[0].collectOptions.format, 'json');
  assert.equal(collectCalls[0].collectOptions.pageSize, 100);
  assert.equal(releaseCalls.length, 1);
  assert.deepEqual(releaseCalls[0].positionals, ['dossier', dir]);
  assert.equal(releaseCalls[0].releaseOptions.package, path.join(dir, 'worker.zip'));
  assert.equal(releaseCalls[0].releaseOptions.cloudRun, 'CLOUD-RUN');
  assert.equal(releaseCalls[0].releaseOptions.runEvidence, runEvidenceOutput);
  assert.equal(releaseCalls[0].releaseOptions.compareReport, path.join(localRunDir, 'cloud-comparison.json'));
  assert.equal(releaseCalls[0].releaseOptions.output, releaseOutput);
  assert.equal(result.run_evidence_path, runEvidenceOutput);
  assert.equal(result.release_dossier_path, releaseOutput);
  assert.equal(result.release_dossier.readiness.ok, true);
});

test('proveCommand requires scraper slug and cloud input', async () => {
  await assert.rejects(
    () => proveCommand('.', { cloudInput: 'cloud-input.json' }),
    (error) => error instanceof CliError && /--scraper-slug is required/.test(error.message),
  );
  await assert.rejects(
    () => proveCommand('.', { scraperSlug: 'WORKER' }),
    (error) => error instanceof CliError && /--cloud-input is required/.test(error.message),
  );
});

test('pollRunUntilTerminal times out when the cloud run stays non-terminal', async () => {
  const client = {
    getWorkerRun: async () => ({ code: 0, message: 'success', data: { slug: 'RUN', status: 'running' } }),
  };

  await assert.rejects(
    () => pollRunUntilTerminal(client, 'RUN', {
      timeoutMs: 1,
      pollIntervalMs: 1,
      sleepImpl: async () => {},
      nowImpl: makeClock([0, 2]),
    }),
    (error) => error instanceof CliError && /Timed out waiting for CoreClaw run RUN/.test(error.message),
  );
});

function makeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function jsonResponse(value, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(value),
  };
}
