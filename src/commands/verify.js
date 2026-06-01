import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { formatIssues, validateProject } from '../validation/project.js';
import { copyWorkerFiles } from '../pack/zip.js';
import { runCommand } from './run.js';
import { packCommand } from './pack.js';
import { compareCommand } from './compare.js';

export async function verifyCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const project = validateProject(projectDir);

  console.log(`CoreClaw upload preflight: ${projectDir}`);
  console.log(`Language: ${project.spec.label}`);
  console.log(formatIssues(project.issues));
  if (!project.ok) {
    throw new CliError('Preflight validation failed.');
  }

  const stepCount = 1 + (options.cloudOutput ? 1 : 0) + (options.pack === false ? 0 : 1);
  let step = 1;

  console.log(`\n[${step}/${stepCount}] Running worker locally...`);
  step += 1;
  const stagedProject = stageVerifyProject(projectDir, options);
  let runSummary;
  try {
    runSummary = await runCommand(stagedProject.projectDir, buildVerifyRunOptions({
      ...options,
      artifactProjectDir: projectDir,
      uploadManifest: stagedProject.manifest,
    }));
  } finally {
    cleanupVerifyStage(stagedProject);
  }
  const runDir = runSummary.results_path ? path.dirname(runSummary.results_path) : null;

  let compareReport = null;
  let compareReportPath = null;
  if (options.cloudOutput) {
    console.log(`\n[${step}/${stepCount}] Comparing cloud output...`);
    step += 1;
    compareReportPath = resolveVerifyCompareOutput(runDir, options);
    compareReport = await compareCommand(
      options.cloudOutput,
      runDir,
      buildVerifyCompareOptions(options, compareReportPath),
    );
  }

  let packagePath = null;
  if (options.pack !== false) {
    console.log(`\n[${step}/${stepCount}] Creating upload package...`);
    packagePath = await packCommand(projectDir, {
      output: resolveVerifyOutput(projectDir, options),
      validate: true,
    });
  } else {
    console.log('\nSkipping upload package (--no-pack).');
  }

  const result = {
    ok: true,
    project_dir: projectDir,
    language: project.language,
    run_id: runSummary.run_id,
    result_count: runSummary.result_count,
    run_dir: runDir,
    compare_report_path: compareReportPath,
    compare_report: compareReport,
    package_path: packagePath,
  };

  console.log('\nCoreClaw preflight passed.');
  console.log(`Run: ${runSummary.run_id} (${runSummary.result_count} result(s))`);
  if (compareReportPath) {
    console.log(`Cloud comparison: ${compareReportPath}`);
  }
  if (packagePath) {
    console.log(`Package: ${packagePath}`);
  }
  return result;
}

export function stageVerifyProject(projectDir, options = {}) {
  if (options.staging === false) {
    return {
      projectDir,
      staged: false,
      manifest: null,
    };
  }

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coreclaw-verify-stage-'));
  const manifest = copyWorkerFiles(projectDir, stageDir);
  return {
    projectDir: stageDir,
    staged: true,
    manifest,
  };
}

export function buildVerifyRunOptions(options = {}) {
  return {
    ...options,
    python: options.python ?? 'python',
    node: options.node ?? 'node',
    go: options.go ?? 'go',
    minResults: options.minResults ?? '1',
    install: options.install ?? true,
  };
}

export function buildVerifyCompareOptions(options = {}, output) {
  return {
    keyFields: options.keyFields,
    minShared: options.minShared,
    maxDiff: options.maxDiff,
    maxOnlyLocal: options.maxOnlyLocal,
    maxOnlyCloud: options.maxOnlyCloud,
    output,
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

export function resolveVerifyCompareOutput(runDir, options = {}) {
  if (options.compareOutput) {
    return path.resolve(process.cwd(), options.compareOutput);
  }

  if (!runDir) {
    throw new CliError('Cannot write cloud comparison report because the local run directory is unknown.');
  }

  return path.join(runDir, 'cloud-comparison.json');
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

function cleanupVerifyStage(stagedProject) {
  if (stagedProject?.staged) {
    fs.rmSync(stagedProject.projectDir, { recursive: true, force: true });
  }
}
