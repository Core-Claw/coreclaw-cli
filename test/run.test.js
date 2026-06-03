import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCommand } from '../src/commands/init.js';
import { verifyCommand } from '../src/commands/verify.js';
import { enforceBrowserCdpShimGate, enforceCaptchaSolverGate, enforceLightpandaGate, enforceMinimumResults, enforceOutputSchemaMatch, enforcePostRunGates, enforceRequiredBrowser, enforceTableHeaderGate, resolveRunOptions, runCommand, shouldUseBrowserCdpShim } from '../src/commands/run.js';
import { inspectPackage, validatePackageReport } from '../src/commands/inspect-package.js';
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

test('enforceTableHeaderGate rejects runs that never set runtime table headers when requested', () => {
  const store = makeStore(1, { tableHeaderCount: 0 });

  assert.throws(
    () => enforceTableHeaderGate(store, { requireTableHeader: true }),
    (error) => error instanceof CliError && /did not call set_table_header/.test(error.message),
  );
});

test('enforceTableHeaderGate allows runs with runtime table headers', () => {
  const store = makeStore(1, { tableHeaderCount: 1 });

  assert.doesNotThrow(() => enforceTableHeaderGate(store, { requireTableHeader: true }));
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
      calls: [{ params: { timeout: 30, solverType: 'cloudflare' }, issues: [] }],
      invalidCalls: [],
    },
  };

  assert.doesNotThrow(() => enforceCaptchaSolverGate(store, captchaShim, { requireCaptchaSolver: true }));
  assert.equal(store.files['captcha_solver_calls.json'].length, 1);
});

test('enforceCaptchaSolverGate records observed solver calls in compatibility mode', () => {
  const store = makeStore(1);
  const captchaShim = {
    stats: {
      automaticSolverCalls: 1,
      calls: [{ params: { timeout: '30', solverType: 'unknown_solver' }, issues: ['timeout must be a positive number'] }],
      invalidCalls: [{ params: { timeout: '30', solverType: 'unknown_solver' }, issues: ['timeout must be a positive number'] }],
    },
  };

  assert.doesNotThrow(() => enforceCaptchaSolverGate(store, captchaShim, { captchaSolver: true }));
  assert.equal(store.files['captcha_solver_calls.json'].length, 1);
  assert.equal(store.finished, null);
});

test('enforceCaptchaSolverGate rejects invalid solver params when required', () => {
  const store = makeStore(1);
  const captchaShim = {
    stats: {
      automaticSolverCalls: 1,
      calls: [
        {
          params: { timeout: '30', solverType: 'unknown_solver' },
          issues: ['timeout must be a positive number', 'solverType "unknown_solver" is not documented by CoreClaw'],
        },
      ],
      invalidCalls: [
        {
          params: { timeout: '30', solverType: 'unknown_solver' },
          issues: ['timeout must be a positive number', 'solverType "unknown_solver" is not documented by CoreClaw'],
        },
      ],
    },
  };

  assert.throws(
    () => enforceCaptchaSolverGate(store, captchaShim, { requireCaptchaSolver: true }),
    (error) => error instanceof CliError && /invalid parameter issue/.test(error.message),
  );
  assert.equal(store.finished.exitCode, 1);
  assert.equal(store.files['captcha_solver_calls.json'].length, 1);
});

test('enforceBrowserCdpShimGate marks the run failed when required but unused', () => {
  const store = makeStore(1);
  const browserShim = {
    stats: {
      connections: 0,
    },
  };

  assert.throws(
    () => enforceBrowserCdpShimGate(store, browserShim, null, { requireBrowserCdpShim: true }),
    (error) => error instanceof CliError && /did not connect to the local CoreClaw browser CDP shim/.test(error.message),
  );
  assert.equal(store.finished.exitCode, 1);
});

test('shouldUseBrowserCdpShim includes browser and CAPTCHA shim modes', () => {
  assert.equal(shouldUseBrowserCdpShim({}), false);
  assert.equal(shouldUseBrowserCdpShim({ browserCdpShim: true }), true);
  assert.equal(shouldUseBrowserCdpShim({ requireBrowserCdpShim: true }), true);
  assert.equal(shouldUseBrowserCdpShim({ lightpandaShim: true }), true);
  assert.equal(shouldUseBrowserCdpShim({ requireLightpandaShim: true }), true);
  assert.equal(shouldUseBrowserCdpShim({ captchaSolver: true }), true);
  assert.equal(shouldUseBrowserCdpShim({ requireCaptchaSolver: true }), true);
});

test('resolveRunOptions enables upload preflight runtime gates in strict mode', () => {
  assert.deepEqual(
    resolveRunOptions({
      strict: true,
      requireTableHeader: false,
      minResults: '1',
    }),
    {
      strict: true,
      requireTableHeader: false,
      requireOutputSchemaMatch: true,
      requireStatusOk: true,
      minResults: '1',
    },
  );
});

test('enforceLightpandaGate requires a Lightpanda connection with Basic auth', () => {
  assert.throws(
    () => enforceLightpandaGate(makeStore(1), null, null, { requireLightpandaShim: true }),
    (error) => error instanceof CliError && /requires the local Lightpanda CDP shim/.test(error.message),
  );

  assert.throws(
    () => enforceLightpandaGate(
      makeStore(1),
      { stats: { paths: ['/devtools/browser/new'], authorizationHeaders: [null] } },
      null,
      { requireLightpandaShim: true },
    ),
    (error) => error instanceof CliError && /without a Basic Authorization header/.test(error.message),
  );

  assert.doesNotThrow(() => enforceLightpandaGate(
    makeStore(1),
    { stats: { paths: ['/devtools/browser/new'], authorizationHeaders: ['Basic token'] } },
    null,
    { requireLightpandaShim: true },
  ));
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

test('runCommand fails before creating run artifacts when required input is missing', async () => {
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
      json: '{}',
      tmpHook: false,
    }),
    (error) => error instanceof CliError && /Input does not satisfy input_schema\.json/.test(error.message),
  );

  assert.equal(fs.existsSync(path.join(dir, '.coreclaw')), false);
});

test('runCommand fails before creating run artifacts when input type is invalid', async () => {
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
      json: '{"items":"not a list"}',
      tmpHook: false,
    }),
    (error) => error instanceof CliError && /field "items" must be an array/.test(error.message),
  );

  assert.equal(fs.existsSync(path.join(dir, '.coreclaw')), false);
});

test('runCommand strict mode fails static warnings before creating run artifacts', async () => {
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

  await assert.rejects(
    () => runCommand(dir, {
      node: process.execPath,
      strict: true,
      tmpHook: false,
    }),
    (error) => error instanceof CliError
      && /Run validation found 1 warning/.test(error.message)
      && /missing_readme/.test(error.message),
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
  fs.writeFileSync(path.join(dir, 'output_schema.json'), JSON.stringify([
    { name: 'status', type: 'string', description: 'Status' },
  ]));

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

test('runCommand can require set_table_header before upload', async () => {
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

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    await assert.rejects(
      () => runCommand(dir, {
        node: process.execPath,
        requireTableHeader: true,
        minResults: '1',
        tmpHook: false,
      }),
      (error) => error instanceof CliError && /did not call set_table_header/.test(error.message),
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
  assert.equal(summary.table_header_count, 0);
});

test('runCommand strict mode applies runtime upload gates', async () => {
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
  fs.writeFileSync(path.join(dir, 'README.md'), '# Strict run fixture\n');

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    await assert.rejects(
      () => runCommand(dir, {
        node: process.execPath,
        strict: true,
        minResults: '1',
        tmpHook: false,
      }),
      (error) => error instanceof CliError && /did not call set_table_header/.test(error.message),
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
  assert.equal(summary.table_header_count, 0);
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

test('runCommand can fail on output_schema type drift when requested', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')

async function main() {
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: 'true' })
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
  assert.equal(issues[0].code, 'result_field_type_mismatch');
});

test('runCommand can fail when result status rows indicate errors', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')

async function main() {
  await coresdk.result.setTableHeader([{ label: 'status', key: 'status', format: 'text' }])
  await coresdk.result.pushData({ status: 'error' })
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
        requireStatusOk: true,
        minResults: '1',
        tmpHook: false,
      }),
      (error) => error instanceof CliError && /failing status values/.test(error.message),
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

test('runCommand can execute a staged runtime directory while validating against the source project', async () => {
  const source = createNodeFixture(`
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
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-node-runtime-stage-'));
  for (const file of ['main.js', 'sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js']) {
    fs.copyFileSync(path.join(source, file), path.join(runtime, file));
  }

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    const summary = await runCommand(runtime, {
      node: process.execPath,
      runtimeLanguage: 'node',
      validationProjectDir: source,
      artifactProjectDir: source,
      requireTableHeader: true,
      requireOutputSchemaMatch: true,
      minResults: '1',
      install: false,
      tmpHook: false,
    });

    assert.equal(summary.status, 'SUCCEEDED');
    assert.equal(summary.project_dir, source);
    assert.equal(summary.worker_dir, runtime);
    assert.equal(summary.result_count, 1);
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }
});

test('generated Node worker passes upload preflight and package inspection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-generated-worker-'));
  const projectDir = path.join(root, 'generated-node-worker');

  await initCommand(projectDir, {
    language: 'node',
    name: 'Generated Node Worker',
  });

  const previousNodePath = process.env.NODE_PATH;
  process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
  try {
    const result = await verifyCommand(projectDir, {
      node: process.execPath,
      install: false,
      minResults: '1',
      requireTableHeader: true,
      requireOutputSchemaMatch: true,
      requireStatusOk: true,
      output: path.join(root, 'generated-node-worker.zip'),
      timeoutMs: '30s',
      idleTimeoutMs: '10s',
      tmpHook: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.language, 'node');
    assert.equal(result.result_count, 1);
    assert.equal(fs.existsSync(result.package_path), true);
    assert.equal(fs.existsSync(path.join(projectDir, 'node_modules')), false);

    const summary = JSON.parse(fs.readFileSync(path.join(result.run_dir, 'summary.json'), 'utf8'));
    const outputIssuesPath = path.join(result.run_dir, 'output_schema_issues.json');
    const uploadManifest = JSON.parse(fs.readFileSync(path.join(result.run_dir, 'upload_manifest.json'), 'utf8'));
    const exportedRows = readNdjson(path.join(result.run_dir, 'export.ndjson'));
    const packageReport = inspectPackage(result.package_path);
    const packageValidation = validatePackageReport(packageReport, { language: 'node' });

    assert.equal(summary.status, 'SUCCEEDED');
    assert.equal(summary.result_count, 1);
    assert.equal(summary.table_header_count, 3);
    assert.equal(summary.output_schema_issue_count, 0);
    assert.equal(fs.existsSync(outputIssuesPath), false);
    assert.deepEqual(exportedRows[0].value, {
      url: 'https://example.com',
      status: 'success',
      title: 'Example Domain',
    });
    assert.equal(uploadManifest.includes('main.js'), true);
    assert.equal(uploadManifest.includes('package.json'), true);
    assert.equal(uploadManifest.includes('sdk_grpc_pb.js'), true);
    assert.equal(packageValidation.ok, true);
    assert.equal(packageReport.root_entries.includes('main.js'), true);
    assert.equal(packageReport.root_entries.includes('package.json'), true);
    assert.equal(packageReport.root_entries.includes('output_schema.json'), true);
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }
});

test('generated Python worker passes upload preflight and package inspection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-generated-worker-'));
  const projectDir = path.join(root, 'generated-python-worker');

  await initCommand(projectDir, {
    language: 'python',
    name: 'Generated Python Worker',
  });

  const result = await verifyCommand(projectDir, {
    python: defaultPythonCommand(),
    minResults: '1',
    requireTableHeader: true,
    requireOutputSchemaMatch: true,
    requireStatusOk: true,
    output: path.join(root, 'generated-python-worker.zip'),
    timeoutMs: '30s',
    idleTimeoutMs: '10s',
  });

  assertGeneratedWorkerPreflight({
    result,
    language: 'python',
    requiredRootEntries: ['main.py', 'requirements.txt', 'sdk_pb2_grpc.py'],
  });
});

function defaultPythonCommand() {
  return process.platform === 'win32' ? 'py -3' : 'python3';
}

test('generated Go worker passes upload preflight and package inspection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-generated-worker-'));
  const projectDir = path.join(root, 'generated-go-worker');

  await initCommand(projectDir, {
    language: 'go',
    name: 'Generated Go Worker',
  });

  const result = await verifyCommand(projectDir, {
    go: 'go',
    install: false,
    minResults: '1',
    requireTableHeader: true,
    requireOutputSchemaMatch: true,
    requireStatusOk: true,
    output: path.join(root, 'generated-go-worker.zip'),
    timeoutMs: '30s',
    idleTimeoutMs: '10s',
  });

  assertGeneratedWorkerPreflight({
    result,
    language: 'go',
    requiredRootEntries: ['main', 'input_schema.json'],
  });

  const packageReport = inspectPackage(result.package_path);
  assert.equal(packageReport.entries.find((entry) => entry.name === 'main')?.mode_octal, '100755');
});

test('runCommand can require a browser CDP shim connection', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')
const { WebSocket } = require('ws')

function sendBrowserCommand(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }))
    })
    socket.addEventListener('message', (event) => {
      resolve(JSON.parse(event.data))
      socket.close()
    })
    socket.addEventListener('error', reject)
  })
}

async function main() {
  const auth = process.env.PROXY_AUTH
  const chromeWs = process.env.ChromeWs
  const result = await sendBrowserCommand('ws://' + chromeWs + '/ws?apiKey=' + auth)
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: Boolean(result.id) })
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
      requireBrowserCdpShim: true,
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

test('runCommand can require Lightpanda CDP shim connection with Basic auth', async () => {
  const dir = createNodeFixture(`
const coresdk = require('./sdk')
const { WebSocket } = require('ws')

function basicAuthHeader(auth) {
  return 'Basic ' + Buffer.from(auth, 'utf8').toString('base64')
}

function lightpandaEndpoint(value) {
  const endpoint = value.replace(/\\/+$/, '')
  if (/^(ws|wss|http|https):\\/\\//i.test(endpoint)) {
    return endpoint
  }
  return 'ws://' + endpoint + '/devtools/browser/new'
}

function sendLightpandaCommand(url, auth) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { Authorization: basicAuthHeader(auth) },
    })
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }))
    })
    socket.addEventListener('message', (event) => {
      resolve(JSON.parse(event.data))
      socket.close()
    })
    socket.addEventListener('error', reject)
  })
}

async function main() {
  const result = await sendLightpandaCommand(
    lightpandaEndpoint(process.env.LightpandaDomain),
    process.env.PROXY_AUTH,
  )
  await coresdk.result.setTableHeader([{ label: 'ok', key: 'ok', format: 'boolean' }])
  await coresdk.result.pushData({ ok: result.result.product === 'CoreClaw local Lightpanda CDP shim' })
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
      requireLightpandaShim: true,
      minResults: '1',
      tmpHook: false,
    });

    assert.equal(summary.status, 'SUCCEEDED');
    assert.equal(summary.result_count, 1);
    const env = JSON.parse(fs.readFileSync(path.join(dir, '.coreclaw', 'runs', summary.run_id, 'env.json'), 'utf8'));
    assert.match(env.LightpandaDomain, /^127\.0\.0\.1:\d+$/);
    assert.equal(env.PROXY_AUTH, 'coreclaw-local:***');
  } finally {
    if (previousNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = previousNodePath;
    }
  }
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
    files: {},
    writeJson(fileName, value) {
      this.files[fileName] = value;
    },
    finish(result) {
      this.finished = result;
    },
    summary() {
      return {
        result_count: resultCount,
        table_header_count: options.tableHeaderCount ?? 0,
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
        required: true,
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

function assertGeneratedWorkerPreflight({ result, language, requiredRootEntries }) {
  assert.equal(result.ok, true);
  assert.equal(result.language, language);
  assert.equal(result.result_count, 1);
  assert.equal(fs.existsSync(result.package_path), true);

  const summary = JSON.parse(fs.readFileSync(path.join(result.run_dir, 'summary.json'), 'utf8'));
  const outputIssuesPath = path.join(result.run_dir, 'output_schema_issues.json');
  const uploadManifest = JSON.parse(fs.readFileSync(path.join(result.run_dir, 'upload_manifest.json'), 'utf8'));
  const exportedRows = readNdjson(path.join(result.run_dir, 'export.ndjson'));
  const packageReport = inspectPackage(result.package_path);
  const packageValidation = validatePackageReport(packageReport, { language });

  assert.equal(summary.status, 'SUCCEEDED');
  assert.equal(summary.result_count, 1);
  assert.equal(summary.table_header_count, 3);
  assert.equal(summary.output_schema_issue_count, 0);
  assert.equal(fs.existsSync(outputIssuesPath), false);
  assert.deepEqual(exportedRows[0].value, {
    url: 'https://example.com',
    status: 'success',
    title: 'Example Domain',
  });
  assert.equal(uploadManifest.includes('output_schema.json'), true);
  assert.equal(packageValidation.ok, true);
  assert.equal(packageReport.root_entries.includes('output_schema.json'), true);
  for (const entry of requiredRootEntries) {
    assert.equal(uploadManifest.includes(entry), true);
    assert.equal(packageReport.root_entries.includes(entry), true);
  }
}

function readNdjson(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
