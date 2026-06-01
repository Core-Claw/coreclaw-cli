import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.js';
import { CliError } from '../src/utils/errors.js';

test('runCli rejects missing option values before consuming the next flag', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'run', '.', '--proxy-auth', '--timeout-ms', '10s']),
    (error) => error instanceof CliError && error.message === 'Option "--proxy-auth" requires a value.',
  );
});
