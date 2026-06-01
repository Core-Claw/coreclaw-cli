import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { readJson, validateProject } from '../validation/project.js';
import { buildRuntimeEnv, publicEnvSnapshot, resolveBrowserEndpoints, withNodeTmpHook } from '../runtime/env.js';
import { buildInput } from '../runtime/input.js';
import { commandForProject, installCommandForProject, runProcess } from '../runtime/executor.js';
import { startRuntimeGrpcServer } from '../runtime/grpc-server.js';
import { RunStore } from '../runtime/run-store.js';

export async function runCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const project = validateProject(projectDir);
  const artifactProjectDir = options.artifactProjectDir
    ? path.resolve(process.cwd(), options.artifactProjectDir)
    : projectDir;

  if (!project.ok && !options.skipValidate) {
    for (const issue of project.issues) {
      console.error(`[${issue.severity.toUpperCase()}] ${issue.message}`);
    }
    throw new CliError('Cannot run until static validation errors are fixed. Use --skip-validate to bypass.');
  }

  const input = buildInput({
    projectDir,
    inputPath: options.input,
    inlineJson: options.json,
    splitIndex: options.split ?? null,
  });

  const [command, args] = commandForProject(project, options);
  const store = new RunStore({
    projectDir,
    artifactProjectDir,
    input,
    env: {},
    command: { command, args, cwd: projectDir },
    outputSchema: readOptionalJson(path.join(projectDir, 'output_schema.json'), []),
    uploadManifest: options.uploadManifest ?? null,
  });
  store.init();

  const browserEndpoints = await resolveBrowserEndpoints({
    chromeWs: options.chromeWs,
    discoverLocalChrome: options.discoverChrome !== false,
  });
  const env = buildRuntimeEnv({
    proxyAuth: options.proxyAuth,
    proxyDomain: options.proxyDomain,
    chromeWs: browserEndpoints.chromeWs,
    cdpEndpoint: browserEndpoints.cdpEndpoint,
    browserWsEndpoint: browserEndpoints.browserWsEndpoint,
    cloudProxy: options.cloudProxy,
    mockNetwork: options.mockNetwork,
    runtimeTmpDir: store.tmpDir,
  });
  const workerEnv = project.language === 'node' && options.tmpHook !== false
    ? withNodeTmpHook(env, nodeTmpHookPath())
    : env;
  store.env = publicEnvSnapshot(workerEnv);
  store.writeJson('env.json', store.env);

  let server;
  try {
    server = await startRuntimeGrpcServer({ input, store });
    console.log(`CoreClaw local runtime listening on ${server.address}`);
    console.log(`Run artifacts: ${store.runDir}`);

    if (options.install) {
      const install = installCommandForProject(project);
      if (install) {
        console.log(`Installing dependencies: ${install[0]} ${install[1].join(' ')}`);
        const installResult = await runProcess({
          command: install[0],
          args: install[1],
          cwd: projectDir,
          env,
          store,
          label: 'install',
          timeoutMs: parseDurationMs(options.installTimeoutMs ?? 0),
          idleTimeoutMs: parseDurationMs(options.installIdleTimeoutMs ?? '2m'),
        });
        if (installResult.exitCode !== 0) {
          throw new CliError(`Dependency installation failed with exit code ${installResult.exitCode}.`);
        }
      }
    }

    const runResult = await runProcess({
      command,
      args,
      cwd: projectDir,
      env: workerEnv,
      store,
      label: 'worker',
      timeoutMs: parseDurationMs(options.timeoutMs ?? 0),
      idleTimeoutMs: parseDurationMs(options.idleTimeoutMs ?? 0),
    });

    store.finish({
      ...runResult,
      error: runResult.timedOut
        ? `${runResult.idleTimedOut ? 'Idle timeout' : 'Timeout'} while waiting for worker process to exit.`
        : undefined,
    });
    await validateRunOutputs(projectDir, store, options);

    if (runResult.exitCode !== 0) {
      throw new CliError(`Worker failed with exit code ${runResult.exitCode}.`);
    }

    if (runResult.timedOut) {
      throw new CliError(`Worker was killed after ${runResult.idleTimedOut ? 'idle timeout' : 'timeout'}. Results captured before timeout are preserved in ${store.runDir}.`);
    }

    enforceMinimumResults(store, options);

    console.log(`Run ${store.status}: ${store.runId}`);
    console.log(`Results: ${path.join(store.runDir, 'results.ndjson')}`);

    return store.summary();
  } catch (error) {
    if (store.status === 'RUNNING') {
      store.finish({ exitCode: 1, error });
    }
    throw error;
  } finally {
    if (server) {
      await server.stop();
    }
  }
}

export function enforceMinimumResults(store, options) {
  if (options.minResults === undefined || options.minResults === null || options.minResults === '') {
    return;
  }
  const value = String(options.minResults);
  const minResults = Number.parseInt(value, 10);
  if (!Number.isInteger(minResults) || minResults < 0 || String(minResults) !== value) {
    throw new CliError(`Invalid --min-results value "${options.minResults}".`);
  }
  const summary = store.summary();
  if (summary.result_count < minResults) {
    throw new CliError(`Run produced ${summary.result_count} result(s), expected at least ${minResults}. Artifacts are preserved in ${store.runDir}.`);
  }
}

function parseDurationMs(value) {
  if (value === undefined || value === null || value === false || value === '') {
    return 0;
  }

  const text = String(value).trim();
  const match = text.match(/^(\d+)(ms|s|m)?$/i);
  if (!match) {
    throw new CliError(`Invalid duration "${value}". Use milliseconds, or suffix with s/m, for example 30000, 30s, 10m.`);
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? 'ms').toLowerCase();
  if (unit === 'm') {
    return amount * 60_000;
  }
  if (unit === 's') {
    return amount * 1000;
  }
  return amount;
}

async function validateRunOutputs(projectDir, store, options) {
  if (options.skipOutputValidation) {
    return;
  }

  const headerPath = path.join(store.runDir, 'table_headers.json');
  if (!fs.existsSync(headerPath)) {
    console.warn('[WARN] Worker did not call set_table_header. CoreClaw accepts output_schema.json, but runtime headers help catch drift.');
    return;
  }

  const tableHeaders = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  const result = validateProject(projectDir, { tableHeaders });
  for (const issue of result.issues.filter((item) => item.code === 'runtime_header_not_in_output_schema')) {
    console.warn(`[WARN] ${issue.message}`);
  }
}

function readOptionalJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return readJson(filePath);
}

function nodeTmpHookPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'node-tmp-hook.cjs');
}
