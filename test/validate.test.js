import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCommand } from '../src/commands/validate.js';
import { CliError } from '../src/utils/errors.js';

test('validateCommand strict mode fails on upload-readiness warnings', async () => {
  const dir = makeNodeProject({ outputSchema: false });

  await assert.rejects(
    () => validateCommand(dir, { strict: true }),
    (error) => error instanceof CliError
      && /Validation found 1 warning\(s\)/.test(error.message)
      && /missing_output_schema_legacy/.test(error.message),
  );
});

test('validateCommand soft mode allows strict warnings for report generation', async () => {
  const dir = makeNodeProject({ outputSchema: false });

  const result = await validateCommand(dir, { strict: true, soft: true });

  assert.equal(result.ok, true);
  assert.equal(result.issues.some((issue) => issue.code === 'missing_output_schema_legacy'), true);
});

function makeNodeProject(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-validate-command-node-'));
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
      { name: 'url', type: 'string' },
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
