import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectPackage, inspectPackageCommand, validatePackageReport } from '../src/commands/inspect-package.js';
import { buildZipArchive } from '../src/pack/zip.js';
import { CliError } from '../src/utils/errors.js';

test('inspectPackage reads ZIP entries and Unix modes', () => {
  const zipPath = writeZip([
    { name: 'main', data: 'binary', mode: 0o100755 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
  ]);

  const report = inspectPackage(zipPath);

  assert.equal(report.entry_count, 2);
  assert.equal(report.entries.find((entry) => entry.name === 'main').mode_octal, '100755');
  assert.equal(report.root_entries.includes('main'), true);
});

test('inspectPackage reports largest entries by uncompressed size', () => {
  const report = inspectPackage(writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
    { name: 'assets/runtime-large.bin', data: 'x'.repeat(256), mode: 0o100644 },
    { name: 'assets/runtime-medium.bin', data: 'y'.repeat(128), mode: 0o100644 },
  ]));

  assert.equal(report.largest_entries[0].name, 'assets/runtime-large.bin');
  assert.equal(report.largest_entries[0].uncompressed_size, 256);
  assert.match(report.largest_entries[0].uncompressed_size_human, /B$/);
  assert.equal(report.largest_entries[1].name, 'assets/runtime-medium.bin');
});

test('inspectPackageCommand validates Go root main executable mode', async () => {
  const zipPath = writeZip([
    { name: 'main', data: 'binary', mode: 0o100755 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
  ]);

  const report = await inspectPackageCommand(zipPath, { language: 'go' });

  assert.equal(report.ok, true);
});

test('inspectPackageCommand prints largest entries', async () => {
  const zipPath = writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'README.md', data: '# Test\n', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'output_schema.json', data: '[]', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
    { name: 'large-runtime-asset.bin', data: 'x'.repeat(256), mode: 0o100644 },
  ]);

  const output = await captureConsole(() => inspectPackageCommand(zipPath, { language: 'node' }));

  assert.match(output, /Largest entries:/);
  assert.match(output, /large-runtime-asset\.bin/);
});

test('inspectPackageCommand validates Node and Python root entry files', async () => {
  const nodeReport = await inspectPackageCommand(writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
  ]), { language: 'node' });
  const pythonReport = await inspectPackageCommand(writeZip([
    { name: 'main.py', data: 'print("ok")', mode: 0o100644 },
    { name: 'requirements.txt', data: 'grpcio\nprotobuf\n', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'sdk.py', data: '', mode: 0o100644 },
    { name: 'sdk_pb2.py', data: '', mode: 0o100644 },
    { name: 'sdk_pb2_grpc.py', data: '', mode: 0o100644 },
  ]), { language: 'python' });

  assert.equal(nodeReport.language, 'node');
  assert.equal(nodeReport.ok, true);
  assert.equal(pythonReport.language, 'python');
  assert.equal(pythonReport.ok, true);
});

test('validatePackageReport reports recommended root file warnings without failing', () => {
  const report = inspectPackage(writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
  ]));

  const validation = validatePackageReport(report, { language: 'node' });

  assert.equal(validation.ok, true);
  assert.equal(validation.issues.filter((issue) => issue.severity === 'warn').length, 2);
  assert.equal(validation.issues.some((issue) => issue.message.includes('README.md')), true);
  assert.equal(validation.issues.some((issue) => issue.message.includes('output_schema.json')), true);
});

test('validatePackageReport warns when upload ZIP exceeds advisory package size threshold', () => {
  const report = inspectPackage(writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'README.md', data: '# Test\n', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'output_schema.json', data: '[]', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
    { name: 'large-runtime-asset.bin', data: 'x'.repeat(256), mode: 0o100644 },
  ]));

  const validation = validatePackageReport(report, { language: 'node', maxPackageSize: '200B' });

  assert.equal(validation.ok, true);
  assert.equal(validation.issues.some((issue) => issue.code === 'package_size_exceeds_threshold'), true);
  assert.equal(validation.issues.find((issue) => issue.code === 'package_size_exceeds_threshold').severity, 'warn');
});

test('inspectPackageCommand strict mode rejects package size warnings', async () => {
  const zipPath = writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'README.md', data: '# Test\n', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'output_schema.json', data: '[]', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
    { name: 'large-runtime-asset.bin', data: 'x'.repeat(256), mode: 0o100644 },
  ]);

  await assert.rejects(
    () => inspectPackageCommand(zipPath, { language: 'node', maxPackageSize: '200B', strict: true }),
    (error) => error instanceof CliError
      && /Package validation found 1 warning\(s\) and --strict is enabled/.test(error.message)
      && /package_size_exceeds_threshold/.test(error.message),
  );
});

test('inspectPackageCommand strict mode rejects package warnings', async () => {
  const zipPath = writeZip([
    { name: 'main.js', data: 'console.log("ok")', mode: 0o100644 },
    { name: 'package.json', data: '{"dependencies":{}}', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'sdk.js', data: '', mode: 0o100644 },
    { name: 'sdk_pb.js', data: '', mode: 0o100644 },
    { name: 'sdk_grpc_pb.js', data: '', mode: 0o100644 },
  ]);

  await assert.rejects(
    () => inspectPackageCommand(zipPath, { language: 'node', strict: true }),
    (error) => error instanceof CliError
      && /Package validation found 2 warning\(s\) and --strict is enabled/.test(error.message)
      && /package_missing_recommended_root_entry/.test(error.message),
  );
});

test('inspectPackageCommand rejects Go packages without executable root main', async () => {
  const zipPath = writeZip([
    { name: 'main', data: 'binary', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
  ]);
  const validation = validatePackageReport(inspectPackage(zipPath), { language: 'go' });

  assert.equal(validation.issues.some((issue) => /mode must be 100755/.test(issue.message)), true);

  await assert.rejects(
    () => inspectPackageCommand(zipPath, { language: 'go' }),
    (error) => error instanceof CliError && /Package validation failed/.test(error.message),
  );
});

test('inspectPackageCommand rejects Go source packages without upload binary', async () => {
  const zipPath = writeZip([
    { name: 'main.go', data: 'package main', mode: 0o100644 },
    { name: 'go.mod', data: 'module test', mode: 0o100644 },
    { name: 'input_schema.json', data: '{}', mode: 0o100644 },
  ]);
  const validation = validatePackageReport(inspectPackage(zipPath), { language: 'go' });

  assert.equal(validation.issues.some((issue) => /compiled Linux amd64 executable "main"/.test(issue.message)), true);

  await assert.rejects(
    () => inspectPackageCommand(zipPath, { language: 'go' }),
    (error) => error instanceof CliError && /Package validation failed/.test(error.message),
  );
});

test('inspectPackageCommand rejects ZIPs with the worker directory wrapper', async () => {
  const zipPath = writeZip([
    { name: 'worker/main.py', data: 'print("ok")', mode: 0o100644 },
    { name: 'worker/requirements.txt', data: 'grpcio\nprotobuf\n', mode: 0o100644 },
    { name: 'worker/input_schema.json', data: '{}', mode: 0o100644 },
    { name: 'worker/sdk.py', data: '', mode: 0o100644 },
    { name: 'worker/sdk_pb2.py', data: '', mode: 0o100644 },
    { name: 'worker/sdk_pb2_grpc.py', data: '', mode: 0o100644 },
  ]);
  const validation = validatePackageReport(inspectPackage(zipPath), { language: 'python' });

  assert.equal(validation.issues.some((issue) => /Zip the contents of the worker directory/.test(issue.message)), true);

  await assert.rejects(
    () => inspectPackageCommand(zipPath, { language: 'python' }),
    (error) => error instanceof CliError && /Package validation failed/.test(error.message),
  );
});

function writeZip(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-inspect-package-'));
  const zipPath = path.join(dir, 'worker.zip');
  fs.writeFileSync(zipPath, buildZipArchive(entries));
  return zipPath;
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const stdout = [];
  console.log = (...args) => stdout.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return stdout.join('\n');
}
