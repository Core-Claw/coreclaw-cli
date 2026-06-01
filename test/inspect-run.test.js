import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRun, inspectRunCommand } from '../src/commands/inspect-run.js';
import { CliError } from '../src/utils/errors.js';

test('inspectRun reports artifact row counts', () => {
  const runDir = makeRunDir({ resultCount: 2, resultsRows: 2, exportRows: 2, outputSchemaIssueCount: 1 });

  assert.deepEqual(
    pick(inspectRun(runDir), ['status', 'result_count', 'results_rows', 'export_rows', 'table_headers_rows', 'output_schema_issue_count', 'output_schema_issues_rows']),
    {
      status: 'SUCCEEDED',
      result_count: 2,
      results_rows: 2,
      export_rows: 2,
      table_headers_rows: 1,
      output_schema_issue_count: 1,
      output_schema_issues_rows: 1,
    },
  );
});

test('inspectRunCommand rejects missing results', async () => {
  const runDir = makeRunDir({ resultCount: 1, resultsRows: 0, exportRows: 0 });

  await assert.rejects(
    () => inspectRunCommand(runDir),
    (error) => error instanceof CliError && /results\.ndjson has 0 row/.test(error.message),
  );
});

test('inspectRunCommand enforces minimum result count', async () => {
  const runDir = makeRunDir({ resultCount: 1, resultsRows: 1, exportRows: 1 });

  await assert.rejects(
    () => inspectRunCommand(runDir, { minResults: '2' }),
    (error) => error instanceof CliError && /expected at least 2/.test(error.message),
  );
});

test('inspectRunCommand can enforce output_schema match', async () => {
  const runDir = makeRunDir({ resultCount: 1, resultsRows: 1, exportRows: 1, outputSchemaIssueCount: 1 });

  await assert.rejects(
    () => inspectRunCommand(runDir, { requireOutputSchemaMatch: true }),
    (error) => error instanceof CliError && /output_schema mismatch/.test(error.message),
  );
});

function makeRunDir({ resultCount, resultsRows, exportRows, outputSchemaIssueCount = 0 }) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-inspect-run-'));
  fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify({
    run_id: path.basename(runDir),
    status: 'SUCCEEDED',
    result_count: resultCount,
    log_count: 1,
    table_header_count: 1,
    output_schema_issue_count: outputSchemaIssueCount,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, 'table_headers.json'), '[{"key":"name"}]\n');
  fs.writeFileSync(path.join(runDir, 'logs.ndjson'), '{"message":"ok"}\n');
  writeRows(path.join(runDir, 'results.ndjson'), resultsRows);
  writeRows(path.join(runDir, 'export.ndjson'), exportRows);
  if (outputSchemaIssueCount > 0) {
    fs.writeFileSync(path.join(runDir, 'output_schema_issues.json'), `${JSON.stringify(Array.from(
      { length: outputSchemaIssueCount },
      (_item, index) => ({ index: index + 1, code: 'result_field_not_in_output_schema' }),
    ), null, 2)}\n`);
  }
  return runDir;
}

function writeRows(filePath, count) {
  const rows = Array.from({ length: count }, (_item, index) => JSON.stringify({ index: index + 1, value: { name: `row-${index + 1}` } }));
  fs.writeFileSync(filePath, rows.length ? `${rows.join('\n')}\n` : '');
}

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
