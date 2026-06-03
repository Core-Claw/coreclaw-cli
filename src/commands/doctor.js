import { spawnSync } from 'node:child_process';
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

function platformCheck(command, args) {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', `${command}.cmd`, ...args] };
  }
  return { command, args };
}
