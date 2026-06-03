import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enforceResultStatusGate, resultStatusIssues } from '../src/runtime/result-gates.js';
import { CliError } from '../src/utils/errors.js';

test('resultStatusIssues finds documented failure status values', () => {
  const runDir = makeRunDir([
    { status: 'ok' },
    { status: 'fail', check_name: 'browser' },
    { status: 'ERROR' },
  ]);

  assert.deepEqual(resultStatusIssues(runDir), [
    { index: 2, field: 'status', value: 'fail', row: { status: 'fail', check_name: 'browser' } },
    { index: 3, field: 'status', value: 'ERROR', row: { status: 'ERROR' } },
  ]);
});

test('enforceResultStatusGate is opt-in and supports custom fields', () => {
  const runDir = makeRunDir([
    { status: 'CLAIMED' },
    { check_status: 'manual' },
  ]);

  assert.doesNotThrow(() => enforceResultStatusGate(runDir, {}));
  assert.doesNotThrow(() => enforceResultStatusGate(runDir, { requireStatusOk: true }));
  assert.throws(
    () => enforceResultStatusGate(runDir, {
      requireStatusOk: true,
      resultStatusFields: 'status,check_status',
      resultFailValues: 'manual,fail',
    }),
    (error) => error instanceof CliError && /failing status values/.test(error.message),
  );
});

function makeRunDir(values) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-result-gate-'));
  const rows = values.map((value, index) => JSON.stringify({ index: index + 1, value }));
  fs.writeFileSync(path.join(runDir, 'results.ndjson'), `${rows.join('\n')}\n`);
  return runDir;
}
