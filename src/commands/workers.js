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
  const keyword = args.join(' ') || options.search;
  requireArg(keyword, 'workers search requires a non-empty search query.');
  const client = createClientFromOptions(options);
  // v2: listStore is the public store catalog; authenticated listWorkers is for the user's own workers.
  const store = options.owned ? false : true;
  const response = store
    ? await client.listStore({ keyword, limit: parsePositiveInteger(options.limit, 10, '--limit') })
    : await client.listWorkers({ keyword, limit: parsePositiveInteger(options.limit, 10, '--limit') });
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
  const workerId = requireArg(args[0], 'workers detail requires <worker_slug>.');
  const client = createClientFromOptions(options);
  const detail = await client.getWorker(workerId);
  const schema = await client.getWorkerInputSchema(workerId).catch(() => ({ data: null }));
  const response = { code: 0, message: 'success', data: { detail: detail.data, input_schema: schema?.data } };
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  printWorkerDetail(workerId, detail.data ?? {}, schema?.data ?? null);
  return response;
}

async function runWorker(args, options) {
  const workerId = requireArg(args[0], 'workers run requires <worker_slug>.');
  const client = createClientFromOptions(options);
  const input = readInputJson(options.input);
  const version = await resolveWorkerVersion(client, workerId, options.version);
  const response = await client.runWorker(workerId, {
    input,
    version,
    callbackUrl: options.callbackUrl,
    isAsync: options.sync ? false : true,
  });
  const runId = response.data?.run_slug;
  let result = response;
  const humanOutput = !options.jsonOutput;

  if (humanOutput) {
    console.log(`Run started: ${runId ?? '-'}`);
    console.log(`Worker: ${workerId}`);
    console.log(`Version: ${version}`);
    console.log(`Mode: ${options.sync ? 'sync' : 'async'}`);
  }

  if (options.wait) {
    if (!runId) {
      throw new CliError('CoreClaw cloud run response did not include data.run_slug.');
    }
    if (humanOutput) {
      console.log(`Waiting for cloud run: ${runId}`);
    }
    const detail = await pollRunUntilTerminal(client, runId, {
      timeoutMs: parseDurationMs(options.waitTimeout ?? '10m', '--wait-timeout'),
      pollIntervalMs: parseDurationMs(options.pollInterval ?? '5s', '--poll-interval'),
      sleepImpl: options.sleepImpl,
      nowImpl: options.nowImpl,
    });
    const status = String(detail.status ?? '').toLowerCase();
    if (humanOutput) {
      console.log(`Run finished: ${statusLabel(status)}`);
    }
    result = { ...response, detail };
    if (status !== 'succeeded') {
      throw new CliError(`CoreClaw cloud run ${runId} ended with status ${status}. Check logs with "coreclaw runs logs ${runId}".`);
    }
    if (options.resultsOutput) {
      const resultsResponse = await client.listWorkerRunResults(runId, {
        offset: parsePositiveInteger(options.pageIndex, 1, '--page-index') - 1,
        limit: parsePositiveInteger(options.pageSize, 100, '--page-size'),
      });
      const resultsPath = writeJsonOutput(options.resultsOutput, resultsResponse);
      result = { ...result, results_path: resultsPath, results: resultsResponse };
      if (humanOutput) {
        console.log(`Results: ${resultsPath}`);
      }
    }
  }

  if (options.runEvidenceOutput) {
    if (!runId) {
      throw new CliError('CoreClaw cloud run response did not include data.run_slug, so --run-evidence-output cannot continue.');
    }
    const collectImpl = options.collectImpl ?? runsCommand;
    const runEvidence = await collectImpl(['collect', runId], {
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

async function resolveWorkerVersion(client, workerId, version) {
  if (!version || version === 'auto' || version === 'latest') {
    const detail = await client.getWorker(workerId);
    const resolved = detail.data?.version;
    if (!resolved) {
      throw new CliError(`Cannot resolve latest version for Worker ${workerId}. Pass --version explicitly.`);
    }
    return resolved;
  }
  return version;
}

function printWorkerDetail(workerId, detail, inputSchema) {
  console.log(`Worker ${workerId}`);
  console.log(`Version: ${detail.version ?? '-'}`);
  if (detail.title) {
    console.log(`Title: ${detail.title}`);
  }
  if (inputSchema) {
    const properties = inputSchema.properties ?? [];
    if (properties.length > 0) {
      console.log('Input schema:');
      for (const property of properties) {
        const required = property.required ? 'required' : 'optional';
        console.log(`  ${property.name ?? '-'} (${property.type ?? 'unknown'}, ${property.editor ?? 'unknown'}, ${required})`);
      }
    }
  }
}
