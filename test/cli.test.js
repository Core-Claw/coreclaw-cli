import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, runCli } from '../src/cli.js';
import { CliError } from '../src/utils/errors.js';

test('runCli rejects missing option values before consuming the next flag', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'run', '.', '--proxy-auth', '--timeout-ms', '10s']),
    (error) => error instanceof CliError && error.message === 'Option "--proxy-auth" requires a value.',
  );
});

test('runCli prints grouped top-level help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', '--help']));

  assert.match(output, /Worker 开发:/);
  assert.match(output, /CoreClaw 云端:/);
  assert.match(output, /上传预检:/);
  assert.match(output, /coreclaw help <command>/);
});

test('runCli prints command-specific help from help command', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'help', 'verify']));

  assert.match(output, /^coreclaw verify/m);
  assert.match(output, /在干净的类上传 staging 目录中执行上传预检/);
  assert.match(output, /coreclaw verify \.\/worker --strict --input input\.json --min-results 1/);
});

test('runCli prints command-specific help from command help flag', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'run', '--help']));

  assert.match(output, /^coreclaw run/m);
  assert.match(output, /使用 CoreClaw SDK runtime 模拟器在本地运行 Worker/);
});

test('runCli prints env command help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'env', '--help']));

  assert.match(output, /^coreclaw env/m);
  assert.match(output, /不运行 Worker，直接打印 CoreClaw runtime 环境变量/);
});

test('runCli prints runs command help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'runs', '--help']));

  assert.match(output, /^coreclaw runs/m);
  assert.match(output, /查看 CoreClaw 云端 run、日志、结果、导出和控制操作/);
  assert.match(output, /coreclaw runs results <run_slug> --output cloud-results\.json/);
  assert.match(output, /coreclaw runs diagnose <run_slug>/);
  assert.match(output, /coreclaw runs cost <run_slug>/);
  assert.match(output, /coreclaw runs collect <run_slug>/);
});

test('runCli prints prove command help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'prove', '--help']));

  assert.match(output, /^coreclaw prove/m);
  assert.match(output, /执行本地预检、启动云端 run、保存结果并对比一致性/);
  assert.match(output, /--scraper-slug <scraper_slug> --cloud-input request\.json/);
});

test('runCli prints migrate command help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'migrate', '--help']));

  assert.match(output, /^coreclaw migrate/m);
  assert.match(output, /Apify/);
  assert.match(output, /coreclaw migrate apify/);
});

test('runCli prints release command help', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'release', '--help']));

  assert.match(output, /^coreclaw release/m);
  assert.match(output, /发布/);
  assert.match(output, /coreclaw release dossier/);
});

test('runCli prints built-in example workers', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'examples']));

  assert.match(output, /CoreClaw example Workers/);
  assert.match(output, /node-http-proxy/);
  assert.match(output, /node-lightpanda-cdp/);
  assert.match(output, /coreclaw verify \.\/examples\/node-lightpanda-cdp --lightpanda-shim/);
});

test('runCli prints example workers as JSON', async () => {
  const output = await captureStdout(() => runCli(['node', 'coreclaw', 'examples', '--json-output']));
  const report = JSON.parse(output);

  assert.equal(report.count, 6);
  assert.equal(report.examples.some((example) => example.name === 'node-http-proxy'), true);
  assert.equal(report.examples.some((example) => example.verify.includes('--require-lightpanda-shim')), true);
});

test('runCli rejects unsupported options for examples command', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'examples', '--strict']),
    (error) => error instanceof CliError
      && /Option "--strict" is not supported by "coreclaw examples"/.test(error.message),
  );
});

test('runCli suggests close command names', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'verfy']),
    (error) => error instanceof CliError
      && /Unknown command "verfy"\. Did you mean "coreclaw verify"\? Run coreclaw --help\./.test(error.message),
  );
});

test('parseArgs preserves explicit boolean false for long options with equals', () => {
  assert.deepEqual(
    parseArgs(['verify', '.', '--strict=false', '--install=false', '--no-pack', '--timeout-ms=30s']),
    {
      positionals: ['verify', '.'],
      options: {
        strict: false,
        install: false,
        pack: false,
        timeoutMs: '30s',
      },
    },
  );
});

test('parseArgs treats input-json as an alias for inline json', () => {
  assert.deepEqual(
    parseArgs(['verify', '.', '--input-json={"url":"https://example.com"}']),
    {
      positionals: ['verify', '.'],
      options: {
        json: '{"url":"https://example.com"}',
      },
    },
  );
});

test('parseArgs keeps input json separate from json-output mode', () => {
  assert.deepEqual(
    parseArgs(['run', '.', '--json', '{"url":"https://example.com"}', '--json-output']),
    {
      positionals: ['run', '.'],
      options: {
        json: '{"url":"https://example.com"}',
        jsonOutput: true,
      },
    },
  );
});

test('parseArgs accepts no-input-example for init', () => {
  assert.deepEqual(
    parseArgs(['init', './worker', '--language', 'node', '--no-input-example']),
    {
      positionals: ['init', './worker'],
      options: {
        language: 'node',
        inputExample: false,
      },
    },
  );
});

test('parseArgs accepts package size thresholds for upload package commands', () => {
  assert.deepEqual(
    parseArgs(['inspect-package', './worker.zip', '--language', 'node', '--project', './worker', '--max-package-size', '25MB']),
    {
      positionals: ['inspect-package', './worker.zip'],
      options: {
        language: 'node',
        project: './worker',
        maxPackageSize: '25MB',
      },
    },
  );
});

test('parseArgs accepts cloud API options', () => {
  assert.deepEqual(
    parseArgs(['workers', 'run', 'WORKER', '--input', 'request.json', '--version', 'auto', '--sync', '--api-key', 'test-key']),
    {
      positionals: ['workers', 'run', 'WORKER'],
      options: {
        input: 'request.json',
        version: 'auto',
        sync: true,
        apiKey: 'test-key',
      },
    },
  );
});

test('parseArgs accepts tasks run wait and evidence options', () => {
  assert.deepEqual(
    parseArgs(['tasks', 'run', 'TASK', '--callback-url', 'https://example.com/webhook', '--wait', '--results-output', 'task-results.json', '--run-evidence-output', 'task-evidence.json']),
    {
      positionals: ['tasks', 'run', 'TASK'],
      options: {
        callbackUrl: 'https://example.com/webhook',
        wait: true,
        resultsOutput: 'task-results.json',
        runEvidenceOutput: 'task-evidence.json',
      },
    },
  );
});

test('parseArgs accepts workers run wait and result output options', () => {
  assert.deepEqual(
    parseArgs(['workers', 'run', 'WORKER', '--input', 'request.json', '--wait', '--wait-timeout', '10m', '--poll-interval', '1s', '--results-output', 'cloud-results.json']),
    {
      positionals: ['workers', 'run', 'WORKER'],
      options: {
        input: 'request.json',
        wait: true,
        waitTimeout: '10m',
        pollInterval: '1s',
        resultsOutput: 'cloud-results.json',
      },
    },
  );
});

test('parseArgs accepts workers run evidence output option', () => {
  assert.deepEqual(
    parseArgs(['workers', 'run', 'WORKER', '--input', 'request.json', '--wait', '--run-evidence-output', 'run-evidence.json']),
    {
      positionals: ['workers', 'run', 'WORKER'],
      options: {
        input: 'request.json',
        wait: true,
        runEvidenceOutput: 'run-evidence.json',
      },
    },
  );
});

test('parseArgs accepts runs export download output option', () => {
  assert.deepEqual(
    parseArgs(['runs', 'export', 'RUN', '--format', 'csv', '--download-output', 'export.csv']),
    {
      positionals: ['runs', 'export', 'RUN'],
      options: {
        format: 'csv',
        downloadOutput: 'export.csv',
      },
    },
  );
});

test('parseArgs accepts runs diagnose output and page size options', () => {
  assert.deepEqual(
    parseArgs(['runs', 'diagnose', 'RUN', '--output', 'diagnosis.json', '--page-size', '5']),
    {
      positionals: ['runs', 'diagnose', 'RUN'],
      options: {
        output: 'diagnosis.json',
        pageSize: '5',
      },
    },
  );
});

test('parseArgs accepts runs cost output option', () => {
  assert.deepEqual(
    parseArgs(['runs', 'cost', 'RUN', '--output', 'cost.json']),
    {
      positionals: ['runs', 'cost', 'RUN'],
      options: {
        output: 'cost.json',
      },
    },
  );
});

test('parseArgs accepts runs collect bundle options', () => {
  assert.deepEqual(
    parseArgs(['runs', 'collect', 'RUN', '--output', 'evidence.json', '--markdown', 'evidence.md', '--format', 'csv', '--download-output', 'export.csv']),
    {
      positionals: ['runs', 'collect', 'RUN'],
      options: {
        output: 'evidence.json',
        markdown: 'evidence.md',
        format: 'csv',
        downloadOutput: 'export.csv',
      },
    },
  );
});

test('parseArgs accepts compare json summary option', () => {
  assert.deepEqual(
    parseArgs(['compare', 'cloud.json', '.coreclaw/runs/run-id', '--json-summary']),
    {
      positionals: ['compare', 'cloud.json', '.coreclaw/runs/run-id'],
      options: {
        jsonSummary: true,
      },
    },
  );
});

test('parseArgs accepts migrate apify report output options', () => {
  assert.deepEqual(
    parseArgs(['migrate', 'apify', './actor', '--output', 'migration.json', '--markdown', 'migration.md', '--schema-output', 'input_schema.json', '--json-output']),
    {
      positionals: ['migrate', 'apify', './actor'],
      options: {
        output: 'migration.json',
        markdown: 'migration.md',
        schemaOutput: 'input_schema.json',
        jsonOutput: true,
      },
    },
  );
});

test('parseArgs accepts release dossier evidence options', () => {
  assert.deepEqual(
    parseArgs([
      'release',
      'dossier',
      './worker',
      '--package',
      'worker.zip',
      '--cloud-run',
      'RUN',
      '--compare-report',
      'cloud-comparison.json',
      '--diagnosis',
      'diagnosis.json',
      '--cost-report',
      'cost.json',
      '--run-evidence',
      'run-evidence.json',
      '--output',
      'release.json',
      '--markdown',
      'release.md',
    ]),
    {
      positionals: ['release', 'dossier', './worker'],
      options: {
        package: 'worker.zip',
        cloudRun: 'RUN',
        compareReport: 'cloud-comparison.json',
        diagnosis: 'diagnosis.json',
        costReport: 'cost.json',
        runEvidence: 'run-evidence.json',
        output: 'release.json',
        markdown: 'release.md',
      },
    },
  );
});

test('parseArgs accepts prove workflow options', () => {
  assert.deepEqual(
    parseArgs(['prove', './worker', '--scraper-slug', 'WORKER', '--cloud-input', 'request.json', '--wait-timeout', '10m', '--poll-interval', '1s', '--cloud-results-output', 'cloud.json', '--run-evidence-output', 'run-evidence.json', '--release-output', 'release.json']),
    {
      positionals: ['prove', './worker'],
      options: {
        scraperSlug: 'WORKER',
        cloudInput: 'request.json',
        waitTimeout: '10m',
        pollInterval: '1s',
        cloudResultsOutput: 'cloud.json',
        runEvidenceOutput: 'run-evidence.json',
        releaseOutput: 'release.json',
      },
    },
  );
});

test('parseArgs accepts doctor cloud smoke options', () => {
  assert.deepEqual(
    parseArgs(['doctor', '--cloud', '--scraper-slug', 'WORKER', '--cloud-input', 'request.json', '--wait', '--results-output', 'cloud-results.json', '--run-evidence-output', 'run-evidence.json']),
    {
      positionals: ['doctor'],
      options: {
        cloud: true,
        scraperSlug: 'WORKER',
        cloudInput: 'request.json',
        wait: true,
        resultsOutput: 'cloud-results.json',
        runEvidenceOutput: 'run-evidence.json',
      },
    },
  );
});

test('parseArgs rejects unknown long options before running with defaults', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--input-jsno', '{"url":"https://example.com"}']),
    (error) => error instanceof CliError
      && /Unknown option "--input-jsno"/.test(error.message),
  );
});

test('parseArgs rejects no-prefix on non-boolean options', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--no-output']),
    (error) => error instanceof CliError
      && /Option "--no-output" can only be used with boolean options/.test(error.message),
  );
});

test('runCli rejects options that are valid globally but not for the command', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'run', '.', '--cloud-output', 'cloud.json']),
    (error) => error instanceof CliError
      && /Option "--cloud-output" is not supported by "coreclaw run"/.test(error.message),
  );
});

test('runCli accepts verify-only no-compare option', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'verify', '.', '--no-compare', '--definitely-unknown']),
    (error) => error instanceof CliError
      && /Unknown option "--definitely-unknown"/.test(error.message),
  );
});

test('runCli accepts env runtime endpoint options', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'env', '.', '--cloud-proxy', '--lightpanda-domain', 'lightpanda-inner.coreclaw.com', '--definitely-unknown']),
    (error) => error instanceof CliError
      && /Unknown option "--definitely-unknown"/.test(error.message),
  );
});

test('runCli rejects cloud options that are valid globally but not for the command', async () => {
  await assert.rejects(
    () => runCli(['node', 'coreclaw', 'account', 'info', '--page-size', '10']),
    (error) => error instanceof CliError
      && /Option "--page-size" is not supported by "coreclaw account"/.test(error.message),
  );
});

test('parseArgs rejects invalid explicit boolean values', () => {
  assert.throws(
    () => parseArgs(['verify', '.', '--strict=0']),
    (error) => error instanceof CliError
      && /Boolean option "--strict=0" only accepts "true" or "false"/.test(error.message),
  );
});

async function captureStdout(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}
