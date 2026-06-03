import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packCommand } from '../src/commands/pack.js';
import { inspectPackage, validatePackageReport } from '../src/commands/inspect-package.js';
import { collectFiles, copyWorkerFiles, createWorkerZip, previewUploadFiles } from '../src/pack/zip.js';
import { prepareUploadProject } from '../src/pack/upload-project.js';
import { CliError } from '../src/utils/errors.js';

test('collectFiles excludes cloud-irrelevant local artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-'));
  fs.writeFileSync(path.join(dir, 'main.js'), '');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '');
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'worker.test.js'), '');
  fs.mkdirSync(path.join(dir, '__tests__'));
  fs.writeFileSync(path.join(dir, '__tests__', 'worker.test.js'), '');
  fs.mkdirSync(path.join(dir, 'coverage'));
  fs.writeFileSync(path.join(dir, 'coverage', 'summary.json'), '{}');
  fs.mkdirSync(path.join(dir, '.pytest_cache'));
  fs.writeFileSync(path.join(dir, '.pytest_cache', 'README.md'), '');
  fs.writeFileSync(path.join(dir, 'input_schema.json'), '{}');

  assert.deepEqual(collectFiles(dir).sort(), ['input_schema.json', 'main.js']);
});

test('createWorkerZip creates a portable archive with only worker files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-zip-'));
  fs.writeFileSync(path.join(dir, 'main.js'), 'console.log("ok")\n');
  writeInputSchema(dir);
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'summary.json'), '{}\n');

  const outFile = path.join(dir, 'dist', 'worker.zip');
  createWorkerZip({ projectDir: dir, outFile });

  assert.equal(fs.existsSync(outFile), true);
  assert.deepEqual(listZipEntries(outFile).sort(), ['input_schema.json', 'main.js']);
});

test('packCommand creates a ZIP that passes package inspection', async () => {
  const dir = makeNodeProject();
  const outFile = path.join(dir, 'dist', 'worker.zip');

  const packagePath = await packCommand(dir, { output: outFile });
  const report = inspectPackage(packagePath);
  const validation = validatePackageReport(report, { language: 'node' });

  assert.equal(packagePath, outFile);
  assert.equal(validation.ok, true);
  assert.equal(report.root_entries.includes('main.js'), true);
  assert.equal(report.root_entries.includes('package.json'), true);
  assert.equal(report.root_entries.includes('sdk_grpc_pb.js'), true);
});

test('previewUploadFiles returns the same manifest used by ZIP creation', () => {
  const dir = makeNodeProject();
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'old.zip'), '');
  fs.mkdirSync(path.join(dir, '.coreclaw'));
  fs.writeFileSync(path.join(dir, '.coreclaw', 'run.json'), '{}\n');

  assert.deepEqual(previewUploadFiles(dir), collectFiles(dir));
});

test('packCommand print-files previews upload contents without creating a ZIP', async () => {
  const dir = makeNodeProject();
  const outFile = path.join(dir, 'dist', 'worker.zip');
  const output = await captureConsole(() => packCommand(dir, { output: outFile, printFiles: true }));

  assert.equal(fs.existsSync(outFile), false);
  assert.match(output.stdout, /CoreClaw upload package file preview:/);
  assert.match(output.stdout, /main\.js/);
  assert.match(output.stdout, /input_schema\.json/);
  assert.doesNotMatch(output.stdout, /\.coreclaw/);
  assert.doesNotMatch(output.stdout, /node_modules/);
});

test('packCommand print-files previews staged Go upload binary contents', async () => {
  const dir = makeGoProject();
  const output = await captureConsole(() => packCommand(dir, {
    printFiles: true,
    go: 'custom-go',
    spawnSyncImpl(_command, args, options) {
      const outputIndex = args.indexOf('-o') + 1;
      fs.writeFileSync(path.resolve(options.cwd, args[outputIndex]), 'linux-binary');
      return { status: 0, stdout: '', stderr: '' };
    },
  }));

  assert.equal(fs.existsSync(path.join(dir, 'main')), false);
  assert.match(output.stdout, /Built Go upload binary: main/);
  assert.match(output.stdout, /^  main$/m);
  assert.match(output.stdout, /^  main\.go$/m);
});

test('packCommand strict mode fails on static upload-readiness warnings', async () => {
  const dir = makeNodeProject();
  fs.rmSync(path.join(dir, 'output_schema.json'));

  await assert.rejects(
    () => packCommand(dir, { output: path.join(dir, 'dist', 'worker.zip'), strict: true }),
    (error) => error instanceof CliError
      && /Package validation found 1 warning\(s\) and --strict is enabled/.test(error.message)
      && /missing_output_schema_legacy/.test(error.message),
  );

  assert.equal(fs.existsSync(path.join(dir, 'dist', 'worker.zip')), false);
});

test('createWorkerZip preserves executable file mode for upload binaries', () => {
  const archive = createZipWithExecutableEntry();
  const entry = listZipEntryDetails(archive).find((item) => item.name === 'main');

  assert.equal(entry.attributes >>> 16, 0o100755);
});

test('prepareUploadProject builds Go upload binary in a staging directory', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-go-source-'));
  fs.writeFileSync(path.join(source, 'main.go'), 'package main\nfunc main() {}\n');
  fs.writeFileSync(path.join(source, 'go.mod'), 'module test\n');
  fs.writeFileSync(path.join(source, 'go.sum'), '');
  fs.writeFileSync(path.join(source, 'input_schema.json'), '{}\n');
  fs.mkdirSync(path.join(source, '.coreclaw'));
  fs.writeFileSync(path.join(source, '.coreclaw', 'local.json'), '{}\n');

  const calls = [];
  const uploadProject = prepareUploadProject(
    { language: 'go', projectDir: source },
    {
      go: 'custom-go',
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        fs.writeFileSync(path.join(options.cwd, 'main'), 'linux-binary');
        return { status: 0, stdout: '', stderr: '' };
      },
    },
  );

  try {
    assert.notEqual(uploadProject.projectDir, source);
    assert.equal(fs.existsSync(path.join(source, 'main')), false);
    assert.equal(fs.readFileSync(path.join(uploadProject.projectDir, 'main'), 'utf8'), 'linux-binary');
    assert.equal(fs.existsSync(path.join(uploadProject.projectDir, '.coreclaw')), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'custom-go');
    assert.deepEqual(calls[0].args, ['build', '-mod=readonly', '-o', 'main', './main.go']);
    assert.equal(calls[0].options.env.CGO_ENABLED, '0');
    assert.equal(calls[0].options.env.GOOS, 'linux');
    assert.equal(calls[0].options.env.GOARCH, 'amd64');
  } finally {
    const stagedDir = uploadProject.projectDir;
    uploadProject.cleanup();
    assert.equal(fs.existsSync(stagedDir), false);
  }
});

test('packCommand creates Go upload ZIP with executable root main', async () => {
  const source = makeGoProject();
  const outFile = path.join(source, 'dist', 'worker.zip');

  const packagePath = await packCommand(source, {
    output: outFile,
    go: 'custom-go',
    spawnSyncImpl(_command, args, options) {
      const outputIndex = args.indexOf('-o') + 1;
      fs.writeFileSync(path.resolve(options.cwd, args[outputIndex]), 'linux-binary');
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const report = inspectPackage(packagePath);
  const validation = validatePackageReport(report, { language: 'go' });
  const main = report.entries.find((entry) => entry.name === 'main');

  assert.equal(validation.ok, true);
  assert.equal(main.mode_octal, '100755');
  assert.equal(report.root_entries.includes('main'), true);
  assert.equal(report.root_entries.includes('input_schema.json'), true);
});

test('packCommand explains missing Go module checksums before upload', async () => {
  const source = makeGoProject();
  fs.writeFileSync(path.join(source, 'go.sum'), 'google.golang.org/protobuf v1.36.6 h1:fixture=\n');

  await assert.rejects(
    () => packCommand(source, { output: path.join(source, 'dist', 'worker.zip') }),
    (error) => error instanceof CliError
      && /Package validation failed/.test(error.message),
  );
});

test('prepareUploadProject adds a readonly Go module hint when build wants to rewrite go.sum', () => {
  const source = makeGoProject();

  assert.throws(
    () => prepareUploadProject(
      { language: 'go', projectDir: source },
      {
        go: 'custom-go',
        spawnSyncImpl() {
          return {
            status: 1,
            stdout: '',
            stderr: 'missing go.sum entry for module providing package google.golang.org/grpc',
          };
        },
      },
    ),
    (error) => error instanceof CliError
      && /Go upload build failed with exit code 1/.test(error.message)
      && /go mod tidy/.test(error.message)
      && /-mod=readonly/.test(error.message),
  );
});

test('copyWorkerFiles stages only uploadable worker files', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-stage-source-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-stage-target-'));
  fs.writeFileSync(path.join(source, 'main.js'), 'console.log("ok")\n');
  fs.writeFileSync(path.join(source, 'input_schema.json'), '{}\n');
  fs.mkdirSync(path.join(source, 'lib'));
  fs.writeFileSync(path.join(source, 'lib', 'helper.js'), 'module.exports = {}\n');
  fs.mkdirSync(path.join(source, '.coreclaw'));
  fs.writeFileSync(path.join(source, '.coreclaw', 'summary.json'), '{}\n');
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.writeFileSync(path.join(source, 'node_modules', 'dep.js'), '');
  fs.mkdirSync(path.join(source, 'dist'));
  fs.writeFileSync(path.join(source, 'dist', 'worker.zip'), '');

  const manifest = copyWorkerFiles(source, target);

  assert.deepEqual(manifest.sort(), ['input_schema.json', 'lib/helper.js', 'main.js']);
  assert.equal(fs.existsSync(path.join(target, 'main.js')), true);
  assert.equal(fs.existsSync(path.join(target, 'lib', 'helper.js')), true);
  assert.equal(fs.existsSync(path.join(target, '.coreclaw')), false);
  assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(target, 'dist')), false);
});

function listZipEntries(filePath) {
  const data = fs.readFileSync(filePath);
  return listZipEntryDetails(data).map((entry) => entry.name);
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const stdout = [];
  const stderr = [];
  console.log = (...args) => stdout.push(args.join(' '));
  console.warn = (...args) => stderr.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

function createZipWithExecutableEntry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-executable-'));
  const binary = path.join(dir, 'main');
  fs.writeFileSync(binary, 'binary\n');
  fs.chmodSync(binary, 0o755);
  const outFile = path.join(dir, 'worker.zip');
  createWorkerZip({ projectDir: dir, outFile });
  return fs.readFileSync(outFile);
}

function makeNodeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-node-project-'));
  fs.writeFileSync(path.join(dir, 'main.js'), 'console.log("ok")\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    dependencies: {
      '@grpc/grpc-js': '^1.14.3',
      'google-protobuf': '^4.0.2',
    },
  }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  writeInputSchema(dir);
  fs.writeFileSync(path.join(dir, 'output_schema.json'), '[]\n');
  fs.writeFileSync(path.join(dir, 'sdk.js'), '');
  fs.writeFileSync(path.join(dir, 'sdk_pb.js'), '');
  fs.writeFileSync(path.join(dir, 'sdk_grpc_pb.js'), '');
  return dir;
}

function makeGoProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-go-project-'));
  fs.mkdirSync(path.join(dir, 'GoSdk'));
  fs.writeFileSync(path.join(dir, 'main.go'), 'package main\nfunc main() {}\n');
  fs.writeFileSync(path.join(dir, 'go.mod'), [
    'module test',
    '',
    'go 1.23',
    '',
    'require (',
    '  google.golang.org/grpc v1.75.1',
    '  google.golang.org/protobuf v1.36.6',
    ')',
    '',
  ].join('\n'));
  writeGoSum(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  writeInputSchema(dir);
  fs.writeFileSync(path.join(dir, 'output_schema.json'), '[]\n');
  for (const file of ['sdk.go', 'sdk.pb.go', 'sdk_grpc.pb.go']) {
    fs.writeFileSync(path.join(dir, 'GoSdk', file), '');
  }
  return dir;
}

function writeInputSchema(dir) {
  fs.writeFileSync(path.join(dir, 'input_schema.json'), JSON.stringify({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList', default: [] },
    ],
  }));
}

function writeGoSum(dir) {
  fs.writeFileSync(path.join(dir, 'go.sum'), [
    'google.golang.org/grpc v1.75.1 h1:fixture=',
    'google.golang.org/protobuf v1.36.6 h1:fixture=',
    '',
  ].join('\n'));
}

function listZipEntryDetails(data) {
  const endOffset = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    entries.push({
      name: data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      attributes: data.readUInt32LE(cursor + 38),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(data) {
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('ZIP end of central directory not found');
}
