import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceCaptchaSolverGate, enforceMinimumResults, enforceOutputSchemaMatch, enforcePostRunGates, enforceRequiredBrowser, runCommand } from '../src/commands/run.js';
import { CliError } from '../src/utils/errors.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('enforceMinimumResults rejects zero-output successful runs when requested', () => {
  const store = makeStore(0);

  assert.throws(
    () => enforceMinimumResults(store, { minResults: '1' }),
    (error) => error instanceof CliError && /expected at least 1/.test(error.message),
  );
});

test('enforceMinimumResults allows runs that meet the requested result count', () => {
  const store = makeStore(2);

  assert.doesNotThrow(() => enforceMinimumResults(store, { minResults: '2' }));
});

test('enforcePostRunGates marks the run failed when proxy usage is required but absent', () => {
  const store = makeStore(1);

  assert.throws(
    () => enforcePostRunGates(store, { stats: { connectRequests: 0 } }, { requireProxyUsage: true }),
    (error) => error instanceof CliError && /did not use the local CoreClaw SOCKS5 proxy/.test(error.message),
  );
  assert.equal(store.finished.exitCode, 1);
});

test('enforceOutputSchemaMatch rejects schema drift when requested', () => {
  const store = makeStore(1, {
    outputSchema: [{ name: 'ok', type: 'boolean' }],
    outputSchemaIssueCount: 1,
  });

  assert.throws(
    () => enforceOutputSchemaMatch(store, { requireOutputSchemaMatch: true }),
    (error) => error instanceof CliError && /output_schema mismatch/.test(error.message),
  );
});

test('enforceOutputSchemaMatch requires a declared output schema', () => {
  const store = makeStore(1, {
    outputSchema: [],
    outputSchemaIssueCount: 0,
  });

  assert.throws(
    () => enforceOutputSchemaMatch(store, { requireOutputSchemaMatch: true }),
    (error) => error instanceof CliError && /requires output_schema\.json/.test(error.message),
  );
});

test('enforceCaptchaSolverGate marks the run failed when required but unused', () => {
  const store = makeStore(1);
  const captchaShim = {
    stats: {
      automaticSolverCalls: 0,
    },
  };

  assert.throws(
    () => enforceCaptchaSolverGate(store, captchaShim, { requireCaptchaSolver: true }),
    (error) => error instanceof CliError && /did not call Captchas\.automaticSolver/.test(error.message),
  );
  assert.equal(store.finished.exitCode, 1);
});

test('enforceCaptchaSolverGate allows runs that called the local CAPTCHA solver', () => {
  const store = makeStore(1);
  const captchaShim = {
    stats: {
      automaticSolverCalls: 1,
    },
  };

  assert.doesNotThrow(() => enforceCaptchaSolverGate(store, captchaShim, { requireCaptchaSolver: true }));
});

test('enforceRequiredBrowser rejects fallback browser endpoints when requested', async () => {
  await assert.rejects(
    () => enforceRequiredBrowser(
      {
        chromeWs: '127.0.0.1:9222',
        chromeHttp: '127.0.0.1:9222',
        discoveredLocalChrome: false,
      },
      {
        requireBrowser: true,
        browserFetchImpl: async () => ({
          ok: false,
          status: 404,
          async json() {
            return {};
          },
        }),
      },
    ),
    (error) => error instanceof CliError && /no reachable local browser endpoint/.test(error.message),
  );
});

test('runCommand fails before creating run artifacts when browser is required but unavailable', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')
async function main() {
  await coresdk.result.pushData({ ok: true })
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
`);

  await assert.rejects(
    () => runCommand(dir, {
      node: process.execPath,
      requireBrowser: true,
      browserFetchImpl: async () => ({
        ok: false,
        status: 404,
        async json() {
          return {};
        },
      }),
      tmpHook: false,
    }),
    (error) => error instanceof CliError && /no reachable local browser endpoint/.test(error.message),
  );

  assert.equal(fs.existsSync(path.join(dir, '.coreclaw')), false);
});

test('runCommand fails upload parity when proxy usage is required but worker does not use it', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')

async function main() {
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
`);

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    await assert.rejects(
      () => runCommand(dir, {
        node: process.execPath,
        requireProxyUsage: true,
        minResults: '1',
        tmpHook: false,
      }),
      (error) => error instanceof CliError && /did not use the local CoreClaw SOCKS5 proxy/.test(error.message),
    );
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }

  const runs = fs.readdirSync(path.join(dir, '.coreclaw', 'runs'));
  const summary = JSON.parse(fs.readFileSync(path.join(dir, '.coreclaw', 'runs', runs[0], 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'FAILED');
});

test('runCommand can fail on output_schema drift when requested', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')

async function main() {
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: true, extra: 'not exported by CoreClaw' })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
`);

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    await assert.rejects(
      () => runCommand(dir, {
        node: process.execPath,
        requireOutputSchemaMatch: true,
        minResults: '1',
        tmpHook: false,
      }),
      (error) => error instanceof CliError && /output_schema mismatch/.test(error.message),
    );
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }

  const runs = fs.readdirSync(path.join(dir, '.coreclaw', 'runs'));
  const runDir = path.join(dir, '.coreclaw', 'runs', runs[0]);
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  const issues = JSON.parse(fs.readFileSync(path.join(runDir, 'output_schema_issues.json'), 'utf8'));
  assert.equal(summary.status, 'FAILED');
  assert.equal(summary.output_schema_issue_count, 1);
  assert.equal(issues[0].code, 'result_field_not_in_output_schema');
});

test('runCommand can require Captchas.automaticSolver through the local CDP shim', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')
const { WebSocket } = require('ws')

function sendCaptchaCommand(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Captchas.automaticSolver',
        params: { timeout: 30, solverType: 'cloudflare' },
      }))
    })
    socket.addEventListener('message', (event) => {
      resolve(JSON.parse(event.data))
      socket.close()
    })
    socket.addEventListener('error', reject)
  })
}

async function main() {
  const result = await sendCaptchaCommand(process.env.CDP_ENDPOINT)
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: Boolean(result.result.status) })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
`);

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    const summary = await runCommand(dir, {
      node: process.execPath,
      captchaSolver: true,
      requireCaptchaSolver: true,
      minResults: '1',
      tmpHook: false,
    });

    assert.equal(summary.status, 'SUCCEEDED');
    assert.equal(summary.result_count, 1);
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }
});

function makeStore(resultCount, options = {}) {
  return {
    runDir: 'E:\\worker\\fixture\\.coreclaw\\runs\\run-id',
    outputSchema: options.outputSchema ?? [],
    finished: null,
    finish(result) {
      this.finished = result;
    },
    summary() {
      return {
        result_count: resultCount,
        output_schema_issue_count: options.outputSchemaIssueCount ?? 0,
        output_schema_issues_path: 'E:\\worker\\fixture\\.coreclaw\\runs\\run-id\\output_schema_issues.json',
      };
    },
  };
}

function createNodeFixture(mainJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-run-fixture-'));
  fs.writeFileSync(path.join(dir, 'main.js'), mainJs);
  fs.writeFileSync(path.join(dir, 'input_schema.json'), JSON.stringify({
    b: 'items',
    properties: [
      {
        name: 'items',
        type: 'array',
        editor: 'stringList',
        default: [{ string: 'x' }],
      },
    ],
  }));
  fs.writeFileSync(path.join(dir, 'output_schema.json'), JSON.stringify([
    { name: 'ok', type: 'boolean', description: 'OK' },
  ]));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    type: 'commonjs',
    dependencies: {
      '@grpc/grpc-js': '^1.14.3',
      'google-protobuf': '^4.0.2',
    },
  }));
  for (const file of ['sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js']) {
    fs.copyFileSync(path.join(repoRoot, 'templates', 'node', file), path.join(dir, file));
  }
  return dir;
}
