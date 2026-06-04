import {
  createClientFromOptions,
  parseDurationMs,
  parsePositiveInteger,
  pollRunUntilTerminal,
  printOrReturn,
  requireArg,
  requireSubcommand,
  statusLabel,
  writeJsonOutput,
} from './cloud-utils.js';
import { runsCommand } from './runs.js';
import { CliError } from '../utils/errors.js';

export async function tasksCommand(positionals = [], options = {}) {
  const subcommand = requireSubcommand(positionals, 'tasks', ['run']);
  if (subcommand === 'run') {
    return runTask(positionals.slice(1), options);
  }
  return null;
}

async function runTask(args, options) {
  const taskSlug = requireArg(args[0], 'tasks run requires <task_slug>.');
  if (!options.callbackUrl) {
    throw new CliError('tasks run: --callback-url is required by the documented CoreClaw Task API contract.');
  }
  const client = createClientFromOptions(options);
  const response = await client.runTask({ taskSlug, callbackUrl: options.callbackUrl });
  const runSlug = response.data?.run_slug;
  let result = response;
  const humanOutput = !options.jsonOutput;

  if (humanOutput) {
    console.log(`Task run started: ${runSlug ?? '-'}`);
    console.log(`Task: ${taskSlug}`);
  }

  if (options.wait) {
    if (!runSlug) {
      throw new CliError('CoreClaw task run response did not include data.run_slug.');
    }
    if (humanOutput) {
      console.log(`Waiting for task run: ${runSlug}`);
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
    result = { ...result, detail };
    if (status !== 3) {
      throw new CliError(`CoreClaw task run ${runSlug} ended with status ${status}. Check logs with "coreclaw runs logs ${runSlug}".`);
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
      throw new CliError('CoreClaw task run response did not include data.run_slug, so --run-evidence-output cannot continue.');
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
