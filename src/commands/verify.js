import path from 'node:path';
import fs from 'node:fs';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { formatIssues, validateProject } from '../validation/project.js';
import { runCommand } from './run.js';
import { packCommand } from './pack.js';

export async function verifyCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const project = validateProject(projectDir);

  console.log(`CoreClaw upload preflight: ${projectDir}`);
  console.log(`Language: ${project.spec.label}`);
  console.log(formatIssues(project.issues));
  if (!project.ok) {
    throw new CliError('Preflight validation failed.');
  }

  console.log('\n[1/2] Running worker locally...');
  const runSummary = await runCommand(projectDir, buildVerifyRunOptions(options));

  let packagePath = null;
  if (options.pack !== false) {
    console.log('\n[2/2] Creating upload package...');
    packagePath = await packCommand(projectDir, {
      output: resolveVerifyOutput(projectDir, options),
      validate: true,
    });
  } else {
    console.log('\n[2/2] Skipping upload package (--no-pack).');
  }

  const result = {
    ok: true,
    project_dir: projectDir,
    language: project.language,
    run_id: runSummary.run_id,
    result_count: runSummary.result_count,
    run_dir: runSummary.results_path ? path.dirname(runSummary.results_path) : null,
    package_path: packagePath,
  };

  console.log('\nCoreClaw preflight passed.');
  console.log(`Run: ${runSummary.run_id} (${runSummary.result_count} result(s))`);
  if (packagePath) {
    console.log(`Package: ${packagePath}`);
  }
  return result;
}

export function buildVerifyRunOptions(options = {}) {
  return {
    ...options,
    python: options.python ?? 'python',
    node: options.node ?? 'node',
    go: options.go ?? 'go',
    minResults: options.minResults ?? '1',
  };
}

export function resolveVerifyOutput(projectDir, options = {}) {
  if (options.output) {
    return path.resolve(process.cwd(), options.output);
  }

  const verifyDir = path.join(projectDir, '.coreclaw', 'verify', createVerifyId());
  fs.mkdirSync(verifyDir, { recursive: true });
  return path.join(verifyDir, `${path.basename(projectDir)}.zip`);
}

function createVerifyId() {
  const now = new Date();
  const stamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}
