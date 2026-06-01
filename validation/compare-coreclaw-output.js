#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [cloudPath, localPath, outPath] = process.argv.slice(2);

if (!cloudPath || !localPath) {
  console.error('Usage: node validation/compare-coreclaw-output.js <cloud.json> <local-results.ndjson> [report.json]');
  process.exit(1);
}

const cloudRows = readCloudRows(cloudPath);
const localRows = readLocalRows(localPath);
const report = compareRows(cloudRows, localRows);

if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));

function readCloudRows(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Cloud output must be a JSON array: ${filePath}`);
  }
  return parsed;
}

function readLocalRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).map((line) => {
    const row = JSON.parse(line);
    return row.value ?? row;
  });
}

function compareRows(cloudRows, localRows) {
  const keyOf = (row) => row.urlUser
    ? `${row.username ?? ''}\t${row.site ?? ''}\t${row.urlUser}`
    : stableStringify(row);

  const cloudMap = new Map(cloudRows.map((row) => [keyOf(row), row]));
  const localMap = new Map(localRows.map((row) => [keyOf(row), row]));
  const shared = localRows.filter((row) => cloudMap.has(keyOf(row)));
  const onlyCloud = cloudRows.filter((row) => !localMap.has(keyOf(row)));
  const onlyLocal = localRows.filter((row) => !cloudMap.has(keyOf(row)));
  const valueDiffs = shared
    .map((local) => ({ local, cloud: cloudMap.get(keyOf(local)) }))
    .filter(({ local, cloud }) => stableStringify(local) !== stableStringify(cloud));

  return {
    cloud_count: cloudRows.length,
    local_count: localRows.length,
    shared_count: shared.length,
    only_cloud_count: onlyCloud.length,
    only_local_count: onlyLocal.length,
    value_diff_count: valueDiffs.length,
    cloud_first_10_keys: cloudRows.slice(0, 10).map(keyOf),
    local_first_10_keys: localRows.slice(0, 10).map(keyOf),
    only_cloud_first_20: onlyCloud.slice(0, 20),
    only_local_first_20: onlyLocal.slice(0, 20),
    value_diff_first_20: valueDiffs.slice(0, 20),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
