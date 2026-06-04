import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkerZip } from '../src/pack/zip.js';

test('release dossier summarizes package, cloud comparison, diagnosis, and cost evidence', async () => {
  const { releaseCommand } = await import('../src/commands/release.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-release-dossier-'));
  const projectDir = makeNodeWorker(path.join(dir, 'worker-release'));
  const packagePath = path.join(dir, 'worker-release.zip');
  const compareReportPath = path.join(dir, 'cloud-comparison.json');
  const diagnosisPath = path.join(dir, 'diagnosis.json');
  const costPath = path.join(dir, 'cost.json');
  const output = path.join(dir, 'release-dossier.json');
  const markdown = path.join(dir, 'release-dossier.md');
  createWorkerZip({ projectDir, outFile: packagePath });
  fs.writeFileSync(compareReportPath, JSON.stringify({
    summary_schema_version: 1,
    summary: {
      schema_version: 1,
      ok: true,
      counts: {
        shared: 1,
        only_cloud: 0,
        only_local: 0,
        value_diffs: 0,
        cloud_status_issues: 0,
        local_status_issues: 0,
        cloud_output_schema_issues: 0,
        local_output_schema_issues: 0,
      },
    },
  }));
  fs.writeFileSync(diagnosisPath, JSON.stringify({
    run_slug: 'RUN-OK',
    status: 3,
    status_label: 'Succeeded',
    issues: [],
  }));
  fs.writeFileSync(costPath, JSON.stringify({
    run_slug: 'RUN-OK',
    usage_usd: 0.0123,
    traffic_bytes: 2048,
  }));

  const report = await releaseCommand(['dossier', projectDir], {
    package: packagePath,
    cloudRun: 'RUN-OK',
    compareReport: compareReportPath,
    diagnosis: diagnosisPath,
    costReport: costPath,
    output,
    markdown,
  });

  assert.equal(report.readiness.ok, true);
  assert.equal(report.readiness.blocker_count, 0);
  assert.equal(report.local.package.ok, true);
  assert.equal(report.cloud.compare.ok, true);
  assert.equal(report.cloud.diagnosis.status, 3);
  assert.equal(report.cloud.cost.usage_usd, 0.0123);
  assert.equal(report.platform_constraints.upload_api_available, false);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).readiness.ok, true);
  const markdownText = fs.readFileSync(markdown, 'utf8');
  assert.match(markdownText, /^# CoreClaw 发布交付报告/m);
  assert.match(markdownText, /RUN-OK/);
  assert.match(markdownText, /Console/);
});

test('release dossier treats missing cloud comparison as a publish blocker', async () => {
  const { buildReleaseDossier } = await import('../src/commands/release.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-release-missing-cloud-'));
  const projectDir = makeNodeWorker(path.join(dir, 'worker-release'));
  const packagePath = path.join(dir, 'worker-release.zip');
  createWorkerZip({ projectDir, outFile: packagePath });

  const report = buildReleaseDossier(projectDir, { package: packagePath });

  assert.equal(report.readiness.ok, false);
  assert.equal(report.readiness.blockers.some((item) => item.code === 'release_cloud_compare_missing'), true);
  assert.equal(report.next_commands.some((command) => command.includes('coreclaw prove')), true);
});

test('release dossier can consume a runs collect evidence bundle', async () => {
  const { buildReleaseDossier } = await import('../src/commands/release.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-release-run-evidence-'));
  const projectDir = makeNodeWorker(path.join(dir, 'worker-release'));
  const packagePath = path.join(dir, 'worker-release.zip');
  const compareReportPath = path.join(dir, 'cloud-comparison.json');
  const runEvidencePath = path.join(dir, 'run-evidence.json');
  createWorkerZip({ projectDir, outFile: packagePath });
  fs.writeFileSync(compareReportPath, JSON.stringify({
    summary: {
      ok: true,
      schema_version: 1,
      counts: {
        shared: 2,
        only_cloud: 0,
        only_local: 0,
        value_diffs: 0,
      },
    },
  }));
  fs.writeFileSync(runEvidencePath, JSON.stringify({
    run_slug: 'RUN-EVIDENCE',
    diagnosis: {
      run_slug: 'RUN-EVIDENCE',
      status: 3,
      status_label: 'Succeeded',
      issues: [],
    },
    cost: {
      run_slug: 'RUN-EVIDENCE',
      usage_usd: '0.045',
      traffic_bytes: 4096,
      traffic_human: '4.1 KB',
      cost_breakdown_available: false,
    },
  }));

  const report = buildReleaseDossier(projectDir, {
    package: packagePath,
    compareReport: compareReportPath,
    runEvidence: runEvidencePath,
  });

  assert.equal(report.readiness.ok, true);
  assert.equal(report.cloud.run_slug, 'RUN-EVIDENCE');
  assert.equal(report.cloud.run_evidence.run_slug, 'RUN-EVIDENCE');
  assert.equal(report.cloud.diagnosis.status_label, 'Succeeded');
  assert.equal(report.cloud.cost.usage_usd, '0.045');
  assert.equal(report.readiness.warnings.some((warning) => warning.code === 'release_cost_missing'), false);
});

function makeNodeWorker(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.js'), [
    "const coresdk = require('./sdk')",
    'async function main() {',
    '  const input = await coresdk.parameter.getInputJSONObject()',
    "  await coresdk.result.setTableHeader([{ label: 'URL', key: 'url', format: 'text' }])",
    "  await coresdk.result.pushData({ url: input.url || 'https://example.com' })",
    '}',
    'main().catch((error) => { console.error(error); process.exitCode = 1 })',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Release Worker\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), JSON.stringify({
    b: 'urls',
    properties: [
      { name: 'urls', type: 'array', editor: 'stringList', default: ['https://example.com'] },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'output_schema.json'), JSON.stringify([
    { name: 'url', type: 'string' },
  ]));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    type: 'commonjs',
    main: 'main.js',
    dependencies: {
      '@grpc/grpc-js': '^1.14.3',
      'google-protobuf': '^4.0.2',
    },
  }));
  for (const file of ['sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js']) {
    fs.writeFileSync(path.join(dir, file), '');
  }
  return dir;
}
