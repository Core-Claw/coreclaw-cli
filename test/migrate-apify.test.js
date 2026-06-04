import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('apify migration audit reports CoreClaw adaptation work for Crawlee actors', async () => {
  const { inspectApifyMigration } = await import('../src/commands/migrate.js');
  const projectDir = makeApifyActorProject();

  const report = inspectApifyMigration(projectDir);
  const codes = report.findings.map((finding) => finding.code);

  assert.equal(report.detected.apify, true);
  assert.equal(report.detected.crawlee, true);
  assert.equal(report.detected.browser_crawler, true);
  assert.equal(report.detected.input_schema_path, path.join(projectDir, '.actor', 'input_schema.json'));
  assert.deepEqual(report.coreclaw_input_schema, {
    description: 'Legacy Apify Actor input',
    b: 'startUrls',
    properties: [
      {
        name: 'startUrls',
        title: 'Start URLs',
        type: 'array',
        editor: 'requestList',
        default: [{ url: 'https://example.com' }],
        required: true,
        description: 'URLs to crawl',
      },
      {
        name: 'maxItems',
        title: 'Max items',
        type: 'integer',
        editor: 'number',
        default: 10,
        required: false,
        minimum: 1,
        maximum: 100,
      },
      {
        name: 'proxyCountryCode',
        title: 'Proxy country',
        type: 'string',
        editor: 'select',
        default: 'US',
        required: false,
        options: [
          { label: 'United States', value: 'US' },
          { label: 'Japan', value: 'JP' },
        ],
      },
      {
        name: 'debug',
        title: 'Debug',
        type: 'boolean',
        editor: 'switch',
        default: false,
        required: false,
      },
    ],
  });
  assert.equal(report.totals.blockers, 4);
  assert.equal(report.totals.warnings, 3);
  assert.equal(codes.includes('apify_input_schema_convert'), true);
  assert.equal(codes.includes('apify_dataset_pushdata'), true);
  assert.equal(codes.includes('apify_kv_store_manual_migration'), true);
  assert.equal(codes.includes('apify_request_queue_manual_migration'), true);
  assert.equal(codes.includes('apify_proxy_configuration'), true);
  assert.equal(codes.includes('apify_browser_crawler'), true);
  assert.equal(codes.includes('coreclaw_sdk_adaptation'), true);
  assert.deepEqual(report.next_commands, [
    `node ./bin/coreclaw.js init "${projectDir}-coreclaw" --language node --name ${path.basename(projectDir)}-coreclaw`,
    `node ./bin/coreclaw.js validate "${projectDir}-coreclaw" --strict`,
    `node ./bin/coreclaw.js verify "${projectDir}-coreclaw" --strict --min-results 1`,
  ]);
});

test('apify migration command writes JSON and Markdown reports', async () => {
  const { migrateCommand } = await import('../src/commands/migrate.js');
  const projectDir = makeApifyActorProject();
  const output = path.join(projectDir, 'migration-report.json');
  const markdown = path.join(projectDir, 'migration-report.md');

  const report = await migrateCommand(['apify', projectDir], { output, markdown });

  assert.equal(report.detected.apify, true);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).detected.crawlee, true);
  const markdownText = fs.readFileSync(markdown, 'utf8');
  assert.match(markdownText, /^# Apify 到 CoreClaw 迁移审计/m);
  assert.match(markdownText, /apify_input_schema_convert/);
  assert.match(markdownText, /CoreClaw `input_schema\.json`/);
});

test('apify migration command can write a CoreClaw input schema draft', async () => {
  const { migrateCommand } = await import('../src/commands/migrate.js');
  const projectDir = makeApifyActorProject();
  const schemaOutput = path.join(projectDir, 'coreclaw-input-schema.json');

  const report = await migrateCommand(['apify', projectDir], { schemaOutput });

  const schema = JSON.parse(fs.readFileSync(schemaOutput, 'utf8'));
  assert.deepEqual(schema, report.coreclaw_input_schema);
  assert.equal(schema.b, 'startUrls');
  assert.equal(schema.properties[0].editor, 'requestList');
  assert.equal(schema.properties[1].type, 'integer');
});

function makeApifyActorProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-apify-actor-'));
  fs.mkdirSync(path.join(dir, '.actor'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    type: 'module',
    dependencies: {
      apify: '^3.2.0',
      crawlee: '^3.13.0',
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.actor', 'actor.json'), JSON.stringify({
    actorSpecification: 1,
    name: 'legacy-apify-actor',
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.actor', 'input_schema.json'), JSON.stringify({
    title: 'Legacy Apify Actor input',
    type: 'object',
    required: ['startUrls'],
    properties: {
      startUrls: {
        title: 'Start URLs',
        type: 'array',
        editor: 'requestListSources',
        description: 'URLs to crawl',
        prefill: [{ url: 'https://example.com' }],
      },
      maxItems: {
        title: 'Max items',
        type: 'number',
        editor: 'number',
        default: 10,
        minimum: 1,
        maximum: 100,
      },
      proxyCountryCode: {
        title: 'Proxy country',
        type: 'string',
        editor: 'select',
        default: 'US',
        enum: ['US', 'JP'],
        enumTitles: ['United States', 'Japan'],
      },
      debug: {
        title: 'Debug',
        type: 'boolean',
        default: false,
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'main.js'), [
    "import { Actor } from 'apify';",
    "import { Dataset, KeyValueStore, PlaywrightCrawler, RequestQueue } from 'crawlee';",
    'await Actor.init();',
    'const input = await Actor.getInput();',
    'const requestQueue = await RequestQueue.open();',
    'const proxyConfiguration = await Actor.createProxyConfiguration();',
    "await KeyValueStore.setValue('state', input);",
    'const crawler = new PlaywrightCrawler({ requestQueue, proxyConfiguration, requestHandler: async ({ request }) => {',
    "  await Dataset.pushData({ url: request.url, status: 'ok' });",
    '} });',
    'await crawler.run(input.startUrls);',
    'await Actor.exit();',
    '',
  ].join('\n'));
  return dir;
}
