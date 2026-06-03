import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError } from '../utils/errors.js';
import { copyWorkerFiles } from './zip.js';

export function prepareUploadProject(project, options = {}) {
  if (project.language !== 'go') {
    return {
      projectDir: project.projectDir,
      staged: false,
      cleanup() {},
    };
  }

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-pack-go-'));
  try {
    copyWorkerFiles(project.projectDir, stageDir);
    buildGoUploadBinary(stageDir, options);
    return {
      projectDir: stageDir,
      staged: true,
      cleanup() {
        fs.rmSync(stageDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
}

export function buildGoUploadBinary(projectDir, options = {}) {
  return buildGoBinary(projectDir, {
    ...options,
    output: 'main',
    env: {
      CGO_ENABLED: '0',
      GOOS: 'linux',
      GOARCH: 'amd64',
    },
    description: 'Go upload build',
  });
}

export function buildGoRuntimeBinary(projectDir, outputDir, options = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, hostGoExecutableName('main'));
  return buildGoBinary(projectDir, {
    ...options,
    output,
    env: {
      CGO_ENABLED: '0',
      GOOS: hostGoos(),
      GOARCH: hostGoarch(),
    },
    description: 'Go local runtime build',
  });
}

export function hostGoExecutableName(baseName) {
  return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}

function buildGoBinary(projectDir, options = {}) {
  const go = options.go ?? 'go';
  const spawnSyncImpl = typeof options.spawnSyncImpl === 'function' ? options.spawnSyncImpl : spawnSync;
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  };
  const output = options.output ?? 'main';
  const description = options.description ?? 'Go build';

  const result = spawnSyncImpl(go, ['build', '-mod=readonly', '-o', output, './main.go'], {
    cwd: projectDir,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`${description} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const hint = goModuleReadonlyHint(output);
    throw new CliError(`${description} failed with exit code ${result.status}.${output ? `\n${output}` : ''}${hint}`);
  }

  const binaryPath = path.resolve(projectDir, options.output ?? 'main');
  if (!fs.existsSync(binaryPath)) {
    throw new CliError(`${description} finished but did not create the required executable "${output}".`);
  }

  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function goModuleReadonlyHint(output) {
  if (!/(missing go\.sum entry|updates to go\.(mod|sum) needed|-mod=readonly)/i.test(output)) {
    return '';
  }
  return '\nCoreClaw Go upload builds use -mod=readonly so dependency files cannot be rewritten during preflight. Run "go mod tidy" or "go mod download" in the source project, commit the updated go.mod/go.sum, then run verify/pack again.';
}

function hostGoos() {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    default:
      return process.platform;
  }
}

function hostGoarch() {
  switch (process.arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    case 'ia32':
      return '386';
    default:
      return process.arch;
  }
}
