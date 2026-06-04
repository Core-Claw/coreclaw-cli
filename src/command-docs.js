import { CLI_VERSION, COMMAND_GROUPS, COMMANDS } from './command-metadata.js';

export function renderCommandDocs({
  version = CLI_VERSION,
  groups = COMMAND_GROUPS,
  commands = COMMANDS,
} = {}) {
  const lines = [
    '# CoreClaw CLI 命令参考',
    '',
    `本文档由 CoreClaw CLI ${version} 的命令元数据生成。`,
    '',
    '需要确认精确命令语法时请查阅本文档。工作流说明请先阅读主 README。',
    '',
    '## 命令总览',
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
      lines.push(`### \`${name}\``, '', command.summary, '', '用法：', '', '```bash');
      lines.push(...command.usage);
      lines.push('```', '');
      if (command.examples?.length) {
        lines.push('示例：', '', '```bash');
        lines.push(...command.examples);
        lines.push('```', '');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
