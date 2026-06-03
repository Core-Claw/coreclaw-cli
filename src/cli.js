import { initCommand } from './commands/init.js';
import { validateCommand } from './commands/validate.js';
import { runCommand } from './commands/run.js';
import { packCommand } from './commands/pack.js';
import { doctorCommand } from './commands/doctor.js';
import { auditCommand } from './commands/audit.js';
import { inspectRunCommand } from './commands/inspect-run.js';
import { inspectPackageCommand } from './commands/inspect-package.js';
import { verifyCommand } from './commands/verify.js';
import { compareCommand } from './commands/compare.js';
import { CliError } from './utils/errors.js';

export async function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log('0.1.0');
    return;
  }

  const parsed = parseArgs(args.slice(1));
  validateOptionsForCommand(command, parsed.options);

  switch (command) {
    case 'init':
      await initCommand(parsed.positionals[0] ?? '.', parsed.options);
      return;
    case 'validate':
      await validateCommand(parsed.positionals[0] ?? '.', parsed.options);
      return;
    case 'run':
      await runCommand(parsed.positionals[0] ?? '.', withDefaults(parsed.options, { python: 'python', node: 'node', go: 'go' }));
      return;
    case 'verify':
      await verifyCommand(parsed.positionals[0] ?? '.', parsed.options);
      return;
    case 'pack':
      await packCommand(parsed.positionals[0] ?? '.', normalizePackOptions(parsed.options));
      return;
    case 'audit':
      await auditCommand(parsed.positionals[0] ?? '.', parsed.options);
      return;
    case 'inspect-run':
      await inspectRunCommand(parsed.positionals[0], parsed.options);
      return;
    case 'inspect-package':
      await inspectPackageCommand(parsed.positionals[0], parsed.options);
      return;
    case 'compare':
      await compareCommand(parsed.positionals[0], parsed.positionals[1], parsed.options);
      return;
    case 'doctor':
      await doctorCommand(parsed.options);
      return;
    default:
      throw new CliError(`Unknown command "${command}". Run coreclaw --help.`);
  }
}

export function parseArgs(args) {
  const options = {};
  const positionals = [];
  const aliases = {
    l: 'language',
    n: 'name',
    f: 'force',
    i: 'input',
    o: 'output',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [rawName, rawValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (rawName.startsWith('no-')) {
        const name = toCamel(rawName.slice(3));
        assertKnownOption(rawName, name);
        if (!isBooleanOption(name)) {
          throw new CliError(`Option "--${rawName}" can only be used with boolean options.`);
        }
        options[name] = false;
        continue;
      }
      const name = toCamel(rawName);
      assertKnownOption(rawName, name);
      if (rawValue !== undefined) {
        options[name] = isBooleanOption(name)
          ? parseBooleanOptionValue(rawValue, arg)
          : rawValue;
      } else if (isBooleanOption(name)) {
        options[name] = true;
      } else {
        options[name] = readOptionValue(args, index, arg);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const shortName = arg.slice(1);
      const name = aliases[shortName];
      if (!name) {
        throw new CliError(`Unknown option "${arg}".`);
      }
      if (isBooleanOption(name)) {
        options[name] = true;
      } else {
        options[name] = readOptionValue(args, index, arg);
        index += 1;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { options, positionals };
}

function readOptionValue(args, index, displayName) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CliError(`Option "${displayName}" requires a value.`);
  }
  return value;
}

function parseBooleanOptionValue(value, displayName) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new CliError(`Boolean option "${displayName}" only accepts "true" or "false" when using --flag=value.`);
}

function toCamel(value) {
  if (value === 'input-json') {
    return 'json';
  }
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function assertKnownOption(rawName, name) {
  if (!isKnownOption(name)) {
    throw new CliError(`Unknown option "--${rawName}". Run coreclaw --help.`);
  }
}

function validateOptionsForCommand(command, options) {
  const allowed = commandAllowedOptions(command);
  if (!allowed) {
    return;
  }
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) {
      throw new CliError(`Option "--${toKebab(name)}" is not supported by "coreclaw ${command}". Run coreclaw --help.`);
    }
  }
}

function commandAllowedOptions(command) {
  const runtime = new Set([
    'browserCdpShim',
    'browserTimeoutMs',
    'captchaSolver',
    'chromeHttp',
    'chromeWs',
    'cloudProxy',
    'command',
    'discoverChrome',
    'go',
    'idleTimeoutMs',
    'input',
    'install',
    'installIdleTimeoutMs',
    'installTimeoutMs',
    'json',
    'lightpandaDomain',
    'lightpandaShim',
    'localProxy',
    'minResults',
    'mockNetwork',
    'node',
    'proxyAuth',
    'proxyDomain',
    'python',
    'requireBrowser',
    'requireBrowserCdpShim',
    'requireCaptchaSolver',
    'requireLightpandaShim',
    'requireOutputSchemaMatch',
    'requireProxyUsage',
    'requireResultStatusOk',
    'requireStatusOk',
    'requireTableHeader',
    'resultFailValues',
    'resultStatusFields',
    'skipOutputValidation',
    'skipValidate',
    'split',
    'strict',
    'timeoutMs',
  ]);
  const compare = new Set([
    'compareProfile',
    'ignoreFields',
    'ignoreKeys',
    'ignoreKeysFile',
    'keyFields',
    'maxDiff',
    'maxOnlyCloud',
    'maxOnlyLocal',
    'minShared',
    'outputSchema',
    'requireOutputSchemaMatch',
    'requireResultStatusOk',
    'requireStatusOk',
    'requireUniqueKeys',
    'resultFailValues',
    'resultStatusFields',
  ]);

  switch (command) {
    case 'init':
      return new Set(['force', 'lang', 'language', 'name']);
    case 'validate':
      return new Set(['soft', 'strict']);
    case 'run':
      return runtime;
    case 'verify':
      return new Set([
        ...runtime,
        ...compare,
        'cloudOutput',
        'compare',
        'compareOutput',
        'output',
        'pack',
        'staging',
      ]);
    case 'pack':
      return new Set(['go', 'output', 'strict', 'validate']);
    case 'audit':
      return new Set(['all', 'auditProfile', 'failOnWarn', 'ignoreIssueCodes', 'markdown', 'output', 'recursive', 'soft']);
    case 'inspect-run':
      return new Set(['minResults', 'requireOutputSchemaMatch', 'requireResultStatusOk', 'requireStatusOk', 'resultFailValues', 'resultStatusFields']);
    case 'inspect-package':
      return new Set(['language', 'strict']);
    case 'compare':
      return new Set([...compare, 'output']);
    case 'doctor':
      return new Set(['go', 'localChromeHost', 'node', 'python', 'strict']);
    default:
      return null;
  }
}

function isKnownOption(name) {
  return isBooleanOption(name) || new Set([
    'auditProfile',
    'browserTimeoutMs',
    'chromeHttp',
    'chromeWs',
    'cloudOutput',
    'command',
    'compareOutput',
    'compareProfile',
    'go',
    'idleTimeoutMs',
    'ignoreFields',
    'ignoreIssueCodes',
    'ignoreKeys',
    'ignoreKeysFile',
    'input',
    'installIdleTimeoutMs',
    'installTimeoutMs',
    'json',
    'keyFields',
    'lang',
    'language',
    'lightpandaDomain',
    'localChromeHost',
    'markdown',
    'maxDiff',
    'maxOnlyCloud',
    'maxOnlyLocal',
    'minResults',
    'minShared',
    'name',
    'node',
    'output',
    'outputSchema',
    'proxyAuth',
    'proxyDomain',
    'python',
    'resultFailValues',
    'resultStatusFields',
    'split',
    'timeoutMs',
  ]).has(name);
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function isBooleanOption(name) {
  return new Set([
    'compare',
    'force',
    'soft',
    'strict',
    'install',
    'skipValidate',
    'skipOutputValidation',
    'staging',
    'mockNetwork',
    'validate',
    'recursive',
    'all',
    'failOnWarn',
    'cloudProxy',
    'localProxy',
    'requireProxyUsage',
    'requireBrowser',
    'browserCdpShim',
    'requireBrowserCdpShim',
    'lightpandaShim',
    'requireLightpandaShim',
    'captchaSolver',
    'requireCaptchaSolver',
    'requireTableHeader',
    'requireOutputSchemaMatch',
    'requireStatusOk',
    'requireResultStatusOk',
    'requireUniqueKeys',
    'discoverChrome',
    'pack',
  ]).has(name);
}

function normalizePackOptions(options) {
  if (options.validate === undefined) {
    return { ...options, validate: true };
  }
  return options;
}

function withDefaults(options, defaults) {
  return { ...defaults, ...options };
}

function printHelp() {
  console.log(`CoreClaw CLI 0.1.0

Usage:
  coreclaw init [target] --language <python|node|go>
  coreclaw validate [project] [--strict]
  coreclaw run [project] [--input input.json | --json '{"url":"..."}' | --input-json '{"url":"..."}'] [--strict] [--split 0] [--min-results 1]
  coreclaw run [project] [--require-table-header] [--require-output-schema-match]
  coreclaw run [project] [--require-status-ok [--result-status-fields status] [--result-fail-values fail,error]]
  coreclaw run [project] [--cloud-proxy] [--proxy-auth user:pass] [--proxy-domain host:port]
  coreclaw run [project] [--local-proxy] [--require-proxy-usage]
  coreclaw run [project] [--chrome-ws host[:port][/path] [--chrome-http host:port] | --no-discover-chrome] [--require-browser]
  coreclaw run [project] [--lightpanda-domain domain-or-endpoint]
  coreclaw run [project] [--browser-cdp-shim] [--require-browser-cdp-shim]
  coreclaw run [project] [--lightpanda-shim] [--require-lightpanda-shim]
  coreclaw run [project] [--captcha-solver] [--require-captcha-solver]
  coreclaw verify [project] [--input input.json | --json '{"url":"..."}' | --input-json '{"url":"..."}'] [--strict] [--min-results 1] [--no-pack]
  coreclaw verify [project] [--require-table-header] [--require-output-schema-match]
  coreclaw verify [project] [--require-status-ok [--result-status-fields status] [--result-fail-values fail,error]]
  coreclaw verify [project] [--no-staging] [--no-install] [--go go]
  coreclaw verify [project] [--local-proxy] [--require-proxy-usage]
  coreclaw verify [project] [--require-browser]
  coreclaw verify [project] [--lightpanda-domain domain-or-endpoint]
  coreclaw verify [project] [--browser-cdp-shim] [--require-browser-cdp-shim]
  coreclaw verify [project] [--lightpanda-shim] [--require-lightpanda-shim]
  coreclaw verify [project] [--captcha-solver] [--require-captcha-solver]
  coreclaw verify [project] --cloud-output cloud.json|cloud.csv [--compare-profile profile.json] [--min-shared 1] [--require-unique-keys] [--ignore-fields completed_at] [--ignore-keys key1,key2] [--ignore-keys-file file] [--require-output-schema-match] [--compare-output report.json]
  coreclaw pack [project] --output worker.zip [--strict] [--go go]
  coreclaw audit [root] --output audit.json --markdown audit.md [--audit-profile profile.json] [--all] [--fail-on-warn] [--ignore-issue-codes code1,code2]
  coreclaw inspect-run .coreclaw/runs/<run-id> [--min-results 1] [--require-output-schema-match] [--require-status-ok]
  coreclaw inspect-package worker.zip [--language python|node|go] [--strict]
  coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--compare-profile profile.json] [--min-shared 1] [--require-unique-keys] [--ignore-fields completed_at] [--ignore-keys key1,key2] [--ignore-keys-file file] [--require-status-ok] [--output-schema output_schema.json] [--output report.json]
  coreclaw doctor [--python "py -3"] [--go go] [--strict]

Core commands:
  init       Create an upload-ready worker with official SDK files
  validate   Check required files, input_schema.json, and output_schema.json
  run        Start local gRPC runtime emulator and execute the worker
  verify     Run upload preflight from a clean upload-like staging directory
  pack       Create a CoreClaw upload ZIP with entry file at archive root
  audit      Validate worker-* projects under a root and write a report
  inspect-run Validate a local run artifact directory
  inspect-package Validate upload ZIP root entries, nested packaging mistakes, and Go executable mode
  compare    Compare CoreClaw cloud JSON/CSV output with a local run or NDJSON output
  doctor     Check local tools
`);
}
