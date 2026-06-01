import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';

export async function inspectRunCommand(runPath, options = {}) {
  if (!runPath) {
    throw new CliError('inspect-run requires a run directory path.');
  }

  const runDir = path.resolve(process.cwd(), runPath);
  const report = inspectRun(runDir);
  printRunReport(report);

  const minResults = parseNonNegativeInteger(options.minResults ?? 0, '--min-results');
  if (report.status !== 'SUCCEEDED') {
    throw new CliError(`Run ${report.run_id} status is ${report.status}, expected SUCCEEDED.`);
  }
  if (report.result_count < minResults) {
    throw new CliError(`Run ${report.run_id} produced ${report.result_count} result(s), expected at least ${minResults}.`);
  }
  if (report.result_count !== report.results_rows) {
    throw new CliError(`Run ${report.run_id} summary result_count=${report.result_count} but results.ndjson has ${report.results_rows} row(s).`);
  }
  if (report.export_rows !== null && report.export_rows !== report.result_count) {
    throw new CliError(`Run ${report.run_id} summary result_count=${report.result_count} but export.ndjson has ${report.export_rows} row(s).`);
  }
  if (report.output_schema_issues_rows !== null && report.output_schema_issues_rows !== report.output_schema_issue_count) {
    throw new CliError(`Run ${report.run_id} summary output_schema_issue_count=${report.output_schema_issue_count} but output_schema_issues.json has ${report.output_schema_issues_rows} issue(s).`);
  }
  if (options.requireOutputSchemaMatch && report.output_schema_issue_count > 0) {
    throw new CliError(`Run ${report.run_id} has ${report.output_schema_issue_count} output_schema mismatch issue(s). See ${report.paths.output_schema_issues}.`);
  }

  return report;
}

export function inspectRun(runDir) {
  const summaryPath = path.join(runDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new CliError(`Missing run summary: ${summaryPath}`);
  }

  const summary = readJson(summaryPath);
  const resultsPath = path.join(runDir, 'results.ndjson');
  const exportPath = path.join(runDir, 'export.ndjson');
  const headersPath = path.join(runDir, 'table_headers.json');
  const logsPath = path.join(runDir, 'logs.ndjson');
  const outputSchemaIssuesPath = path.join(runDir, 'output_schema_issues.json');

  return {
    run_dir: runDir,
    run_id: summary.run_id ?? path.basename(runDir),
    status: summary.status ?? 'UNKNOWN',
    result_count: Number(summary.result_count ?? 0),
    log_count: Number(summary.log_count ?? 0),
    table_header_count: Number(summary.table_header_count ?? 0),
    output_schema_issue_count: Number(summary.output_schema_issue_count ?? 0),
    results_rows: countNdjsonRows(resultsPath),
    export_rows: fs.existsSync(exportPath) ? countNdjsonRows(exportPath) : null,
    log_rows: fs.existsSync(logsPath) ? countNdjsonRows(logsPath) : null,
    table_headers_rows: fs.existsSync(headersPath) ? readJson(headersPath).length : 0,
    output_schema_issues_rows: fs.existsSync(outputSchemaIssuesPath) ? readJson(outputSchemaIssuesPath).length : null,
    paths: {
      summary: summaryPath,
      results: resultsPath,
      export: exportPath,
      logs: logsPath,
      table_headers: headersPath,
      output_schema_issues: outputSchemaIssuesPath,
    },
  };
}

function printRunReport(report) {
  console.log(`Run ${report.run_id}: ${report.status}`);
  console.log(`Results: summary=${report.result_count} results.ndjson=${report.results_rows} export.ndjson=${report.export_rows ?? 'missing'}`);
  console.log(`Logs: summary=${report.log_count} logs.ndjson=${report.log_rows ?? 'missing'}`);
  console.log(`Table headers: summary=${report.table_header_count} file=${report.table_headers_rows}`);
  console.log(`Output schema issues: summary=${report.output_schema_issue_count} file=${report.output_schema_issues_rows ?? 'missing'}`);
}

function parseNonNegativeInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== String(value)) {
    throw new CliError(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function countNdjsonRows(filePath) {
  if (!fs.existsSync(filePath)) {
    return 0;
  }

  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}
