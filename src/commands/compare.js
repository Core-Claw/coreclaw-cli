import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { assertCompareThresholds, compareRows, readCloudRows, readLocalRows, resolveLocalRowsPath } from '../compare/rows.js';

export async function compareCommand(cloudPath, localPath, options = {}) {
  if (!cloudPath || !localPath) {
    throw new CliError('compare requires <cloud.json> and <local-run-or-ndjson>.');
  }

  const resolvedCloudPath = path.resolve(process.cwd(), cloudPath);
  const resolvedLocalPath = resolveLocalRowsPath(localPath);
  const cloudRows = readCloudRows(resolvedCloudPath);
  const localRows = readLocalRows(resolvedLocalPath);
  const report = {
    cloud_path: resolvedCloudPath,
    local_path: resolvedLocalPath,
    ...compareRows(cloudRows, localRows, options),
  };

  if (options.output) {
    const outPath = path.resolve(process.cwd(), options.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  printCompareReport(report);
  assertCompareThresholds(report, options);
  return report;
}

function printCompareReport(report) {
  console.log(`Cloud rows: ${report.cloud_count}`);
  console.log(`Local rows: ${report.local_count}`);
  console.log(`Shared rows: ${report.shared_count}`);
  console.log(`Only cloud: ${report.only_cloud_count}`);
  console.log(`Only local: ${report.only_local_count}`);
  console.log(`Value diffs: ${report.value_diff_count}`);
}
