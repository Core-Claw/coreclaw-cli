import {
  createClientFromOptions,
  parsePositiveInteger,
  pollRunUntilTerminal,
  printOrReturn,
  readInputJson,
  requireArg,
  requireSubcommand,
  statusLabel,
  writeJsonOutput,
  parseDurationMs,
} from './cloud-utils.js';
import { runsCommand } from './runs.js';
import { CliError } from '../utils/errors.js';

export async function workersCommand(positionals = [], options = {}) {
  const subcommand = requireSubcommand(positionals, 'workers', ['search', 'detail', 'run']);
  switch (subcommand) {
    case 'search':
      return searchWorkers(positionals.slice(1), options);
    case 'detail':
      return detailWorker(positionals.slice(1), options);
    case 'run':
      return runWorker(positionals.slice(1), options);
    default:
      return null;
  }
}

async function searchWorkers(args, options) {
  const search = args.join(' ') || options.search;
  requireArg(search, 'workers search requires a non-empty search query.');
  const client = createClientFromOptions(options);
  const response = await client.searchWorkers({
    search,
    limit: parsePositiveInteger(options.limit, 10, '--limit'),
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const workers = response.data?.scraper ?? [];
  console.log(`CoreClaw Workers: ${workers.length}`);
  for (const worker of workers) {
    console.log(`${worker.slug ?? '-'}  ${worker.title ?? '-'}`);
    if (worker.description) {
      console.log(`  ${worker.description}`);
    }
  }
  return response;
}

async function detailWorker(args, options) {
  const scraperSlug = requireArg(args[0], 'workers detail requires <scraper_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.workerDetail(scraperSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  printWorkerDetail(scraperSlug, response.data ?? {});
  return response;
}

async function runWorker(args, options) {
  const scraperSlug = requireArg(args[0], 'workers run requires <scraper_slug>.');
  const client = createClientFromOptions(options);
  const input = readInputJson(options.input);
  const version = await resolveWorkerVersion(client, scraperSlug, options.version);
  const response = await client.runWorker({
    scraperSlug,
    version,
    input,
    callbackUrl: options.callbackUrl,
    isAsync: options.sync ? false : true,
  });
  const runSlug = response.data?.run_slug;
  let result = response;
  const humanOutput = !options.jsonOutput;

  if (humanOutput) {
    console.log(`Run started: ${runSlug ?? '-'}`);
    console.log(`Worker: ${scraperSlug}`);
    console.log(`Version: ${version}`);
    console.log(`Mode: ${options.sync ? 'sync' : 'async'}`);
  }

  if (options.wait) {
    if (!runSlug) {
      throw new CliError('CoreClaw cloud run response did not include data.run_slug.');
    }
    if (humanOutput) {
      console.log(`Waiting for cloud run: ${runSlug}`);
    }
    const detail = await pollRunUntilTerminal(client, runSlug, {
      timeoutMs: parseDurationMs(options.waitTimeout ?? '10m', '--wait-timeout'),
      pollIntervalMs: parseDurationMs(options.pollInterval ?? '5s', '--poll-interval'),
      sleepImpl: options.sleepImpl,
      nowImpl: options.nowImpl,
    });
    const status = Number(detail.status);
    if (humanOutput) {
      console.log(`Run finished: ${statusLabel(status)}`);
    }
    result = { ...response, detail };
    if (status !== 3) {
      throw new CliError(`CoreClaw cloud run ${runSlug} ended with status ${status}. Check logs with "coreclaw runs logs ${runSlug}".`);
    }
    if (options.resultsOutput) {
      const resultsResponse = await client.runResults({
        runSlug,
        pageIndex: parsePositiveInteger(options.pageIndex, 1, '--page-index'),
        pageSize: parsePositiveInteger(options.pageSize, 100, '--page-size'),
      });
      const resultsPath = writeJsonOutput(options.resultsOutput, resultsResponse);
      result = { ...result, results_path: resultsPath, results: resultsResponse };
      if (humanOutput) {
        console.log(`Results: ${resultsPath}`);
      }
    }
  }

  if (options.runEvidenceOutput) {
    if (!runSlug) {
      throw new CliError('CoreClaw cloud run response did not include data.run_slug, so --run-evidence-output cannot continue.');
    }
    const collectImpl = options.collectImpl ?? runsCommand;
    const runEvidence = await collectImpl(['collect', runSlug], {
      ...options,
      output: options.runEvidenceOutput,
      format: options.format ?? 'json',
      pageIndex: options.pageIndex,
      pageSize: parsePositiveInteger(options.pageSize, 100, '--page-size'),
      jsonOutput: false,
    });
    result = {
      ...result,
      run_evidence: runEvidence,
      run_evidence_path: options.runEvidenceOutput,
    };
    if (humanOutput) {
      console.log(`Run evidence: ${options.runEvidenceOutput}`);
    }
  }

  if (options.jsonOutput) {
    return printOrReturn(result, options);
  }

  return result;
}

async function resolveWorkerVersion(client, scraperSlug, version) {
  if (!version || version === 'auto' || version === 'latest') {
    const detail = await client.workerDetail(scraperSlug);
    const resolved = detail.data?.version;
    if (!resolved) {
      throw new CliError(`Cannot resolve latest version for Worker ${scraperSlug}. Pass --version explicitly.`);
    }
    return resolved;
  }
  return version;
}

function printWorkerDetail(scraperSlug, data) {
  console.log(`Worker ${scraperSlug}`);
  console.log(`Version: ${data.version ?? '-'}`);
  const system = data.parameters?.system ?? {};
  if (Object.keys(system).length > 0) {
    console.log('System parameters:');
    for (const [key, value] of Object.entries(system)) {
      console.log(`  ${key}: ${value}`);
    }
  }
  const customProperties = data.parameters?.custom?.properties ?? [];
  if (customProperties.length > 0) {
    console.log('Custom parameters:');
    for (const property of customProperties) {
      const required = property.required ? 'required' : 'optional';
      console.log(`  ${property.name ?? '-'} (${property.type ?? 'unknown'}, ${required})`);
    }
  }
}
