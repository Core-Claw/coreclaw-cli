import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { LANGUAGE_SPECS, readJson, validateProject } from '../validation/project.js';
import { buildRuntimeEnv, checkBrowserAvailability, publicEnvSnapshot, resolveBrowserEndpoints, withNodeTmpHook } from '../runtime/env.js';
import { buildInput } from '../runtime/input.js';
import { commandForProject, installCommandForProject, runProcess } from '../runtime/executor.js';
import { startRuntimeGrpcServer } from '../runtime/grpc-server.js';
import { RunStore } from '../runtime/run-store.js';
import { startBrowserCdpShim } from '../runtime/browser-cdp-shim.js';
import { startCaptchaCdpShim } from '../runtime/captcha-cdp-shim.js';
import { enforceResultStatusGate } from '../runtime/result-gates.js';
import { assertSocksProxyUsed, startSocksProxy } from '../runtime/socks-proxy.js';
import { enforceStrictValidation } from './validate.js';

export async function runCommand(projectPath = '.', options = {}) {
  const runOptions = resolveRunOptions(options);
  const projectDir = resolveProjectPath(projectPath);
  const validationProjectDir = runOptions.validationProjectDir
    ? path.resolve(process.cwd(), runOptions.validationProjectDir)
    : projectDir;
  const project = resolveRunProject(projectDir, validationProjectDir, runOptions);
  const artifactProjectDir = runOptions.artifactProjectDir
    ? path.resolve(process.cwd(), runOptions.artifactProjectDir)
    : projectDir;

  if (!project.ok && !runOptions.skipValidate) {
    for (const issue of project.issues) {
      console.error(`[${issue.severity.toUpperCase()}] ${issue.message}`);
    }
    throw new CliError('Cannot run until static validation errors are fixed. Use --skip-validate to bypass.');
  }
  if (!runOptions.skipValidate) {
    enforceStrictValidation(project, runOptions, 'Run validation');
  }

  const input = buildInput({
    projectDir: validationProjectDir,
    inputPath: runOptions.input,
    inlineJson: runOptions.json,
    splitIndex: runOptions.split ?? null,
  });

  const browserEndpoints = await resolveBrowserEndpoints({
    chromeWs: runOptions.chromeWs,
    chromeHttp: runOptions.chromeHttp,
    lightpandaDomain: runOptions.lightpandaDomain,
    discoverLocalChrome: runOptions.discoverChrome !== false,
    fetchImpl: runOptions.browserFetchImpl ?? globalThis.fetch,
  });
  await enforceRequiredBrowser(browserEndpoints, runOptions);

  const [command, args] = commandForProject(project, runOptions);
  const store = new RunStore({
    projectDir,
    artifactProjectDir,
    input,
    env: {},
    command: { command, args, cwd: projectDir },
    outputSchema: readOptionalJson(path.join(validationProjectDir, 'output_schema.json'), []),
    uploadManifest: runOptions.uploadManifest ?? null,
  });
  store.init();

  let browserShim = null;
  let captchaShim = null;
  if (runOptions.captchaSolver || runOptions.requireCaptchaSolver) {
    captchaShim = await startCaptchaCdpShim({
      upstreamUrl: resolveUpstreamCdpUrl(browserEndpoints),
      store,
    });
    browserEndpoints.chromeWs = captchaShim.chromeWs;
    browserEndpoints.chromeHttp = captchaShim.domain;
    browserEndpoints.cdpEndpoint = captchaShim.cdpEndpoint;
    browserEndpoints.browserWsEndpoint = captchaShim.browserWsEndpoint;
    if (shouldExposeLightpandaShim(runOptions)) {
      browserEndpoints.lightpandaDomain = captchaShim.domain;
      browserEndpoints.lightpandaCdpEndpoint = `ws://${captchaShim.domain}/devtools/browser/new`;
    }
  } else if (shouldUseBrowserCdpShim(runOptions)) {
    browserShim = await startBrowserCdpShim({
      upstreamUrl: resolveUpstreamCdpUrl(browserEndpoints),
      store,
      browserId: shouldExposeLightpandaShim(runOptions) ? 'coreclaw-lightpanda-shim' : undefined,
      browserLabel: shouldExposeLightpandaShim(runOptions)
        ? 'CoreClaw local Lightpanda CDP shim'
        : undefined,
    });
    browserEndpoints.chromeWs = browserShim.chromeWs;
    browserEndpoints.chromeHttp = browserShim.chromeHttp;
    browserEndpoints.cdpEndpoint = browserShim.cdpEndpoint;
    browserEndpoints.browserWsEndpoint = browserShim.browserWsEndpoint;
    if (shouldExposeLightpandaShim(runOptions)) {
      browserEndpoints.lightpandaDomain = browserShim.domain;
      browserEndpoints.lightpandaCdpEndpoint = `ws://${browserShim.domain}/devtools/browser/new`;
    }
  }

  const env = buildRuntimeEnv({
    proxyAuth: runOptions.proxyAuth,
    proxyDomain: runOptions.proxyDomain,
    chromeWs: browserEndpoints.chromeWs,
    chromeHttp: browserEndpoints.chromeHttp,
    lightpandaDomain: browserEndpoints.lightpandaDomain,
    cdpEndpoint: browserEndpoints.cdpEndpoint,
    browserWsEndpoint: browserEndpoints.browserWsEndpoint,
    cloudProxy: runOptions.cloudProxy || Boolean(browserShim || captchaShim),
    mockNetwork: runOptions.mockNetwork,
    runtimeTmpDir: store.tmpDir,
  });
  const workerEnv = project.language === 'node' && runOptions.tmpHook !== false
    ? withNodeTmpHook(env, nodeTmpHookPath(), { workerDir: projectDir })
    : env;
  store.env = publicEnvSnapshot(workerEnv);
  store.writeJson('env.json', store.env);

  let server;
  let localProxy = null;
  try {
    server = await startRuntimeGrpcServer({ input, store });
    console.log(`CoreClaw local runtime listening on ${server.address}`);
    console.log(`Run artifacts: ${store.runDir}`);
    if (runOptions.localProxy || runOptions.requireProxyUsage) {
      localProxy = await startSocksProxy({
        auth: env.PROXY_AUTH ?? 'coreclaw-local:coreclaw-local',
        store,
      });
      env.PROXY_AUTH = localProxy.auth;
      env.PROXY_DOMAIN = localProxy.domain;
      workerEnv.PROXY_AUTH = localProxy.auth;
      workerEnv.PROXY_DOMAIN = localProxy.domain;
      store.env = publicEnvSnapshot(workerEnv);
      store.writeJson('env.json', store.env);
      console.log(`Local CoreClaw SOCKS5 proxy listening on ${localProxy.domain}`);
    }

    if (runOptions.install) {
      const install = installCommandForProject(project, runOptions);
      if (install) {
        console.log(`Installing dependencies: ${install[0]} ${install[1].join(' ')}`);
        const installResult = await runProcess({
          command: install[0],
          args: install[1],
          cwd: projectDir,
          env,
          store,
          label: 'install',
          timeoutMs: parseDurationMs(runOptions.installTimeoutMs ?? 0),
          idleTimeoutMs: parseDurationMs(runOptions.installIdleTimeoutMs ?? '2m'),
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
      timeoutMs: parseDurationMs(runOptions.timeoutMs ?? 0),
      idleTimeoutMs: parseDurationMs(runOptions.idleTimeoutMs ?? 0),
    });

    store.finish({
      ...runResult,
      error: runResult.timedOut
        ? `${runResult.idleTimedOut ? 'Idle timeout' : 'Timeout'} while waiting for worker process to exit.`
        : undefined,
    });
    await validateRunOutputs(validationProjectDir, store, runOptions);

    if (runResult.exitCode !== 0) {
      throw new CliError(`Worker failed with exit code ${runResult.exitCode}.`);
    }

    if (runResult.timedOut) {
      throw new CliError(`Worker was killed after ${runResult.idleTimedOut ? 'idle timeout' : 'timeout'}. Results captured before timeout are preserved in ${store.runDir}.`);
    }

    enforcePostRunGates(store, localProxy, runOptions);
    enforceBrowserCdpShimGate(store, browserShim, captchaShim, runOptions);
    enforceCaptchaSolverGate(store, captchaShim, runOptions);
    enforceLightpandaGate(store, browserShim, captchaShim, runOptions);

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
    if (localProxy) {
      await localProxy.stop();
    }
    if (captchaShim) {
      await captchaShim.stop();
    }
    if (browserShim) {
      await browserShim.stop();
    }
  }
}

export function resolveRunOptions(options = {}) {
  if (!options.strict) {
    return options;
  }

  return {
    ...options,
    requireTableHeader: options.requireTableHeader ?? true,
    requireOutputSchemaMatch: options.requireOutputSchemaMatch ?? true,
    requireStatusOk: options.requireStatusOk ?? true,
  };
}

function resolveRunProject(projectDir, validationProjectDir, options = {}) {
  if (!options.runtimeLanguage) {
    return validateProject(projectDir);
  }

  const spec = LANGUAGE_SPECS[options.runtimeLanguage];
  if (!spec) {
    throw new CliError(`Unsupported runtime language: ${options.runtimeLanguage}`);
  }
  const validation = validateProject(validationProjectDir);
  return {
    ...validation,
    projectDir,
    language: options.runtimeLanguage,
    spec,
  };
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

export function enforcePostRunGates(store, localProxy, options) {
  try {
    assertSocksProxyUsed(localProxy, options);
    enforceMinimumResults(store, options);
    enforceResultStatusGate(store.runDir, options);
    enforceTableHeaderGate(store, options);
    enforceOutputSchemaMatch(store, options);
  } catch (error) {
    store.finish({ exitCode: 1, error });
    throw error;
  }
}

export function enforceTableHeaderGate(store, options) {
  if (!options.requireTableHeader) {
    return;
  }

  const summary = store.summary();
  if (summary.table_header_count < 1) {
    throw new CliError(`Worker did not call set_table_header. CoreClaw SDK docs describe runtime table headers as required before upload. Artifacts are preserved in ${store.runDir}.`);
  }
}

export function enforceOutputSchemaMatch(store, options) {
  if (!options.requireOutputSchemaMatch) {
    return;
  }

  if (!Array.isArray(store.outputSchema) || store.outputSchema.length === 0) {
    throw new CliError('--require-output-schema-match requires output_schema.json with at least one declared column.');
  }

  const summary = store.summary();
  if (summary.output_schema_issue_count > 0) {
    throw new CliError(`Run produced ${summary.output_schema_issue_count} output_schema mismatch issue(s). See ${summary.output_schema_issues_path}.`);
  }
}

export function enforceCaptchaSolverGate(store, captchaShim, options) {
  if (!captchaShim) {
    if (!options.requireCaptchaSolver) {
      return;
    }
    const message = '--require-captcha-solver requires the local CAPTCHA CDP shim to be enabled.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }

  if ((captchaShim.stats.calls?.length ?? 0) > 0 || options.requireCaptchaSolver) {
    store.writeJson?.('captcha_solver_calls.json', captchaShim.stats.calls ?? []);
  }

  if (!options.requireCaptchaSolver) {
    return;
  }

  if (captchaShim.stats.automaticSolverCalls < 1) {
    const message = 'Worker did not call Captchas.automaticSolver through the local CAPTCHA CDP shim.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }

  const invalidCalls = captchaShim.stats.invalidCalls ?? [];
  if (invalidCalls.length > 0) {
    const issueCount = invalidCalls.reduce((total, call) => total + call.issues.length, 0);
    const message = `Worker called Captchas.automaticSolver with ${issueCount} invalid parameter issue(s). See captcha_solver_calls.json in ${store.runDir}.`;
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }
}

export function enforceBrowserCdpShimGate(store, browserShim, captchaShim, options) {
  if (!options.requireBrowserCdpShim) {
    return;
  }

  const shim = captchaShim ?? browserShim;
  if (!shim) {
    const message = '--require-browser-cdp-shim requires the local browser CDP shim to be enabled.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }

  if (shim.stats.connections < 1) {
    const message = 'Worker did not connect to the local CoreClaw browser CDP shim.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }
}

export function shouldUseBrowserCdpShim(options = {}) {
  return Boolean(
    options.browserCdpShim
    || options.requireBrowserCdpShim
    || options.lightpandaShim
    || options.requireLightpandaShim
    || options.captchaSolver
    || options.requireCaptchaSolver,
  );
}

function shouldExposeLightpandaShim(options = {}) {
  return Boolean(options.lightpandaShim || options.requireLightpandaShim);
}

export function enforceLightpandaGate(store, browserShim, captchaShim, options) {
  if (!options.requireLightpandaShim) {
    return;
  }

  const shim = captchaShim ?? browserShim;
  if (!shim) {
    const message = '--require-lightpanda-shim requires the local Lightpanda CDP shim to be enabled.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }

  const lightpandaConnections = countLightpandaConnections(shim.stats);
  if (lightpandaConnections < 1) {
    const message = 'Worker did not connect to the local CoreClaw Lightpanda CDP shim.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }

  const missingAuthorization = (shim.stats.authorizationHeaders ?? []).some((header, index) => {
    const pathValue = shim.stats.paths?.[index] ?? '';
    return isLightpandaPath(pathValue) && !String(header ?? '').startsWith('Basic ');
  });
  if (missingAuthorization) {
    const message = 'Worker connected to Lightpanda without a Basic Authorization header built from PROXY_AUTH.';
    store.finish({ exitCode: 1, error: message });
    throw new CliError(message);
  }
}

export async function enforceRequiredBrowser(browserEndpoints, options = {}) {
  if (!options.requireBrowser) {
    return;
  }

  const result = await checkBrowserAvailability({
    browserEndpoints,
    fetchImpl: options.browserFetchImpl ?? globalThis.fetch,
    timeoutMs: parseDurationMs(options.browserTimeoutMs ?? '1s'),
  });
  if (result.ok) {
    return;
  }

  const probeSummary = result.probes.length > 0
    ? ` Probes: ${result.probes.map(formatBrowserProbe).join('; ')}.`
    : '';
  throw new CliError(`--require-browser requested, but no reachable local browser endpoint was found. Start Chrome with remote debugging, pass --chrome-ws/--chrome-http, or remove --require-browser for non-browser runs.${probeSummary}`);
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

function formatBrowserProbe(probe) {
  const status = probe.status ? ` status=${probe.status}` : '';
  const error = probe.error ? ` error=${probe.error}` : '';
  return `${probe.kind} ${probe.url}${status}${error}`;
}

function resolveUpstreamCdpUrl(browserEndpoints) {
  const endpoint = browserEndpoints.cdpEndpoint
    ?? browserEndpoints.browserWsEndpoint
    ?? browserEndpoints.chromeWs;
  if (!endpoint) {
    return undefined;
  }
  const text = String(endpoint).trim();
  if (text.startsWith('ws://') || text.startsWith('wss://')) {
    return text;
  }
  if (text.includes('/devtools/browser/') || text.includes('/ws?')) {
    return `ws://${text}`;
  }
  return undefined;
}

function countLightpandaConnections(stats = {}) {
  return (stats.paths ?? []).filter(isLightpandaPath).length;
}

function isLightpandaPath(pathValue) {
  return String(pathValue ?? '').replace(/\?.*$/, '') === '/devtools/browser/new';
}

async function validateRunOutputs(projectDir, store, options) {
  if (options.skipOutputValidation) {
    return;
  }

  warnOutputSchemaIssues(store, options);

  const headerPath = path.join(store.runDir, 'table_headers.json');
  if (!fs.existsSync(headerPath)) {
    console.warn('[WARN] Worker did not call set_table_header. CoreClaw accepts output_schema.json, but runtime headers help catch drift.');
    return;
  }

  const tableHeaders = JSON.parse(fs.readFileSync(headerPath, 'utf8'));
  const result = validateProject(projectDir, { tableHeaders });
  for (const issue of result.issues.filter((item) => item.code?.startsWith('runtime_header_'))) {
    console.warn(`[WARN] ${issue.message}`);
  }
}

function warnOutputSchemaIssues(store, options) {
  if (options.requireOutputSchemaMatch) {
    return;
  }

  const summary = store.summary();
  if (summary.output_schema_issue_count > 0) {
    console.warn(`[WARN] Worker pushed ${summary.output_schema_issue_count} field mismatch issue(s) against output_schema.json. See ${summary.output_schema_issues_path}. Use --require-output-schema-match to fail on this drift.`);
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
