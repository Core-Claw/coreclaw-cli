import fs from 'node:fs';
import path from 'node:path';
import {
  createClientFromOptions,
  formatTimestamp,
  parseCommaList,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printOrReturn,
  requireArg,
  requireSubcommand,
  statusLabel,
  writeBinaryOutput,
  writeJsonOutput,
} from './cloud-utils.js';
import { CliError } from '../utils/errors.js';
import { formatBytes } from '../utils/bytes.js';

export async function runsCommand(positionals = [], options = {}) {
  const subcommand = requireSubcommand(positionals, 'runs', ['list', 'detail', 'logs', 'results', 'export', 'diagnose', 'cost', 'collect', 'rerun', 'abort']);
  switch (subcommand) {
    case 'list':
      return listRuns(options);
    case 'detail':
      return detailRun(positionals.slice(1), options);
    case 'logs':
      return runLogs(positionals.slice(1), options);
    case 'results':
      return runResults(positionals.slice(1), options);
    case 'export':
      return exportRun(positionals.slice(1), options);
    case 'diagnose':
      return diagnoseRun(positionals.slice(1), options);
    case 'cost':
      return costRun(positionals.slice(1), options);
    case 'collect':
      return collectRun(positionals.slice(1), options);
    case 'rerun':
      return rerun(positionals.slice(1), options);
    case 'abort':
      return abortRun(positionals.slice(1), options);
    default:
      return null;
  }
}

async function listRuns(options) {
  const client = createClientFromOptions(options);
  const response = await client.listRuns({
    pageIndex: parsePositiveInteger(options.pageIndex, 1, '--page-index'),
    pageSize: parsePositiveInteger(options.pageSize, 20, '--page-size'),
    status: parseNonNegativeInteger(options.status, 0, '--status'),
    scraperSlug: options.scraperSlug,
  });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const runs = response.data?.list ?? [];
  console.log(`CoreClaw runs: ${runs.length} of ${response.data?.count ?? runs.length}`);
  for (const run of runs) {
    console.log(`${run.slug ?? '-'}  ${statusLabel(run.status)}  results=${run.results ?? 0}  usage=${run.usage ?? '-'}  ${run.scraper_title ?? '-'}`);
  }
  return response;
}

async function detailRun(args, options) {
  const runSlug = requireArg(args[0], 'runs detail requires <run_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.runDetail(runSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  printRunDetail(response.data ?? {});
  return response;
}

async function runLogs(args, options) {
  const runSlug = requireArg(args[0], 'runs logs requires <run_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.runLogs(runSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const data = response.data ?? {};
  console.log(`Run logs: ${runSlug}`);
  if (data.all_logs_url) {
    console.log(`All logs: ${data.all_logs_url}`);
  }
  for (const entry of data.list ?? []) {
    console.log(`${formatTimestamp(entry.timestamp)} [${logTypeLabel(entry.type)}] ${entry.content ?? ''}`);
  }
  return response;
}

async function runResults(args, options) {
  const runSlug = requireArg(args[0], 'runs results requires <run_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.runResults({
    runSlug,
    pageIndex: parsePositiveInteger(options.pageIndex, 1, '--page-index'),
    pageSize: parsePositiveInteger(options.pageSize, 20, '--page-size'),
  });
  const outputPath = writeJsonOutput(options.output, response);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  const count = response.data?.count ?? response.data?.list?.length ?? 0;
  console.log(`Results: ${count} row(s)`);
  if (outputPath) {
    console.log(`Wrote: ${outputPath}`);
    console.log('Compare with: coreclaw compare <cloud-results.json> .coreclaw/runs/<run-id>');
  }
  return response;
}

async function exportRun(args, options) {
  const runSlug = requireArg(args[0], 'runs export requires <run_slug>.');
  const format = options.format ?? 'json';
  if (!['json', 'csv'].includes(format)) {
    throw new CliError('--format must be json or csv.');
  }
  const client = createClientFromOptions(options);
  const response = await client.exportRun({
    runSlug,
    filterKeys: parseCommaList(options.filterKeys),
    format,
  });
  const downloadPath = options.downloadOutput
    ? await downloadExportFile(response.data?.download_url, options.downloadOutput, options.fetchImpl ?? globalThis.fetch)
    : null;
  const result = downloadPath ? { ...response, download_path: downloadPath } : response;
  const outputPath = writeJsonOutput(options.output, result);
  if (options.jsonOutput) {
    return printOrReturn(result, options);
  }

  console.log(`Export URL: ${response.data?.download_url ?? '-'}`);
  if (outputPath) {
    console.log(`Wrote: ${outputPath}`);
  }
  if (downloadPath) {
    console.log(`Downloaded: ${downloadPath}`);
  }
  return result;
}

async function downloadExportFile(downloadUrl, outputPath, fetchImpl) {
  if (!downloadUrl) {
    throw new CliError('CoreClaw export response did not include data.download_url, so --download-output cannot continue.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new CliError('Downloading CoreClaw export files requires fetch support. Use Node.js 18+ or provide fetchImpl.');
  }

  let response;
  try {
    response = await fetchImpl(downloadUrl, { method: 'GET' });
  } catch (error) {
    throw new CliError(`Failed to download CoreClaw export file: ${error.message}`);
  }

  if (!response.ok) {
    throw new CliError(`Failed to download CoreClaw export file: HTTP ${response.status}.`);
  }

  const bytes = response.arrayBuffer
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text(), 'utf8');
  return writeBinaryOutput(outputPath, bytes);
}

async function diagnoseRun(args, options) {
  const runSlug = requireArg(args[0], 'runs diagnose requires <run_slug>.');
  const client = createClientFromOptions(options);
  const pageSize = parsePositiveInteger(options.pageSize, 20, '--page-size');
  const detailResponse = await client.runDetail(runSlug);
  const [logsResult, resultsResult] = await Promise.all([
    optionalApiCall('logs', () => client.runLogs(runSlug)),
    optionalApiCall('results', () => client.runResults({ runSlug, pageIndex: 1, pageSize })),
  ]);
  const report = buildRunDiagnosis(runSlug, {
    detail: detailResponse.data ?? {},
    logs: logsResult.response?.data ?? {},
    results: resultsResult.response?.data ?? {},
    pageSize,
    optionalErrors: [logsResult.error, resultsResult.error].filter(Boolean),
  });
  const outputPath = writeJsonOutput(options.output, report);
  if (options.jsonOutput) {
    return printOrReturn(report, options);
  }

  printRunDiagnosis(report);
  if (outputPath) {
    console.log(`Wrote: ${outputPath}`);
  }
  return report;
}

async function costRun(args, options) {
  const runSlug = requireArg(args[0], 'runs cost requires <run_slug>.');
  const client = createClientFromOptions(options);
  const detailResponse = await client.runDetail(runSlug);
  const report = buildRunCostReport(runSlug, detailResponse.data ?? {});
  const outputPath = writeJsonOutput(options.output, report);
  if (options.jsonOutput) {
    return printOrReturn(report, options);
  }

  printRunCost(report);
  if (outputPath) {
    console.log(`Wrote: ${outputPath}`);
  }
  return report;
}

async function collectRun(args, options) {
  const runSlug = requireArg(args[0], 'runs collect requires <run_slug>.');
  const format = options.format ?? 'json';
  if (!['json', 'csv'].includes(format)) {
    throw new CliError('--format must be json or csv.');
  }

  const client = createClientFromOptions(options);
  const pageIndex = parsePositiveInteger(options.pageIndex, 1, '--page-index');
  const pageSize = parsePositiveInteger(options.pageSize, 20, '--page-size');
  const filterKeys = parseCommaList(options.filterKeys);
  const detailResponse = await client.runDetail(runSlug);
  const [logsResult, resultsResult, exportResult] = await Promise.all([
    optionalApiCall('logs', () => client.runLogs(runSlug)),
    optionalApiCall('results', () => client.runResults({ runSlug, pageIndex, pageSize })),
    optionalApiCall('export', () => client.exportRun({ runSlug, filterKeys, format })),
  ]);
  const downloadPath = exportResult.response && options.downloadOutput
    ? await downloadExportFile(exportResult.response.data?.download_url, options.downloadOutput, options.fetchImpl ?? globalThis.fetch)
    : null;
  const report = buildRunEvidenceBundle(runSlug, {
    detailResponse,
    logsResult,
    resultsResult,
    exportResult,
    downloadPath,
    pageIndex,
    pageSize,
    filterKeys,
    format,
  });

  const jsonPath = options.output ? path.resolve(process.cwd(), options.output) : null;
  const markdownPath = options.markdown ? writeTextOutput(options.markdown, renderRunEvidenceMarkdown(report)) : null;
  report.files = {
    json: jsonPath,
    markdown: markdownPath,
    export_download: downloadPath,
  };
  if (jsonPath) {
    writeJsonOutput(jsonPath, report);
  }

  if (options.jsonOutput) {
    return printOrReturn(report, options);
  }

  printRunEvidence(report);
  if (jsonPath) {
    console.log(`Wrote: ${jsonPath}`);
  }
  if (markdownPath) {
    console.log(`Markdown: ${markdownPath}`);
  }
  if (downloadPath) {
    console.log(`Downloaded: ${downloadPath}`);
  }
  return report;
}

async function optionalApiCall(source, fn) {
  try {
    return { response: await fn(), error: null };
  } catch (error) {
    return {
      response: null,
      error: {
        source,
        message: error.message,
      },
    };
  }
}

async function rerun(args, options) {
  const runSlug = requireArg(args[0], 'runs rerun requires <run_slug>.');
  if (!options.callbackUrl) {
    throw new CliError('runs rerun requires --callback-url from the documented CoreClaw Re-run API contract.');
  }
  const client = createClientFromOptions(options);
  const response = await client.rerun({ runSlug, callbackUrl: options.callbackUrl });
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  console.log(`Re-run started: ${response.data?.run_slug ?? '-'}`);
  console.log(`Source run: ${runSlug}`);
  return response;
}

async function abortRun(args, options) {
  const runSlug = requireArg(args[0], 'runs abort requires <run_slug>.');
  const client = createClientFromOptions(options);
  const response = await client.abortRun(runSlug);
  if (options.jsonOutput) {
    return printOrReturn(response, options);
  }

  console.log(`Abort requested: ${runSlug}`);
  return response;
}

function buildRunDiagnosis(runSlug, { detail = {}, logs = {}, results = {}, pageSize = 20, optionalErrors = [] } = {}) {
  const status = Number(detail.status);
  const logEntries = logs.list ?? [];
  const errorLogs = logEntries.filter((entry) => Number(entry.type) === 4);
  const warningLogs = logEntries.filter((entry) => Number(entry.type) === 3);
  const issues = buildDiagnosisIssues({ status, detail, errorLogs, warningLogs, results, optionalErrors });

  return {
    run_slug: runSlug,
    status,
    status_label: statusLabel(status),
    worker: {
      scraper_slug: detail.scraper_slug ?? null,
      title: detail.scraper_title ?? null,
      version: detail.version ?? null,
    },
    timing: {
      started_at: detail.started_at ?? null,
      started_at_iso: formatTimestamp(detail.started_at),
      finished_at: detail.finished_at ?? null,
      finished_at_iso: formatTimestamp(detail.finished_at),
    },
    usage: {
      usage: detail.usage ?? null,
      traffic: detail.traffic ?? null,
    },
    error: detail.err_msg || null,
    results: {
      count: results.count ?? results.list?.length ?? detail.results ?? 0,
      sample_count: results.list?.length ?? 0,
      sample_page_size: pageSize,
      headers: results.headers ?? [],
    },
    logs: {
      count: logEntries.length,
      error_count: errorLogs.length,
      warning_count: warningLogs.length,
      all_logs_url: logs.all_logs_url ?? null,
      recent: logEntries,
      recent_errors: errorLogs,
      recent_warnings: warningLogs,
    },
    optional_errors: optionalErrors,
    issues,
    next_commands: buildDiagnosisNextCommands(runSlug, status),
  };
}

function buildDiagnosisIssues({ status, detail, errorLogs, warningLogs, results, optionalErrors = [] }) {
  const issues = [];
  if (status === 4) {
    issues.push({
      severity: 'error',
      code: 'RUN_FAILED',
      message: detail.err_msg || 'CoreClaw run failed. Check recent error logs and full logs.',
    });
  } else if (status === 5) {
    issues.push({
      severity: 'warning',
      code: 'RUN_ABORTED',
      message: 'CoreClaw run was aborted before completion.',
    });
  } else if (status === 1 || status === 2) {
    issues.push({
      severity: 'info',
      code: 'RUN_NOT_TERMINAL',
      message: 'CoreClaw run is not terminal yet. Re-run diagnose later or use workers run --wait for new runs.',
    });
  }
  if (errorLogs.length > 0) {
    issues.push({
      severity: 'error',
      code: 'RECENT_ERROR_LOGS',
      message: `${errorLogs.length} recent error log(s) were returned by CoreClaw.`,
    });
  }
  if (warningLogs.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'RECENT_WARNING_LOGS',
      message: `${warningLogs.length} recent warning log(s) were returned by CoreClaw.`,
    });
  }
  if (optionalErrors.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'OPTIONAL_API_UNAVAILABLE',
      message: `${optionalErrors.length} optional CoreClaw API response(s) were unavailable during diagnosis.`,
    });
  }
  const resultCount = results.count ?? results.list?.length ?? detail.results ?? 0;
  if (status === 3 && resultCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'NO_RESULTS',
      message: 'CoreClaw run succeeded but returned zero results.',
    });
  }
  return issues;
}

function buildDiagnosisNextCommands(runSlug, status) {
  const commands = [
    `coreclaw runs logs ${runSlug}`,
    `coreclaw runs detail ${runSlug}`,
    `coreclaw runs results ${runSlug} --output cloud-results.json`,
  ];
  if (status === 4 || status === 5) {
    commands.push(`coreclaw runs rerun ${runSlug} --callback-url https://example.com/webhook`);
  }
  return commands;
}

function printRunDiagnosis(report) {
  console.log(`Run diagnosis: ${report.run_slug}`);
  console.log(`Status: ${report.status_label} (${report.status})`);
  console.log(`Worker: ${report.worker.title ?? '-'} (${report.worker.scraper_slug ?? '-'})`);
  console.log(`Version: ${report.worker.version ?? '-'}`);
  console.log(`Results: ${report.results.count}`);
  console.log(`Usage: ${report.usage.usage ?? '-'}`);
  console.log(`Traffic: ${report.usage.traffic ?? '-'}`);
  if (report.error) {
    console.log(`Error: ${report.error}`);
  }
  if (report.logs.all_logs_url) {
    console.log(`All logs: ${report.logs.all_logs_url}`);
  }
  if (report.optional_errors.length > 0) {
    console.log('Optional CoreClaw API data unavailable:');
    for (const error of report.optional_errors) {
      console.log(`  ${error.source}: ${error.message}`);
    }
  }
  if (report.issues.length > 0) {
    console.log('Issues:');
    for (const issue of report.issues) {
      console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  } else {
    console.log('Issues: none detected from current CoreClaw API data.');
  }
  if (report.logs.recent_errors.length > 0) {
    console.log('Recent error logs:');
    for (const entry of report.logs.recent_errors) {
      console.log(`  ${formatTimestamp(entry.timestamp)} ${entry.content ?? ''}`);
    }
  }
  console.log('Next commands:');
  for (const command of report.next_commands) {
    console.log(`  ${command}`);
  }
}

function buildRunEvidenceBundle(runSlug, {
  detailResponse,
  logsResult,
  resultsResult,
  exportResult,
  downloadPath,
  pageIndex = 1,
  pageSize = 20,
  filterKeys = [],
  format = 'json',
} = {}) {
  const detail = detailResponse.data ?? {};
  const logs = logsResult.response?.data ?? {};
  const results = resultsResult.response?.data ?? {};
  const optionalErrors = [logsResult.error, resultsResult.error, exportResult.error].filter(Boolean);
  const diagnosis = buildRunDiagnosis(runSlug, {
    detail,
    logs,
    results,
    pageSize,
    optionalErrors,
  });
  const cost = buildRunCostReport(runSlug, detail);

  return {
    run_slug: runSlug,
    generated_at: new Date().toISOString(),
    detail: {
      response: detailResponse,
    },
    diagnosis,
    cost,
    logs: {
      response: logsResult.response,
      error: logsResult.error,
    },
    results: {
      page_index: pageIndex,
      page_size: pageSize,
      response: resultsResult.response,
      error: resultsResult.error,
    },
    export: {
      format,
      filter_keys: filterKeys,
      response: exportResult.response,
      error: exportResult.error,
      download_path: downloadPath,
    },
    optional_errors: optionalErrors,
    files: {
      json: null,
      markdown: null,
      export_download: downloadPath,
    },
    next_commands: [
      `coreclaw runs detail ${runSlug}`,
      `coreclaw runs logs ${runSlug}`,
      `coreclaw runs results ${runSlug} --output cloud-results.json`,
      `coreclaw runs export ${runSlug} --format ${format}`,
      `coreclaw runs diagnose ${runSlug} --output diagnosis.json`,
      `coreclaw runs cost ${runSlug} --output cost.json`,
    ],
  };
}

function buildRunCostReport(runSlug, detail = {}) {
  const trafficBytes = Number(detail.traffic ?? 0);
  return {
    run_slug: runSlug,
    status: Number(detail.status),
    status_label: statusLabel(detail.status),
    worker: {
      scraper_slug: detail.scraper_slug ?? null,
      title: detail.scraper_title ?? null,
      version: detail.version ?? null,
    },
    usage_usd: detail.usage ?? null,
    traffic_bytes: Number.isFinite(trafficBytes) ? trafficBytes : null,
    traffic_human: Number.isFinite(trafficBytes) ? formatBytes(trafficBytes) : 'unknown size',
    duration_seconds: detail.duration ?? null,
    results: detail.results ?? 0,
    origin: detail.origin ?? null,
    started_at: detail.started_at ?? null,
    started_at_iso: formatTimestamp(detail.started_at),
    finished_at: detail.finished_at ?? null,
    finished_at_iso: formatTimestamp(detail.finished_at),
    cost_breakdown_available: false,
    platform_gap: 'CoreClaw Run Detail exposes aggregate usage and traffic only; CPU, memory, proxy, browser, and CAPTCHA cost breakdowns require a future platform API.',
    next_commands: [
      `coreclaw runs detail ${runSlug}`,
      `coreclaw runs diagnose ${runSlug}`,
    ],
  };
}

function printRunCost(report) {
  console.log(`Run cost: ${report.run_slug}`);
  console.log(`Status: ${report.status_label} (${report.status})`);
  console.log(`Worker: ${report.worker.title ?? '-'} (${report.worker.scraper_slug ?? '-'})`);
  console.log(`Version: ${report.worker.version ?? '-'}`);
  console.log(`Usage: ${formatUsd(report.usage_usd)}`);
  console.log(`Traffic: ${report.traffic_human} (${report.traffic_bytes ?? '-'} bytes)`);
  console.log(`Duration: ${report.duration_seconds ?? '-'}s`);
  console.log(`Results: ${report.results}`);
  console.log('Cost breakdown: not available from current CoreClaw API.');
  console.log(`Platform gap: ${report.platform_gap}`);
  console.log('Next commands:');
  for (const command of report.next_commands) {
    console.log(`  ${command}`);
  }
}

function printRunEvidence(report) {
  console.log(`Run evidence: ${report.run_slug}`);
  console.log(`Status: ${report.diagnosis.status_label} (${report.diagnosis.status})`);
  console.log(`Worker: ${report.diagnosis.worker.title ?? '-'} (${report.diagnosis.worker.scraper_slug ?? '-'})`);
  console.log(`Version: ${report.diagnosis.worker.version ?? '-'}`);
  console.log(`Results: ${report.diagnosis.results.count}`);
  console.log(`Usage: ${formatUsd(report.cost.usage_usd)}`);
  console.log(`Traffic: ${report.cost.traffic_human} (${report.cost.traffic_bytes ?? '-'} bytes)`);
  console.log(`Logs: ${report.diagnosis.logs.count} recent entries`);
  if (report.export.response?.data?.download_url) {
    console.log(`Export: ${report.export.response.data.download_url}`);
  }
  if (report.optional_errors.length > 0) {
    console.log('Optional CoreClaw API data unavailable:');
    for (const error of report.optional_errors) {
      console.log(`  ${error.source}: ${error.message}`);
    }
  }
  if (report.diagnosis.issues.length > 0) {
    console.log('Issues:');
    for (const issue of report.diagnosis.issues) {
      console.log(`  [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  } else {
    console.log('Issues: none detected from current CoreClaw API data.');
  }
}

function renderRunEvidenceMarkdown(report) {
  const lines = [
    '# CoreClaw run evidence',
    '',
    `Run: \`${report.run_slug}\``,
    '',
    `Status: ${report.diagnosis.status_label} (${report.diagnosis.status})`,
    '',
    `Worker: ${report.diagnosis.worker.title ?? '-'} (${report.diagnosis.worker.scraper_slug ?? '-'})`,
    '',
    `Version: ${report.diagnosis.worker.version ?? '-'}`,
    '',
    '## Summary',
    '',
    `- Results: ${report.diagnosis.results.count}`,
    `- Usage: ${formatUsd(report.cost.usage_usd)}`,
    `- Traffic: ${report.cost.traffic_human} (${report.cost.traffic_bytes ?? '-'} bytes)`,
    `- Recent logs: ${report.diagnosis.logs.count}`,
    `- Export URL: ${report.export.response?.data?.download_url ?? '-'}`,
    '',
    '## Issues',
    '',
  ];

  if (report.diagnosis.issues.length === 0) {
    lines.push('- None detected from current CoreClaw API data.');
  } else {
    for (const issue of report.diagnosis.issues) {
      lines.push(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }

  lines.push('', '## Next Commands', '');
  for (const command of report.next_commands) {
    lines.push(`- \`${command}\``);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeTextOutput(filePath, text) {
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, text, 'utf8');
  return resolved;
}

function formatUsd(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value).startsWith('$') ? String(value) : `$${value}`;
}

function printRunDetail(run) {
  console.log(`Run: ${run.slug ?? '-'}`);
  console.log(`Status: ${statusLabel(run.status)}`);
  console.log(`Worker: ${run.scraper_title ?? '-'} (${run.scraper_slug ?? '-'})`);
  console.log(`Version: ${run.version ?? '-'}`);
  console.log(`Results: ${run.results ?? 0}`);
  console.log(`Usage: ${run.usage ?? '-'}`);
  console.log(`Traffic: ${run.traffic ?? '-'}`);
  console.log(`Started: ${formatTimestamp(run.started_at)}`);
  console.log(`Finished: ${formatTimestamp(run.finished_at)}`);
  if (run.err_msg) {
    console.log(`Error: ${run.err_msg}`);
  }
}

function logTypeLabel(type) {
  return {
    1: 'debug',
    2: 'info',
    3: 'warn',
    4: 'error',
  }[Number(type)] ?? String(type ?? 'log');
}
