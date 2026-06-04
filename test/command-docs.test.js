import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderCommandDocs } from '../src/command-docs.js';
import { COMMAND_GROUPS, COMMANDS } from '../src/command-metadata.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('generated command reference covers every command in help metadata', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'commands.md'), 'utf8');

  assert.match(docs, /^# CoreClaw CLI 命令参考/m);
  assert.match(docs, /## 命令总览/);
  assert.match(docs, /用法：/);
  assert.match(docs, /示例：/);

  for (const group of COMMAND_GROUPS) {
    assert.match(docs, new RegExp(`### ${escapeRegExp(group.title)}`));
    for (const name of group.commands) {
      const command = COMMANDS[name];
      assert.match(docs, new RegExp(`### \`${escapeRegExp(name)}\``));
      assert.match(docs, new RegExp(escapeRegExp(command.summary)));
      for (const usage of command.usage) {
        assert.match(docs, new RegExp(escapeRegExp(usage)));
      }
    }
  }
});

test('generated command reference is in sync with command metadata renderer', () => {
  const docs = fs.readFileSync(path.join(ROOT, 'docs', 'commands.md'), 'utf8');
  assert.equal(docs, renderCommandDocs());
});

test('README files link generated command reference', () => {
  for (const file of ['README.md', 'README_CN.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /\[docs\/commands\.md\]\(\.\/docs\/commands\.md\)/);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
