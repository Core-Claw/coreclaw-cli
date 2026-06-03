import { CLI_VERSION, COMMAND_GROUPS, COMMANDS } from './command-metadata.js';

export function renderCommandDocs({
  version = CLI_VERSION,
  groups = COMMAND_GROUPS,
  commands = COMMANDS,
} = {}) {
  const lines = [
    '# CoreClaw CLI Command Reference',
    '',
    `Generated from CLI command metadata for CoreClaw CLI ${version}.`,
    '',
    'Use this page when you need exact command syntax. For workflow guidance, start with the main README.',
    '',
    '## Commands',
    '',
  ];

  for (const group of groups) {
    lines.push(`### ${group.title}`, '');
    for (const name of group.commands) {
      const command = commands[name];
      lines.push(`- \`${name}\` - ${command.summary}`);
    }
    lines.push('');
  }

  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    for (const name of group.commands) {
      const command = commands[name];
      lines.push(`### \`${name}\``, '', command.summary, '', 'Usage:', '', '```bash');
      lines.push(...command.usage);
      lines.push('```', '');
      if (command.examples?.length) {
        lines.push('Examples:', '', '```bash');
        lines.push(...command.examples);
        lines.push('```', '');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
