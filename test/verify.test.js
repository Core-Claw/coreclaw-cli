import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildVerifyCompareOptions,
  buildVerifyPackOptions,
  buildVerifyRunOptions,
  createPythonVerifyVenv,
  resolveVerifyProfileOptions,
  resolveVerifyCompareOutput,
  resolveVerifyOutput,
  stageVerifyProject,
  verifyCommand,
} from '../src/commands/verify.js';
import { CliError } from '../src/utils/errors.js';

test('buildVerifyRunOptions defaults to one-row and status upload preflight gates', () => {
  assert.deepEqual(buildVerifyRunOptions({ timeoutMs: '30s' }), {
    timeoutMs: '30s',
    python: 'python',
    node: 'node',
    go: 'go',
    minResults: '1',
    install: true,
    requireStatusOk: true,
  });
});

test('buildVerifyRunOptions preserves explicit runtime options', () => {
  assert.deepEqual(buildVerifyRunOptions({
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
    install: false,
    requireStatusOk: false,
  }), {
    minResults: '5',
    python: 'py -3',
    command: 'py -3 main.py',
    noPack: true,
    install: false,
    requireStatusOk: false,
    node: 'node',
    go: 'go',
  });
});

test('buildVerifyRunOptions falls back to explicit Python when staged Python is absent', () => {
  assert.deepEqual(buildVerifyRunOptions({
    python: undefined,
    node: undefined,
    go: undefined,
    install: false,
  }), {
    python: 'python',
    node: 'node',
    go: 'go',
    install: false,
    minResults: '1',
    requireStatusOk: true,
  });
});

test('buildVerifyRunOptions strict mode enables upload preflight runtime gates', () => {
  assert.deepEqual(buildVerifyRunOptions({
    strict: true,
    requireTableHeader: false,
    install: false,
  }), {
    strict: true,
    requireTableHeader: false,
    install: false,
    python: 'python',
    node: 'node',
    go: 'go',
    minResults: '1',
    requireOutputSchemaMatch: true,
    requireStatusOk: true,
  });
});

test('resolveVerifyProfileOptions applies safe run defaults from compare profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-profile-options-'));
  const profilePath = path.join(dir, 'compare-profile.json');
  fs.writeFileSync(profilePath, JSON.stringify({
    local_proxy: true,
    require_proxy_usage: true,
    require_status_ok: false,
    result_status_fields: ['status', 'check_status'],
    result_fail_values: ['fail', 'error'],
    lightpanda_shim: true,
    ignore_keys: ['compare-only'],
    min_shared: 1,
  }));

  assert.deepEqual(
    resolveVerifyProfileOptions({
      compareProfile: profilePath,
      requireProxyUsage: false,
      pack: false,
    }),
    {
      localProxy: true,
      requireProxyUsage: false,
      requireStatusOk: false,
      resultStatusFields: 'status,check_status',
      resultFailValues: 'fail,error',
      lightpandaShim: true,
      compareProfile: profilePath,
      pack: false,
    },
  );
});

test('resolveVerifyOutput writes packages under .coreclaw/verify by default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-output-'));
  const outFile = resolveVerifyOutput(dir);
  const parts = path.relative(dir, outFile).split(path.sep);

  assert.equal(path.basename(outFile), `${path.basename(dir)}.zip`);
  assert.equal(parts[0], '.coreclaw');
  assert.equal(parts[1], 'verify');
  assert.equal(fs.existsSync(path.dirname(outFile)), true);
});

test('resolveVerifyOutput respects explicit output path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-output-explicit-'));
  const outFile = resolveVerifyOutput(dir, { output: path.join(dir, 'dist', 'worker.zip') });

  assert.equal(outFile, path.join(dir, 'dist', 'worker.zip'));
});

test('buildVerifyCompareOptions passes cloud parity gates to compare', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-options-'));
  fs.writeFileSync(path.join(dir, 'output_schema.json'), '[]\n');

  assert.deepEqual(
    buildVerifyCompareOptions({
      keyFields: 'username,site,urlUser',
      minShared: '1',
      maxDiff: '0',
      maxOnlyLocal: '2',
      maxOnlyCloud: '3',
      compareProfile: 'compare-profile.json',
      requireOutputSchemaMatch: true,
      resultStatusFields: 'status,check_status',
      resultFailValues: 'fail,error,manual',
      ignoreFields: 'completed_at',
      ignoreKeys: 'profile-only',
      ignoreKeysFile: 'profile-ignore-keys.json',
      requireUniqueKeys: true,
    }, 'report.json', dir),
    {
      keyFields: 'username,site,urlUser',
      minShared: '1',
      maxDiff: '0',
      maxOnlyLocal: '2',
      maxOnlyCloud: '3',
      compareProfile: 'compare-profile.json',
      requireStatusOk: true,
      requireResultStatusOk: undefined,
      resultStatusFields: 'status,check_status',
      resultFailValues: 'fail,error,manual',
      requireOutputSchemaMatch: true,
      outputSchema: undefined,
      ignoreFields: 'completed_at',
      ignoreKeys: 'profile-only',
      ignoreKeysFile: 'profile-ignore-keys.json',
      requireUniqueKeys: true,
      output: 'report.json',
    },
  );
});

test('buildVerifyCompareOptions uses worker output_schema by default without a compare profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-default-schema-'));
  const schemaPath = path.join(dir, 'output_schema.json');
  fs.writeFileSync(schemaPath, '[]\n');

  assert.equal(
    buildVerifyCompareOptions({}, 'report.json', dir).outputSchema,
    schemaPath,
  );
});

test('buildVerifyCompareOptions respects explicit output schema', () => {
  assert.deepEqual(
    buildVerifyCompareOptions({
      compareProfile: 'compare-profile.json',
      outputSchema: 'custom-output-schema.json',
    }, 'report.json', 'project'),
    {
      keyFields: undefined,
      minShared: undefined,
      maxDiff: undefined,
      maxOnlyLocal: undefined,
      maxOnlyCloud: undefined,
      compareProfile: 'compare-profile.json',
      requireStatusOk: true,
      requireResultStatusOk: undefined,
      resultStatusFields: undefined,
      resultFailValues: undefined,
      requireOutputSchemaMatch: undefined,
      outputSchema: 'custom-output-schema.json',
      ignoreFields: undefined,
      ignoreKeys: undefined,
      ignoreKeysFile: undefined,
      requireUniqueKeys: undefined,
      output: 'report.json',
    },
  );
});

test('buildVerifyCompareOptions strict mode enables cloud parity gates unless explicit values override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-strict-'));
  const schemaPath = path.join(dir, 'output_schema.json');
  fs.writeFileSync(schemaPath, '[]\n');

  assert.deepEqual(
    buildVerifyCompareOptions({
      strict: true,
      requireStatusOk: false,
    }, 'report.json', dir),
    {
      keyFields: undefined,
      minShared: undefined,
      maxDiff: undefined,
      maxOnlyLocal: undefined,
      maxOnlyCloud: undefined,
      compareProfile: undefined,
      requireStatusOk: false,
      requireResultStatusOk: undefined,
      resultStatusFields: undefined,
      resultFailValues: undefined,
      requireOutputSchemaMatch: true,
      outputSchema: schemaPath,
      ignoreFields: undefined,
      ignoreKeys: undefined,
      ignoreKeysFile: undefined,
      requireUniqueKeys: undefined,
      output: 'report.json',
    },
  );
});

test('buildVerifyPackOptions passes strict mode to final package inspection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-pack-options-'));

  assert.deepEqual(
    buildVerifyPackOptions(dir, {
      output: path.join(dir, 'dist', 'worker.zip'),
      go: 'custom-go',
      strict: true,
    }),
    {
      output: path.join(dir, 'dist', 'worker.zip'),
      validate: true,
      go: 'custom-go',
      maxPackageSize: undefined,
      strict: true,
    },
  );
});

test('buildVerifyPackOptions passes package size threshold to final package inspection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-pack-size-options-'));

  assert.deepEqual(
    buildVerifyPackOptions(dir, {
      output: path.join(dir, 'dist', 'worker.zip'),
      maxPackageSize: '25MB',
    }),
    {
      output: path.join(dir, 'dist', 'worker.zip'),
      validate: true,
      go: undefined,
      maxPackageSize: '25MB',
      strict: undefined,
    },
  );
});

test('resolveVerifyCompareOutput defaults to the local run directory', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-'));

  assert.equal(resolveVerifyCompareOutput(runDir), path.join(runDir, 'cloud-comparison.json'));
});

test('resolveVerifyCompareOutput respects explicit compare report path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-compare-explicit-'));
  const reportPath = path.join(dir, 'reports', 'compare.json');

  assert.equal(resolveVerifyCompareOutput(path.join(dir, 'run'), { compareOutput: reportPath }), reportPath);
});

test('stageVerifyProject copies only uploadable files to a temporary project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-stage-source-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');
  fs.writeFileSync(path.join(dir, 'input.example.json'), '{"items":[]}');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '');

  const staged = stageVerifyProject(dir);

  assert.equal(staged.staged, true);
  assert.notEqual(staged.projectDir, dir);
  assert.equal(path.dirname(staged.projectDir), path.join(dir, '.coreclaw', 'staging'));
  assert.deepEqual(staged.manifest.sort(), ['input_schema.json', 'main.js']);
  assert.equal(fs.existsSync(path.join(staged.projectDir, 'main.js')), true);
  assert.equal(fs.existsSync(path.join(staged.projectDir, '.coreclaw')), false);
  assert.equal(fs.existsSync(path.join(staged.projectDir, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(staged.projectDir, 'input.example.json')), false);

  fs.rmSync(staged.projectDir, { recursive: true, force: true });
});

test('stageVerifyProject preserves explicit install option for upload-like runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-stage-install-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');

  const staged = stageVerifyProject(dir, { install: false });

  try {
    assert.equal(staged.install, false);
  } finally {
    fs.rmSync(staged.projectDir, { recursive: true, force: true });
  }
});

test('stageVerifyProject creates an isolated Python venv for upload-like installs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-python-venv-'));
  fs.writeFileSync(path.join(dir, 'main.py'), '');
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'grpcio\nprotobuf\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');
  const calls = [];

  const staged = stageVerifyProject(dir, {
    language: 'python',
    python: 'py -3',
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      fs.mkdirSync(args.at(-1), { recursive: true });
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  try {
    assert.equal(staged.staged, true);
    const runOptions = buildVerifyRunOptions({
      install: staged.install,
      python: staged.python,
    });
    assert.equal(staged.install, undefined);
    assert.equal(runOptions.install, true);
    assert.match(staged.python, process.platform === 'win32' ? /Scripts\\python\.exe$/ : /bin\/python$/);
    assert.deepEqual(calls.map((call) => [call.command, call.args.slice(0, -1)]), [
      ['py', ['-3', '-m', 'venv']],
    ]);
    assert.equal(fs.existsSync(path.join(staged.projectDir, '.coreclaw-python-venv')), true);
  } finally {
    fs.rmSync(staged.projectDir, { recursive: true, force: true });
  }
});

test('stageVerifyProject skips Python venv creation when install is disabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-python-no-venv-'));
  fs.writeFileSync(path.join(dir, 'main.py'), '');
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'grpcio\nprotobuf\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');

  const staged = stageVerifyProject(dir, {
    language: 'python',
    install: false,
    spawnSyncImpl() {
      throw new Error('should not be called');
    },
  });

  try {
    assert.equal(staged.staged, true);
    assert.equal(staged.install, false);
    assert.equal(staged.python, undefined);
    assert.equal(fs.existsSync(path.join(staged.projectDir, '.coreclaw-python-venv')), false);
  } finally {
    fs.rmSync(staged.projectDir, { recursive: true, force: true });
  }
});

test('createPythonVerifyVenv reports venv creation failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-python-venv-error-'));

  assert.throws(
    () => createPythonVerifyVenv(dir, {
      python: 'py -3',
      spawnSyncImpl() {
        return { status: 2, stdout: '', stderr: 'No module named venv' };
      },
    }),
    (error) => error instanceof CliError
      && /Python verify virtualenv failed with exit code 2/.test(error.message)
      && /No module named venv/.test(error.message),
  );
});

test('stageVerifyProject can be disabled for source-directory debugging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-no-stage-'));

  assert.deepEqual(stageVerifyProject(dir, { staging: false }), {
    projectDir: dir,
    staged: false,
    manifest: null,
  });
});

test('stageVerifyProject prepares Go verify runtime from the upload binary instead of source files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-go-stage-source-'));
  fs.mkdirSync(path.join(dir, 'GoSdk'));
  fs.writeFileSync(path.join(dir, 'main.go'), 'package main\nfunc main() {}\n');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module test\n');
  fs.writeFileSync(path.join(dir, 'go.sum'), '');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');
  fs.writeFileSync(path.join(dir, 'output_schema.json'), '[]');
  for (const file of ['sdk.go', 'sdk.pb.go', 'sdk_grpc.pb.go']) {
    fs.writeFileSync(path.join(dir, 'GoSdk', file), '');
  }

  const calls = [];
  const staged = stageVerifyProject(dir, {
    language: 'go',
    go: 'custom-go',
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      const outputIndex = args.indexOf('-o') + 1;
      fs.writeFileSync(path.resolve(options.cwd, args[outputIndex]), 'go-binary');
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  try {
    assert.equal(staged.staged, true);
    assert.equal(fs.readFileSync(path.join(staged.projectDir, process.platform === 'win32' ? 'main.exe' : 'main'), 'utf8'), 'go-binary');
    assert.equal(fs.readFileSync(path.join(staged.projectDir, 'main'), 'utf8'), 'go-binary');
    assert.equal(fs.existsSync(path.join(staged.projectDir, 'main.go')), false);
    assert.equal(fs.existsSync(path.join(staged.projectDir, 'go.mod')), false);
    assert.equal(fs.existsSync(path.join(staged.projectDir, 'GoSdk')), false);
    assert.equal(fs.existsSync(path.join(staged.projectDir, 'input_schema.json')), true);
    assert.equal(fs.existsSync(path.join(staged.projectDir, 'output_schema.json')), true);
    assert.deepEqual(staged.manifest.sort(), [
      'GoSdk/sdk.go',
      'GoSdk/sdk.pb.go',
      'GoSdk/sdk_grpc.pb.go',
      'README.md',
      'go.mod',
      'go.sum',
      'input_schema.json',
      'main',
      'main.go',
      'output_schema.json',
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, 'custom-go');
    assert.deepEqual(calls[0].args, ['build', '-mod=readonly', '-o', 'main', './main.go']);
    assert.equal(calls[0].options.env.GOOS, 'linux');
    assert.equal(calls[1].command, 'custom-go');
    assert.deepEqual(calls[1].args, ['build', '-mod=readonly', '-o', path.join(staged.projectDir, process.platform === 'win32' ? 'main.exe' : 'main'), './main.go']);
    assert.equal(calls[1].options.env.GOOS, process.platform === 'win32' ? 'windows' : process.platform);
  } finally {
    fs.rmSync(staged.projectDir, { recursive: true, force: true });
    for (const dir of staged.cleanupExtraDirs ?? []) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('verifyCommand strict mode fails before runtime on validation warnings', async () => {
  const dir = makeNodeProject({ outputSchema: false });

  await assert.rejects(
    () => verifyCommand(dir, { strict: true, install: false, pack: false }),
    (error) => error instanceof CliError
      && /Preflight validation found 1 warning\(s\)/.test(error.message)
      && /missing_output_schema_legacy/.test(error.message),
  );

  assert.equal(fs.existsSync(path.join(dir, '.coreclaw', 'runs')), false);
});

function makeNodeProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-command-node-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), JSON.stringify({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList', default: [] },
    ],
  }));
  if (options.outputSchema !== false) {
    fs.writeFileSync(path.join(dir, 'output_schema.json'), JSON.stringify([
      { name: 'ok', type: 'boolean' },
    ]));
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    main: 'main.js',
    type: 'commonjs',
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
