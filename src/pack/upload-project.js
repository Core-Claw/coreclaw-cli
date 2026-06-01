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
  const go = options.go ?? 'go';
  const spawnSyncImpl = typeof options.spawnSyncImpl === 'function' ? options.spawnSyncImpl : spawnSync;
  const env = {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: 'linux',
    GOARCH: 'amd64',
  };

  const result = spawnSyncImpl(go, ['build', '-o', 'main', './main.go'], {
    cwd: projectDir,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`Go upload build failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new CliError(`Go upload build failed with exit code ${result.status}.${output ? `\n${output}` : ''}`);
  }

  const binaryPath = path.join(projectDir, 'main');
  if (!fs.existsSync(binaryPath)) {
    throw new CliError('Go upload build finished but did not create the required Linux executable "main".');
  }

  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}
