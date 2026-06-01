import { initCommand } from './commands/init.js';
import { validateCommand } from './commands/validate.js';
import { runCommand } from './commands/run.js';
import { packCommand } from './commands/pack.js';
import { doctorCommand } from './commands/doctor.js';
import { auditCommand } from './commands/audit.js';
import { inspectRunCommand } from './commands/inspect-run.js';
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
    case 'compare':
      await compareCommand(parsed.positionals[0], parsed.positionals[1], parsed.options);
      return;
    case 'doctor':
      await doctorCommand();
      return;
    default:
      throw new CliError(`Unknown command "${command}". Run coreclaw --help.`);
  }
}

function parseArgs(args) {
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
        options[toCamel(rawName.slice(3))] = false;
        continue;
      }
      const name = toCamel(rawName);
      if (rawValue !== undefined) {
        options[name] = rawValue;
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

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function isBooleanOption(name) {
  return new Set([
    'force',
    'soft',
    'install',
    'skipValidate',
    'skipOutputValidation',
    'mockNetwork',
    'validate',
    'recursive',
    'all',
    'cloudProxy',
    'localProxy',
    'requireProxyUsage',
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
  coreclaw validate [project]
  coreclaw run [project] [--input input.json | --json '{"url":"..."}'] [--split 0] [--min-results 1]
  coreclaw run [project] [--cloud-proxy] [--proxy-auth user:pass] [--proxy-domain host:port]
  coreclaw run [project] [--local-proxy] [--require-proxy-usage]
  coreclaw run [project] [--chrome-ws host[:port][/path] [--chrome-http host:port] | --no-discover-chrome]
  coreclaw verify [project] [--input input.json | --json '{"url":"..."}'] [--min-results 1] [--no-pack]
  coreclaw verify [project] [--no-staging] [--no-install]
  coreclaw verify [project] [--local-proxy] [--require-proxy-usage]
  coreclaw verify [project] --cloud-output cloud.json [--min-shared 1] [--compare-output report.json]
  coreclaw pack [project] --output worker.zip
  coreclaw audit [root] --output audit.json --markdown audit.md [--all]
  coreclaw inspect-run .coreclaw/runs/<run-id> [--min-results 1]
  coreclaw compare cloud.json .coreclaw/runs/<run-id> [--min-shared 1] [--output report.json]
  coreclaw doctor

Core commands:
  init       Create an upload-ready worker with official SDK files
  validate   Check required files, input_schema.json, and output_schema.json
  run        Start local gRPC runtime emulator and execute the worker
  verify     Run upload preflight from a clean upload-like staging directory
  pack       Create a CoreClaw upload ZIP with entry file at archive root
  audit      Validate worker-* projects under a root and write a report
  inspect-run Validate a local run artifact directory
  compare    Compare CoreClaw cloud JSON export with a local run or NDJSON output
  doctor     Check local tools
`);
}
