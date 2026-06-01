import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceMinimumResults } from '../src/commands/run.js';
import { CliError } from '../src/utils/errors.js';

test('enforceMinimumResults rejects zero-output successful runs when requested', () => {
  const store = makeStore(0);

  assert.throws(
    () => enforceMinimumResults(store, { minResults: '1' }),
    (error) => error instanceof CliError && /expected at least 1/.test(error.message),
  );
});

test('enforceMinimumResults allows runs that meet the requested result count', () => {
  const store = makeStore(2);

  assert.doesNotThrow(() => enforceMinimumResults(store, { minResults: '2' }));
});

function makeStore(resultCount) {
  return {
    runDir: 'E:\\worker\\fixture\\.coreclaw\\runs\\run-id',
    summary() {
      return {
        result_count: resultCount,
      };
    },
  };
}
