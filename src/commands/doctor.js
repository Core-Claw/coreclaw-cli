import { spawnSync } from 'node:child_process';
import { resolveBrowserEndpoints } from '../runtime/env.js';

const CHECKS = [
  ['node', ['--version']],
  platformCheck('npm', ['--version']),
  ['python', ['--version']],
  ['go', ['version']],
];

export async function doctorCommand(options = {}) {
  console.log('CoreClaw CLI doctor');
  for (const [command, args] of CHECKS) {
    const result = spawnSync(command, args, { encoding: 'utf8', shell: false, windowsHide: true });
    if (result.error) {
      console.log(`[MISS] ${displayCommand(command, args)}: ${result.error.message}`);
      continue;
    }
    const output = `${result.stdout}${result.stderr}`.trim();
    console.log(`[ OK ] ${displayCommand(command, args)}: ${output}`);
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
}

export async function checkLocalChrome(options = {}) {
  return await resolveBrowserEndpoints({
    baseEnv: {},
    localChromeHost: options.localChromeHost ?? '127.0.0.1:9222',
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}

function platformCheck(command, args) {
  if (process.platform === 'win32') {
    return ['cmd.exe', ['/c', `${command}.cmd`, ...args]];
  }
  return [command, args];
}

function displayCommand(command, args) {
  if (command === 'cmd.exe' && args[0] === '/c') {
    return args[1];
  }
  return command;
}
