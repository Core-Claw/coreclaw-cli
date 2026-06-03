import { resolveProjectPath } from '../utils/paths.js';
import { buildRuntimeEnv, publicEnvSnapshot, resolveBrowserEndpoints } from '../runtime/env.js';
import { printJson, shouldPrintJson, withJsonProgressOnStderr } from '../utils/output.js';

export async function envCommand(projectPath = '.', options = {}) {
  const report = await withJsonProgressOnStderr(options, () => envCommandInternal(projectPath, options));
  if (shouldPrintJson(options)) {
    printJson(report);
  }
  return report;
}

async function envCommandInternal(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const browserEndpoints = await resolveBrowserEndpoints({
    chromeWs: options.chromeWs,
    chromeHttp: options.chromeHttp,
    lightpandaDomain: options.lightpandaDomain,
    discoverLocalChrome: options.discoverChrome !== false,
    fetchImpl: options.browserFetchImpl ?? globalThis.fetch,
  });
  const env = buildRuntimeEnv({
    proxyAuth: options.proxyAuth,
    proxyDomain: options.proxyDomain,
    chromeWs: browserEndpoints.chromeWs,
    chromeHttp: browserEndpoints.chromeHttp,
    lightpandaDomain: browserEndpoints.lightpandaDomain,
    cdpEndpoint: browserEndpoints.cdpEndpoint,
    browserWsEndpoint: browserEndpoints.browserWsEndpoint,
    cloudProxy: Boolean(options.cloudProxy || options.localProxy),
    mockNetwork: options.mockNetwork,
    runtimeTmpDir: options.runtimeTmpDir,
  });
  const report = {
    project_dir: projectDir,
    env: publicEnvSnapshot(env),
    browser_endpoints: {
      discovered_local_chrome: Boolean(browserEndpoints.discoveredLocalChrome),
      lightpanda_cdp_endpoint: browserEndpoints.lightpandaCdpEndpoint ?? null,
    },
    notes: buildNotes(),
  };

  if (!options.jsonOutput) {
    printEnvReport(report);
  }
  return report;
}

function buildNotes() {
  return [
    'This command prints the environment shape before starting the SDK runtime, worker process, local proxy, or CDP shims.',
    'coreclaw env does not start local proxy listeners; coreclaw run allocates the actual local proxy domain at runtime.',
  ];
}

function printEnvReport(report) {
  console.log(`CoreClaw runtime environment: ${report.project_dir}`);
  for (const [name, value] of Object.entries(report.env)) {
    console.log(`${name}=${formatEnvValue(value)}`);
  }
  if (report.browser_endpoints.lightpanda_cdp_endpoint) {
    console.log(`Lightpanda CDP=${report.browser_endpoints.lightpanda_cdp_endpoint}`);
  }
  console.log(`Discovered local Chrome=${report.browser_endpoints.discovered_local_chrome ? 'yes' : 'no'}`);
  for (const note of report.notes) {
    console.log(`Note: ${note}`);
  }
}

function formatEnvValue(value) {
  return value === null || value === undefined ? '<unset>' : String(value);
}
