import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, runCli } from '../src/cli.js';
import { CliError } from '../src/utils/errors.js';

test('runCli rejects missing option values before consuming the next flag', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'run', '.', '--proxy-auth', '--timeout-ms', '10s']),
    (error) => error instanceof CliError && error.message === 'Option "--proxy-auth" requires a value.',
  );
});

test('parseArgs preserves explicit boolean false for long options with equals', () => {
  assert.deepEqual(
    parseArgs(['verify', '.', '--strict=false', '--install=false', '--no-pack', '--timeout-ms=30s']),
    {
      positionals: ['verify', '.'],
      options: {
        strict: false,
        install: false,
        pack: false,
        timeoutMs: '30s',
      },
    },
  );
});

test('parseArgs treats input-json as an alias for inline json', () => {
  assert.deepEqual(
    parseArgs(['verify', '.', '--input-json={"url":"https://example.com"}']),
    {
      positionals: ['verify', '.'],
      options: {
        json: '{"url":"https://example.com"}',
      },
    },
  );
});

test('parseArgs rejects unknown long options before running with defaults', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--input-jsno', '{"url":"https://example.com"}']),
    (error) => error instanceof CliError
      && /Unknown option "--input-jsno"/.test(error.message),
  );
});

test('parseArgs rejects no-prefix on non-boolean options', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--no-output']),
    (error) => error instanceof CliError
      && /Option "--no-output" can only be used with boolean options/.test(error.message),
  );
});

test('runCli rejects options that are valid globally but not for the command', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'run', '.', '--cloud-output', 'cloud.json']),
    (error) => error instanceof CliError
      && /Option "--cloud-output" is not supported by "coreclaw run"/.test(error.message),
  );
});

test('runCli accepts verify-only no-compare option', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'verify', '.', '--no-compare', '--definitely-unknown']),
    (error) => error instanceof CliError
      && /Unknown option "--definitely-unknown"/.test(error.message),
  );
});

test('parseArgs rejects invalid explicit boolean values', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--strict=0']),
    (error) => error instanceof CliError
      && /Boolean option "--strict=0" only accepts "true" or "false"/.test(error.message),
  );
});
