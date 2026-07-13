import { spawnSync } from 'node:child_process';
import {
  createClientFromOptions,
  parseDurationMs,
  parsePositiveInteger,
  pollRunUntilTerminal,
  readInputJson,
  statusLabel,
  writeJsonOutput,
} from './cloud-utils.js';
import { runsCommand } from './runs.js';
import { resolveBrowserEndpoints } from '../runtime/env.js';
import { splitCommandLine } from '../runtime/executor.js';
import { CliError } from '../utils/errors.js';

export async function doctorCommand(options = {}) {
  console.log('CoreClaw CLI doctor');
  const failedChecks = [];
  for (const check of buildChecks(options)) {
    const result = printCheck(check);
    if (!result.ok) {
      failedChecks.push(check.label);
    }
  }
  console.log('[INFO] Local runtime gRPC endpoint: 127.0.0.1:20086');
  const browser = await checkLocalChrome(options);
  if (browser.discoveredLocalChrome) {
    console.log(`[ OK ] Chrome CDP: ChromeWs=${browser.chromeWs}`);
    console.log(`[ OK ] Chrome HTTP: ChromeHttp=${browser.chromeHttp}`);
  } else {
    console.log(`[WARN] Chrome CDP: not detected at http://${options.localChromeHost ?? '127.0.0.1:9222'}/json/version`);
    console.log(`[INFO] ChromeWs fallback: ${browser.chromeWs}`);
    console.log(`[INFO] ChromeHttp fallback: ${browser.chromeHttp}`);
  }
  console.log('[INFO] PROXY_AUTH and PROXY_DOMAIN are disabled by default; use --cloud-proxy or explicit proxy options to emulate cloud proxy variables');
  console.log('[INFO] LightpandaDomain is disabled by default; use --lightpanda-domain or --lightpanda-shim for Lightpanda workers');
  if (options.cloud) {
    await runCloudSmoke(options);
  }
  if (options.strict && failedChecks.length > 0) {
    throw new CliError(`doctor --strict failed: missing or unusable tool(s): ${failedChecks.join(', ')}`);
  }
}

export async function checkLocalChrome(options = {}) {
  return await resolveBrowserEndpoints({
    baseEnv: {},
    localChromeHost: options.localChromeHost ?? '127.0.0.1:9222',
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}

export function buildChecks(options = {}) {
  const [pythonCommand, pythonArgs] = splitCommandLine(options.python ?? 'python', '--python');
  const [goCommand, goArgs] = splitCommandLine(options.go ?? 'go', '--go');
  const [nodeCommand, nodeArgs] = splitCommandLine(options.node ?? 'node', '--node');
  return [
    { label: 'node', command: nodeCommand, args: [...nodeArgs, '--version'] },
    { label: 'npm', ...platformCheck('npm', ['--version']) },
    { label: options.python ?? 'python', command: pythonCommand, args: [...pythonArgs, '--version'] },
    { label: `${options.python ?? 'python'} pip`, command: pythonCommand, args: [...pythonArgs, '-m', 'pip', '--version'] },
    { label: options.go ?? 'go', command: goCommand, args: [...goArgs, 'version'] },
  ];
}

function printCheck(check) {
  const result = runToolCheck(check);
  if (result.ok) {
    console.log(`[ OK ] ${check.label}: ${result.output}`);
    return result;
  }
  console.log(`[MISS] ${check.label}: ${result.output}`);
  return result;
}

export function runToolCheck({ command, args }) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true });
  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.status !== 0) {
    return { ok: false, output: output || `exit code ${result.status}` };
  }
  return { ok: true, output };
}

async function runCloudSmoke(options = {}) {
  console.log('');
  console.log('CoreClaw cloud smoke');
  const client = createClientFromOptions(options);
  const account = await client.getAccount();
  console.log(`[ OK ] CoreClaw account: balance=${account.data?.balance ?? '-'}`);

  const scraperSlug = options.scraperSlug;
  let version = options.version;
  if (scraperSlug) {
    const detail = await client.getWorker(scraperSlug);
    version = resolveSmokeVersion(detail, version, scraperSlug);
    let customProperties = [];
    try {
      const schema = await client.getWorkerInputSchema(scraperSlug);
      customProperties = schema?.data?.properties ?? [];
    } catch {
      // input-schema is best-effort; some workers may not expose it.
    }
    const requiredCount = customProperties.filter((property) => property.required).length;
    console.log(`[ OK ] Worker detail: ${scraperSlug} version=${version} required_custom=${requiredCount}`);
  } else {
    console.log('[INFO] Worker detail: skipped; pass --scraper-slug <scraper_slug> to check a public Worker descriptor.');
  }

  if (!options.cloudInput) {
    console.log('[INFO] Cloud run: skipped; pass --cloud-input request.json to start an explicit smoke run.');
    return { account };
  }
  if (!scraperSlug) {
    throw new CliError('doctor --cloud with --cloud-input requires --scraper-slug.');
  }

  const input = readInputJson(options.cloudInput, '--cloud-input');
  const runResponse = await client.runWorker(scraperSlug, {
    version,
    input,
    callbackUrl: options.callbackUrl,
    isAsync: true,
  });
  const runSlug = runResponse.data?.run_slug;
  if (!runSlug) {
    throw new CliError('CoreClaw cloud smoke run response did not include data.run_slug.');
  }
  console.log(`Cloud run started: ${runSlug}`);

  let detail = null;
  if (options.wait) {
    detail = await pollRunUntilTerminal(client, runSlug, {
      timeoutMs: parseDurationMs(options.waitTimeout ?? '10m', '--wait-timeout'),
      pollIntervalMs: parseDurationMs(options.pollInterval ?? '5s', '--poll-interval'),
      sleepImpl: options.sleepImpl,
      nowImpl: options.nowImpl,
    });
    const status = String(detail.status ?? '').toLowerCase();
    console.log(`Cloud run finished: ${statusLabel(status)}`);
    if (status !== 'succeeded') {
      throw new CliError(`CoreClaw cloud smoke run ${runSlug} ended with status ${status}. Check logs with "coreclaw runs logs ${runSlug}".`);
    }
  }

  let results = null;
  if (options.resultsOutput) {
    results = await client.listWorkerRunResults(runSlug, {
      offset: parsePositiveInteger(options.pageIndex, 1, '--page-index') - 1,
      limit: parsePositiveInteger(options.pageSize, 100, '--page-size'),
    });
    const resultsPath = writeJsonOutput(options.resultsOutput, results);
    console.log(`Cloud results: ${resultsPath}`);
  }

  let runEvidence = null;
  if (options.runEvidenceOutput) {
    const collectImpl = options.collectImpl ?? runsCommand;
    runEvidence = await collectImpl(['collect', runSlug], {
      ...options,
      output: options.runEvidenceOutput,
      format: options.format ?? 'json',
      pageIndex: options.pageIndex,
      pageSize: parsePositiveInteger(options.pageSize, 100, '--page-size'),
      jsonOutput: false,
    });
    console.log(`Run evidence: ${options.runEvidenceOutput}`);
  }

  return {
    account,
    run: runResponse,
    detail,
    results,
    runEvidence,
  };
}

function resolveSmokeVersion(detail, version, scraperSlug) {
  if (!version || version === 'auto' || version === 'latest') {
    const resolved = detail.data?.version;
    if (!resolved) {
      throw new CliError(`Cannot resolve latest version for Worker ${scraperSlug}. Pass --version explicitly.`);
    }
    return resolved;
  }
  return version;
}

function platformCheck(command, args) {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', `${command}.cmd`, ...args] };
  }
  return { command, args };
}
