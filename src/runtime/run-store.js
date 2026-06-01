import fs from 'node:fs';
import path from 'node:path';

export function makeRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

export class RunStore {
  constructor({ projectDir, artifactProjectDir = projectDir, runId = makeRunId(), input, env, command, outputSchema = [], uploadManifest = null }) {
    this.projectDir = artifactProjectDir;
    this.workerDir = projectDir;
    this.runId = runId;
    this.runDir = path.join(artifactProjectDir, '.coreclaw', 'runs', runId);
    this.tmpDir = path.join(this.runDir, 'tmp');
    this.input = input;
    this.env = env;
    this.command = command;
    this.outputSchema = outputSchema;
    this.uploadManifest = uploadManifest;
    this.tableHeaders = [];
    this.outputSchemaIssues = [];
    this.resultCount = 0;
    this.logCount = 0;
    this.startedAt = new Date();
    this.status = 'RUNNING';
    this.exitCode = null;
  }

  init() {
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });
    this.writeJson('input.json', this.input);
    this.writeJson('env.json', this.env);
    this.writeJson('command.json', this.command);
    this.writeJson('output_schema_snapshot.json', this.outputSchema);
    if (this.uploadManifest) {
      this.writeJson('upload_manifest.json', this.uploadManifest);
    }
    this.writeJson('summary.json', this.summary());
  }

  writeJson(fileName, value) {
    fs.writeFileSync(path.join(this.runDir, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  appendNdjson(fileName, value) {
    fs.appendFileSync(path.join(this.runDir, fileName), `${JSON.stringify(value)}\n`, 'utf8');
  }

  recordTableHeaders(headers) {
    this.tableHeaders = headers;
    this.writeJson('table_headers.json', headers);
    this.writeJson('summary.json', this.summary());
    return { code: 0, message: 'ok' };
  }

  recordResult(rawJsonString) {
    let value;
    try {
      value = JSON.parse(rawJsonString);
    } catch (error) {
      value = { __raw: rawJsonString, __parse_error: error.message };
    }

    this.resultCount += 1;
    const row = {
      index: this.resultCount,
      time: new Date().toISOString(),
      value,
    };
    this.appendNdjson('results.ndjson', row);
    this.appendNdjson('export.ndjson', {
      ...row,
      value: this.exportValue(value),
    });
    this.recordOutputSchemaIssues(value, this.resultCount);
    this.writeJson('summary.json', this.summary());
    return { code: 0, message: 'ok' };
  }

  exportValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(this.outputSchema) || this.outputSchema.length === 0) {
      return value;
    }

    const projected = {};
    for (const column of this.outputSchema) {
      if (column?.name && Object.prototype.hasOwnProperty.call(value, column.name)) {
        projected[column.name] = value[column.name];
      }
    }
    return projected;
  }

  recordOutputSchemaIssues(value, index) {
    const issues = validateOutputSchemaRow(this.outputSchema, value, index);
    if (issues.length === 0) {
      return;
    }
    this.outputSchemaIssues.push(...issues);
    this.writeJson('output_schema_issues.json', this.outputSchemaIssues);
  }

  recordLog(level, message, source = 'sdk') {
    this.logCount += 1;
    const row = {
      index: this.logCount,
      time: new Date().toISOString(),
      level,
      source,
      message: String(message ?? ''),
    };
    this.appendNdjson('logs.ndjson', row);
    if (this.logCount % 10 === 0) {
      this.writeJson('summary.json', this.summary());
    }
    return row;
  }

  finish({ exitCode, signal, error } = {}) {
    this.exitCode = typeof exitCode === 'number' ? exitCode : null;
    this.signal = signal ?? null;
    this.error = error ? String(error.stack ?? error.message ?? error) : null;
    this.status = this.exitCode === 0 && !this.error ? 'SUCCEEDED' : 'FAILED';
    this.finishedAt = new Date();
    this.writeJson('summary.json', this.summary());
  }

  summary() {
    const finishedAt = this.finishedAt ?? null;
    return {
      run_id: this.runId,
      status: this.status,
      status_code: statusCode(this.status),
      project_dir: this.projectDir,
      worker_dir: this.workerDir,
      started_at: this.startedAt.toISOString(),
      finished_at: finishedAt ? finishedAt.toISOString() : null,
      duration_ms: finishedAt ? finishedAt.getTime() - this.startedAt.getTime() : null,
      exit_code: this.exitCode,
      signal: this.signal ?? null,
      error: this.error ?? null,
      input_path: path.join(this.runDir, 'input.json'),
      logs_path: path.join(this.runDir, 'logs.ndjson'),
      results_path: path.join(this.runDir, 'results.ndjson'),
      export_path: path.join(this.runDir, 'export.ndjson'),
      table_headers_path: path.join(this.runDir, 'table_headers.json'),
      upload_manifest_path: this.uploadManifest ? path.join(this.runDir, 'upload_manifest.json') : null,
      tmp_path: this.tmpDir,
      result_count: this.resultCount,
      log_count: this.logCount,
      table_header_count: this.tableHeaders.length,
      output_schema_issue_count: this.outputSchemaIssues.length,
      output_schema_issues_path: this.outputSchemaIssues.length > 0
        ? path.join(this.runDir, 'output_schema_issues.json')
        : null,
    };
  }
}

export function validateOutputSchemaRow(outputSchema, value, index) {
  const names = outputSchemaNames(outputSchema);
  if (names.length === 0) {
    return [];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{
      severity: 'warn',
      code: 'result_row_not_object',
      result_index: index,
      message: `Result row ${index} is not a JSON object, so it cannot match output_schema.json.`,
    }];
  }

  const issues = [];
  const schemaNameSet = new Set(names);
  const rowKeys = Object.keys(value);
  const rowKeySet = new Set(rowKeys);

  for (const name of names) {
    if (!rowKeySet.has(name)) {
      issues.push({
        severity: 'warn',
        code: 'result_missing_output_schema_field',
        result_index: index,
        field: name,
        message: `Result row ${index} is missing output_schema field "${name}".`,
      });
    }
  }

  for (const key of rowKeys) {
    if (!schemaNameSet.has(key)) {
      issues.push({
        severity: 'warn',
        code: 'result_field_not_in_output_schema',
        result_index: index,
        field: key,
        message: `Result row ${index} field "${key}" is not declared in output_schema.json.`,
      });
    }
  }

  return issues;
}

function outputSchemaNames(outputSchema) {
  if (!Array.isArray(outputSchema)) {
    return [];
  }
  return outputSchema
    .map((column) => column?.name)
    .filter((name) => typeof name === 'string' && name.length > 0);
}

function statusCode(status) {
  switch (status) {
    case 'READY':
      return 1;
    case 'RUNNING':
      return 2;
    case 'SUCCEEDED':
      return 3;
    case 'FAILED':
      return 4;
    case 'ABORTING':
      return 5;
    default:
      return 0;
  }
}
