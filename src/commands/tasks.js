import {
  createClientFromOptions,
  parseDurationMs,
  parseNonNegativeInteger,
  parsePositiveInteger,
  pollRunUntilTerminal,
  printOrReturn,
  readInputJson,
  requireArg,
  requireSubcommand,
  statusLabel,
  writeJsonOutput,
} from './cloud-utils.js';
import { runsCommand } from './runs.js';
import { CliError } from '../utils/errors.js';

export async function tasksCommand(positionals = [], options = {}) {
  const subcommand = requireSubcommand(
    positionals,
    'tasks',
    ['list', 'create', 'get', 'update', 'delete', 'input', 'run'],
  );
  switch (subcommand) {
    case 'list':
      return listTasks(positionals.slice(1), options);
    case 'create':
      return createTask(positionals.slice(1), options);
    case 'get':
      return getTask(positionals.slice(1), options);
    case 'update':
      return updateTask(positionals.slice(1), options);
    case 'delete':
      return deleteTask(positionals.slice(1), options);
    case 'input':
      return inputTask(positionals.slice(1), options);
    case 'run':
      return runTask(positionals.slice(1), options);
    default:
      return null;
  }
}

async function listTasks(args, options) {
  const client = createClientFromOptions(options);
  const workerId = args[0] ?? options.workerId;
  const response = await client.listWorkerTasks({
    workerId,
    offset: parseNonNegativeInteger(options.offset ?? (parsePositiveInteger(options.pageIndex, 1, '--page-index') - 1), 0, '--offset'),
    limit: parsePositiveInteger(options.pageSize ?? options.limit, 20, '--page-size'),
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const tasks = response.data?.list ?? [];
  console.log(`CoreClaw tasks: ${tasks.length} of ${response.data?.count ?? tasks.length}`);
  for (const task of tasks) {
    console.log(`${task.slug ?? '-'}  ${task.title ?? '-'}  worker=${task.worker_id ?? task.scraper_slug ?? '-'}  ${task.schedule_enabled === 1 ? 'enabled' : 'disabled'}`);
  }
  return response;
}

async function createTask(args, options) {
  const workerId = requireArg(args[0] ?? options.workerId, 'tasks create requires <worker_slug>.');
  const title = requireArg(options.title ?? args[1], 'tasks create requires --title.');
  const input = options.input ? readInputJson(options.input) : requireArg(options.inputJson ?? options.inputValue, 'tasks create requires --input <file.json>.');
  const client = createClientFromOptions(options);
  const response = await client.createWorkerTask({
    workerId,
    title,
    input,
    version: options.version,
    description: options.description,
    scheduleType: parseScheduleInt(options.scheduleType, 'schedule_type'),
    scheduleEnabled: parseScheduleInt(options.scheduleEnabled, 'schedule_enabled'),
    scheduleWeekday: parseScheduleInt(options.scheduleWeekday, 'schedule_weekday'),
    scheduleDay: parseScheduleInt(options.scheduleDay, 'schedule_day'),
    scheduleTime: options.scheduleTime,
    scheduleOnceDate: options.scheduleOnceDate,
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  console.log(`Task created: ${response.data?.slug ?? '-'}`);
  console.log(`Worker: ${workerId}`);
  console.log(`Title: ${title}`);
  return response;
}

function parseScheduleInt(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number)) {
    throw new CliError(`--${fieldName.replace(/_/g, '-')} must be an integer, got: ${value}`);
  }
  return number;
}

async function getTask(args, options) {
  const taskSlug = requireArg(args[0], 'tasks get requires <task_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.getWorkerTask(taskSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const data = response.data ?? {};
  console.log(`Task: ${data.slug ?? taskSlug}`);
  console.log(`Title: ${data.title ?? '-'}`);
  console.log(`Worker: ${data.worker_id ?? data.scraper_slug ?? '-'}`);
  console.log(`Version: ${data.version ?? '-'}`);
  if (data.schedule_type !== undefined) {
    console.log(`Schedule type: ${data.schedule_type}`);
  }
  if (data.schedule_enabled !== undefined) {
    console.log(`Schedule enabled: ${data.schedule_enabled}`);
  }
  return response;
}

async function updateTask(args, options) {
  const taskSlug = requireArg(args[0], 'tasks update requires <task_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.updateWorkerTask(taskSlug, {
    title: options.title,
    description: options.description,
    scheduleType: parseScheduleInt(options.scheduleType, 'schedule_type'),
    scheduleEnabled: parseScheduleInt(options.scheduleEnabled, 'schedule_enabled'),
    scheduleWeekday: parseScheduleInt(options.scheduleWeekday, 'schedule_weekday'),
    scheduleDay: parseScheduleInt(options.scheduleDay, 'schedule_day'),
    scheduleTime: options.scheduleTime,
    scheduleOnceDate: options.scheduleOnceDate,
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  console.log(`Task updated: ${taskSlug}`);
  return response;
}

async function deleteTask(args, options) {
  const taskSlug = requireArg(args[0], 'tasks delete requires <task_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.deleteWorkerTask(taskSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  console.log(`Task deleted: ${taskSlug}`);
  return response;
}

async function inputTask(args, options) {
  const sub = requireSubcommand(args, 'tasks input', ['get', 'put']);
  const taskSlug = requireArg(args[1], `tasks input ${sub} requires <task_slug>.`);
  const client = createClientFromOptions(options);
  if (sub === 'get') {
    const response = await client.getWorkerTaskInput(taskSlug);
    if (options.jsonOutput) {
      return printOrReturn(response, options);
    }
    const data = response.data ?? {};
    console.log(`Task input: ${taskSlug}`);
    if (data.input !== undefined) {
      console.log(JSON.stringify(data.input, null, 2));
    }
    if (data.version !== undefined) {
      console.log(`Version: ${data.version}`);
    }
    return response;
  }
  // put
  const input = readInputJson(options.input, '--input');
  const response = await client.updateWorkerTaskInput(taskSlug, {
    input,
    version: options.version,
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }
  console.log(`Task input updated: ${taskSlug}`);
  return response;
}

async function runTask(args, options) {
  const taskSlug = requireArg(args[0], 'tasks run requires <task_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.runWorkerTask(taskSlug, {
    callbackUrl: options.callbackUrl,
    isAsync: options.sync ? false : true,
  });
  const runId = response.data?.run_slug;
  let result = response;
  const humanOutput = !options.jsonOutput;

  if (humanOutput) {
    console.log(`Task run started: ${runId ?? '-'}`);
    console.log(`Task: ${taskSlug}`);
  }

  if (options.wait) {
    if (!runId) {
      throw new CliError('CoreClaw task run response did not include data.run_slug.');
    }
    if (humanOutput) {
      console.log(`Waiting for task run: ${runId}`);
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
    result = { ...result, detail };
    if (status !== 'succeeded') {
      throw new CliError(`CoreClaw task run ${runId} ended with status ${status}. Check logs with "coreclaw runs logs ${runId}".`);
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
      throw new CliError('CoreClaw task run response did not include data.run_slug, so --run-evidence-output cannot continue.');
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
