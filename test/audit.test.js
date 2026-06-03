import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditCommand, discoverWorkerDirs } from '../src/commands/audit.js';
import { CliError } from '../src/utils/errors.js';

test('discoverWorkerDirs finds product worker roots and skips ignored directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-'));
  const worker = path.join(root, 'worker-one');
  const nested = path.join(root, 'group', 'worker-two');
  const sourceLike = path.join(root, 'library', 'src');
  const ignored = path.join(root, 'node_modules', 'worker-three');
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(sourceLike, { recursive: true });
  fs.mkdirSync(ignored, { recursive: true });
  fs.writeFileSync(path.join(worker, 'main.js'), '');
  fs.writeFileSync(path.join(nested, 'main.py'), '');
  fs.writeFileSync(path.join(sourceLike, 'main.js'), '');
  fs.writeFileSync(path.join(ignored, 'main.js'), '');

  assert.deepEqual(
    discoverWorkerDirs(root).map((dir) => path.basename(dir)).sort(),
    ['worker-one', 'worker-two'],
  );
});

test('discoverWorkerDirs all mode includes non-product worker-like roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-all-'));
  const worker = path.join(root, 'worker-one');
  const example = path.join(root, 'examples', 'node-hello');
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(example, { recursive: true });
  fs.writeFileSync(path.join(worker, 'main.js'), '');
  fs.writeFileSync(path.join(example, 'main.js'), '');

  assert.deepEqual(
    discoverWorkerDirs(root, { all: true }).map((dir) => path.basename(dir)).sort(),
    ['node-hello', 'worker-one'],
  );
});

test('auditCommand can fail on warnings for strict pre-upload gates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-warn-gate-'));
  makeNodeWorker(path.join(root, 'worker-warning'), { outputSchema: false });

  const softReport = await auditCommand(root, { soft: true });
  assert.equal(softReport.totals.warn, 1);
  assert.equal(softReport.totals.errors, 0);

  await assert.rejects(
    () => auditCommand(root, { failOnWarn: true }),
    (error) => error instanceof CliError && /warnings and --fail-on-warn/.test(error.message),
  );
});

test('auditCommand can ignore known issue codes while keeping evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-ignore-codes-'));
  makeNodeWorker(path.join(root, 'worker-warning'), { outputSchema: false });

  const report = await auditCommand(root, {
    failOnWarn: true,
    ignoreIssueCodes: 'missing_output_schema_legacy',
  });

  assert.equal(report.totals.pass, 1);
  assert.equal(report.totals.warn, 0);
  assert.equal(report.totals.ignored_issue_count, 1);
  assert.equal(report.workers[0].issues.length, 0);
  assert.equal(report.workers[0].ignored_issues[0].code, 'missing_output_schema_legacy');
});

test('auditCommand writes ignored issue counts and codes to reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-reports-'));
  const outFile = path.join(root, 'audit.json');
  const markdownFile = path.join(root, 'audit.md');
  makeNodeWorker(path.join(root, 'worker-warning'), { outputSchema: false });

  await auditCommand(root, {
    output: outFile,
    markdown: markdownFile,
    ignoreIssueCodes: 'missing_output_schema_legacy',
  });

  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const markdown = fs.readFileSync(markdownFile, 'utf8');
  assert.equal(report.totals.ignored_issue_count, 1);
  assert.equal(report.workers[0].ignored_issue_count, 1);
  assert.match(markdown, /Ignored/);
  assert.match(markdown, /missing_output_schema_legacy/);
});

test('auditCommand writes structured issue details to reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-issue-details-'));
  const outFile = path.join(root, 'audit.json');
  const markdownFile = path.join(root, 'audit.md');
  makeNodeWorker(path.join(root, 'worker-http-proxy-warning'), {
    mainJs: [
      "const axios = require('axios')",
      "axios.get('https://example.com')",
      '',
    ].join('\n'),
  });

  await auditCommand(root, {
    output: outFile,
    markdown: markdownFile,
    soft: true,
  });

  const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const markdown = fs.readFileSync(markdownFile, 'utf8');
  const issue = report.workers[0].issues.find((item) => item.code === 'http_proxy_env_not_used');

  assert.deepEqual(issue.docs, ['worker-definition/platform-features/proxy-support.md']);
  assert.deepEqual(issue.evidence.http_client_files, ['main.js']);
  assert.deepEqual(issue.evidence.missing_env, ['PROXY_AUTH', 'PROXY_DOMAIN']);
  assert.deepEqual(issue.commands, [
    `node ./bin/coreclaw.js validate "${path.join(root, 'worker-http-proxy-warning')}" --strict`,
    `node ./bin/coreclaw.js verify "${path.join(root, 'worker-http-proxy-warning')}" --strict --min-results 1`,
  ]);
  assert.match(markdown, /Docs: worker-definition\/platform-features\/proxy-support\.md/);
  assert.match(markdown, /Evidence: HTTP client files=main\.js; missing env=PROXY_AUTH, PROXY_DOMAIN/);
  assert.match(markdown, /Fix: Read PROXY_AUTH and PROXY_DOMAIN/);
  assert.match(markdown, /Commands: node \.\/bin\/coreclaw\.js validate/);
  assert.match(markdown, /coreclaw\.js verify/);
});

test('auditCommand applies reusable audit profile paths and gates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-profile-'));
  const profileDir = path.join(root, '.coreclaw', 'profiles');
  fs.mkdirSync(profileDir, { recursive: true });
  const profileFile = path.join(profileDir, 'strict-audit.json');
  makeNodeWorker(path.join(root, 'worker-warning'), { outputSchema: false });
  fs.writeFileSync(profileFile, `${JSON.stringify({
    fail_on_warn: true,
    ignore_issue_codes: ['missing_output_schema_legacy'],
    output: '../audit.json',
    markdown: '../audit.md',
  }, null, 2)}\n`);

  const report = await auditCommand(root, { auditProfile: profileFile });

  assert.equal(report.options.audit_profile_path, profileFile);
  assert.equal(report.options.fail_on_warn, true);
  assert.deepEqual(report.options.ignored_issue_codes, ['missing_output_schema_legacy']);
  assert.equal(report.totals.pass, 1);
  assert.equal(report.totals.warn, 0);
  assert.equal(report.totals.ignored_issue_count, 1);
  assert.equal(fs.existsSync(path.join(root, '.coreclaw', 'audit.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.coreclaw', 'audit.md')), true);
});

test('auditCommand merges profile and command-line ignored issue codes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-audit-profile-merge-'));
  const profileFile = path.join(root, 'audit-profile.json');
  makeNodeWorker(path.join(root, 'worker-missing-output'), { outputSchema: false });
  makeNodeWorker(path.join(root, 'worker-legacy-output'), { outputType: 'number' });
  fs.writeFileSync(profileFile, `${JSON.stringify({
    fail_on_warn: true,
    ignore_issue_codes: ['missing_output_schema_legacy'],
  }, null, 2)}\n`);

  const report = await auditCommand(root, {
    auditProfile: profileFile,
    ignoreIssueCodes: 'output_legacy_type_alias',
  });

  assert.equal(report.totals.pass, 2);
  assert.equal(report.totals.warn, 0);
  assert.deepEqual(
    report.options.ignored_issue_codes,
    ['missing_output_schema_legacy', 'output_legacy_type_alias'],
  );
  assert.equal(report.totals.ignored_issue_count, 2);
});

function makeNodeWorker(dir, options = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.js'), options.mainJs ?? '');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), JSON.stringify({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList', default: [] },
    ],
  }));
  if (options.outputSchema !== false) {
    fs.writeFileSync(path.join(dir, 'output_schema.json'), JSON.stringify([
      { name: 'value', type: options.outputType ?? 'string' },
    ]));
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    dependencies: {
      '@grpc/grpc-js': '^1.14.3',
      'google-protobuf': '^4.0.2',
    },
  }));
  for (const file of ['sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js']) {
    fs.writeFileSync(path.join(dir, file), '');
  }
}
