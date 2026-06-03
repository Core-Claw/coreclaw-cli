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
import { CLI_VERSION, COMMAND_GROUPS, COMMANDS } from './command-metadata.js';
import { CliError } from './utils/errors.js';

export async function runCli(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(CLI_VERSION);
    return;
  }

  if (command === 'help') {
    const topic = args[1];
    if (!topic || topic === '--help' || topic === '-h') {
      printHelp();
      return;
    }
    printCommandHelp(topic);
    return;
  }

  if (!isKnownCommand(command)) {
    throw unknownCommandError(command);
  }

  if (hasHelpFlag(args.slice(1))) {
    printCommandHelp(command);
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
      throw unknownCommandError(command);
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

function isKnownCommand(command) {
  return command === 'help' || Object.hasOwn(COMMANDS, command);
}

function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
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
  const lines = [
    `CoreClaw CLI ${CLI_VERSION}`,
    '',
    'Local development, verification, and upload preflight for CoreClaw Workers.',
    '',
    'USAGE',
    '  coreclaw <command> [options]',
    '',
    'COMMANDS',
  ];
  for (const group of COMMAND_GROUPS) {
    lines.push(`  ${group.title}:`);
    for (const name of group.commands) {
      lines.push(`    ${name.padEnd(16)} ${COMMANDS[name].summary}`);
    }
    lines.push('');
  }
  lines.push(
    'EXAMPLES',
    '  coreclaw init ./my-worker --language node --name my-worker',
    '  coreclaw verify ./my-worker --strict --input input.json --min-results 1',
    '  coreclaw compare ./cloud-output.json ./my-worker/.coreclaw/runs/<run-id> --min-shared 1 --max-diff 0',
    '',
    'LEARN MORE',
    '  coreclaw help <command>',
    '  coreclaw <command> --help',
    '  README.md and docs/roadmap.md',
  );
  console.log(lines.join('\n'));
}

function printCommandHelp(command) {
  const info = COMMANDS[command];
  if (!info) {
    throw unknownCommandError(command);
  }

  const lines = [
    `coreclaw ${command}`,
    '',
    info.summary,
    '',
    'USAGE',
    ...info.usage.map((line) => `  ${line}`),
  ];
  if (info.examples?.length) {
    lines.push('', 'EXAMPLES', ...info.examples.map((line) => `  ${line}`));
  }
  lines.push('', 'LEARN MORE', '  coreclaw --help');
  console.log(lines.join('\n'));
}

function unknownCommandError(command) {
  const suggestion = suggestCommand(command);
  const hint = suggestion ? ` Did you mean "coreclaw ${suggestion}"?` : '';
  return new CliError(`Unknown command "${command}".${hint} Run coreclaw --help.`);
}

function suggestCommand(command) {
  const candidates = Object.keys(COMMANDS);
  const scored = candidates
    .map((candidate) => ({ candidate, distance: levenshtein(command.toLowerCase(), candidate.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return scored[0]?.distance <= 3 ? scored[0].candidate : null;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let last = leftIndex;
    previous[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const old = previous[rightIndex + 1];
      const cost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      previous[rightIndex + 1] = Math.min(
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + 1,
        last + cost,
      );
      last = old;
    }
  }
  return previous[right.length];
}
