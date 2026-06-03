import fs from 'node:fs';
import path from 'node:path';
import { resultStatusIssues, shouldRequireStatusGate } from '../runtime/result-gates.js';
import { CliError } from '../utils/errors.js';
import { printJson, shouldPrintJson } from '../utils/output.js';

export async function inspectRunCommand(runPath, options = {}) {
  if (!runPath) {
    throw new CliError('inspect-run requires a run directory path.');
  }

  const runDir = path.resolve(process.cwd(), runPath);
  const report = inspectRun(runDir, options);
  if (shouldPrintJson(options)) {
    printJson(report);
  } else {
    printRunReport(report);
  }

  const minResults = parseNonNegativeInteger(options.minResults ?? 0, '--min-results');
  if (report.status !== 'SUCCEEDED') {
    throw new CliError(withRemediation(report, `Run ${report.run_id} status is ${report.status}, expected SUCCEEDED.`));
  }
  if (report.result_count < minResults) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} produced ${report.result_count} result(s), expected at least ${minResults}.`, 'missing_results'));
  }
  if (report.result_count !== report.results_rows) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} summary result_count=${report.result_count} but results.ndjson has ${report.results_rows} row(s).`, 'missing_results'));
  }
  if (report.export_rows !== null && report.export_rows !== report.result_count) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} summary result_count=${report.result_count} but export.ndjson has ${report.export_rows} row(s).`, 'export_drift'));
  }
  if (report.output_schema_issues_rows !== null && report.output_schema_issues_rows !== report.output_schema_issue_count) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} summary output_schema_issue_count=${report.output_schema_issue_count} but output_schema_issues.json has ${report.output_schema_issues_rows} issue(s).`, 'output_schema_artifact_drift'));
  }
  if (options.requireOutputSchemaMatch && report.output_schema_issue_count > 0) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} has ${report.output_schema_issue_count} output_schema mismatch issue(s). See ${report.paths.output_schema_issues}.`, 'output_schema_mismatch'));
  }
  if (shouldRequireStatusGate(options) && report.result_status_issue_count > 0) {
    throw new CliError(withRemediation(report, `Run ${report.run_id} has ${report.result_status_issue_count} failing result status row(s). See ${report.paths.results}.`, 'result_status_failure'));
  }

  return report;
}

export function inspectRun(runDir, options = {}) {
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
  const statusIssues = resultStatusIssues(runDir, options);

  const report = {
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
    result_status_issue_count: statusIssues.length,
    result_status_issues: statusIssues,
    paths: {
      summary: summaryPath,
      results: resultsPath,
      export: exportPath,
      logs: logsPath,
      table_headers: headersPath,
      output_schema_issues: outputSchemaIssuesPath,
    },
  };
  return {
    ...report,
    remediation: remediationForReport(report),
  };
}

function printRunReport(report) {
  console.log(`Run ${report.run_id}: ${report.status}`);
  console.log(`Results: summary=${report.result_count} results.ndjson=${report.results_rows} export.ndjson=${report.export_rows ?? 'missing'}`);
  console.log(`Logs: summary=${report.log_count} logs.ndjson=${report.log_rows ?? 'missing'}`);
  console.log(`Table headers: summary=${report.table_header_count} file=${report.table_headers_rows}`);
  console.log(`Output schema issues: summary=${report.output_schema_issue_count} file=${report.output_schema_issues_rows ?? 'missing'}`);
  console.log(`Result status issues: ${report.result_status_issue_count}`);
  for (const item of report.remediation) {
    console.log(`Remediation [${item.code}]: ${item.message}`);
  }
}

function remediationForReport(report) {
  const items = [];
  if (report.status !== 'SUCCEEDED') {
    items.push({
      code: 'run_not_succeeded',
      message: 'Review logs.ndjson and rerun coreclaw run or coreclaw verify after fixing the Worker process error.',
    });
  }
  if (report.result_count === 0 || report.results_rows < report.result_count) {
    items.push({
      code: 'missing_results',
      message: 'Confirm the Worker calls the SDK result push API for each successful output row and does not exit before awaiting those calls. Worker did not persist expected result rows.',
    });
  }
  if (report.export_rows !== null && report.export_rows !== report.result_count) {
    items.push({
      code: 'export_drift',
      message: 'Rerun the Worker after checking output_schema.json; export.ndjson should be regenerated from pushed rows and declared output columns.',
    });
  }
  if (report.table_header_count === 0 || report.table_headers_rows === 0) {
    items.push({
      code: 'missing_table_header',
      message: 'Set runtime table headers through the SDK before pushing rows, then rerun with --require-table-header during upload preflight.',
    });
  }
  if (report.output_schema_issue_count > 0) {
    items.push({
      code: 'output_schema_mismatch',
      message: 'Align output_schema.json with the JSON object keys and value types passed to the SDK result push API.',
    });
  }
  if (report.output_schema_issues_rows !== null && report.output_schema_issues_rows !== report.output_schema_issue_count) {
    items.push({
      code: 'output_schema_artifact_drift',
      message: 'Re-run the Worker to regenerate output_schema_issues.json, then inspect the recorded mismatch details.',
    });
  }
  if (report.result_status_issue_count > 0) {
    items.push({
      code: 'result_status_failure',
      message: 'Fix the Worker branch that produced failing status values, or configure --result-status-fields and --result-fail-values if the default status gate does not match this Worker.',
    });
  }
  return items;
}

function withRemediation(report, message, preferredCode = null) {
  const item = preferredCode
    ? report.remediation.find((entry) => entry.code === preferredCode)
    : report.remediation[0];
  return item ? `${message}\nRemediation: ${item.message}` : message;
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
    return JSON.parse(stripBom(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
