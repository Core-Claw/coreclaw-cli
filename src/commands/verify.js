import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { formatIssues, validateProject } from '../validation/project.js';
import { copyWorkerFiles } from '../pack/zip.js';
import { buildGoRuntimeBinary, buildGoUploadBinary, hostGoExecutableName } from '../pack/upload-project.js';
import { splitCommandLine } from '../runtime/executor.js';
import { runCommand } from './run.js';
import { packCommand } from './pack.js';
import { compareCommand } from './compare.js';
import { enforceStrictValidation } from './validate.js';
import { printJson, shouldPrintJson, withJsonProgressOnStderr } from '../utils/output.js';

export async function verifyCommand(projectPath = '.', options = {}) {
  const result = await withJsonProgressOnStderr(options, () => verifyCommandInternal(projectPath, {
    ...options,
    jsonOutput: false,
  }));
  if (shouldPrintJson(options)) {
    printJson(result);
  }
  return result;
}

async function verifyCommandInternal(projectPath = '.', options = {}) {
  const verifyOptions = resolveVerifyProfileOptions(options);
  const projectDir = resolveProjectPath(projectPath);
  const project = validateProject(projectDir);

  console.log(`CoreClaw upload preflight: ${projectDir}`);
  console.log(`Language: ${project.spec.label}`);
  console.log(formatIssues(project.issues));
  if (!project.ok) {
    throw new CliError('Preflight validation failed.');
  }
  enforceStrictValidation(project, verifyOptions, 'Preflight validation');

  const shouldCompare = Boolean(verifyOptions.cloudOutput) && verifyOptions.compare !== false;
  const stepCount = 1 + (shouldCompare ? 1 : 0) + (verifyOptions.pack === false ? 0 : 1);
  let step = 1;

  console.log(`\n[${step}/${stepCount}] Running worker locally...`);
  step += 1;
  const stagedProject = stageVerifyProject(projectDir, {
    ...verifyOptions,
    language: project.language,
  });
  let runSummary;
  try {
    runSummary = await runCommand(stagedProject.projectDir, buildVerifyRunOptions({
      ...verifyOptions,
      artifactProjectDir: projectDir,
      uploadManifest: stagedProject.manifest,
      validationProjectDir: stagedProject.validationProjectDir,
      runtimeLanguage: stagedProject.runtimeLanguage,
      install: stagedProject.install,
      python: stagedProject.python ?? verifyOptions.python,
    }));
  } finally {
    cleanupVerifyStage(stagedProject);
  }
  const runDir = runSummary.results_path ? path.dirname(runSummary.results_path) : null;

  let compareReport = null;
  let compareReportPath = null;
  if (shouldCompare) {
    console.log(`\n[${step}/${stepCount}] Comparing cloud output...`);
    step += 1;
    compareReportPath = resolveVerifyCompareOutput(runDir, verifyOptions);
    compareReport = await compareCommand(
      verifyOptions.cloudOutput,
      runDir,
      buildVerifyCompareOptions(verifyOptions, compareReportPath, projectDir),
    );
  }

  let packagePath = null;
  if (verifyOptions.pack !== false) {
    console.log(`\n[${step}/${stepCount}] Creating upload package...`);
    packagePath = await packCommand(projectDir, buildVerifyPackOptions(projectDir, verifyOptions));
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

export function resolveVerifyProfileOptions(options = {}) {
  if (!options.compareProfile) {
    return options;
  }
  const profile = readVerifyProfile(options.compareProfile);
  const runDefaults = extractVerifyRunDefaults(profile);
  return {
    ...runDefaults,
    ...definedOptions(options),
  };
}

function readVerifyProfile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  let parsed;
  try {
    parsed = JSON.parse(stripBom(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid verify compare profile JSON in ${resolved}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`Verify compare profile must be a JSON object: ${resolved}`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [toCamel(key), value]));
}

function extractVerifyRunDefaults(profile) {
  const allowed = new Set([
    'localProxy',
    'cloudProxy',
    'proxyAuth',
    'proxyDomain',
    'browserCdpShim',
    'requireBrowserCdpShim',
    'lightpandaShim',
    'requireLightpandaShim',
    'captchaSolver',
    'requireCaptchaSolver',
    'requireProxyUsage',
    'requireBrowser',
    'requireStatusOk',
    'requireResultStatusOk',
    'resultStatusFields',
    'resultFailValues',
    'lightpandaDomain',
    'chromeWs',
    'chromeHttp',
  ]);
  return Object.fromEntries(
    Object.entries(profile)
      .filter(([key, value]) => allowed.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, normalizeVerifyRunDefault(key, value)]),
  );
}

function normalizeVerifyRunDefault(key, value) {
  if (!Array.isArray(value)) {
    return value;
  }
  if (['resultStatusFields', 'resultFailValues'].includes(key)) {
    return value.map((item, index) => {
      if (typeof item !== 'string') {
        throw new CliError(`Verify compare profile run default "${key}" item ${index} must be a string.`);
      }
      return item.trim();
    }).filter(Boolean).join(',');
  }
  throw new CliError(`Verify compare profile run default "${key}" does not accept an array.`);
}

function definedOptions(options) {
  return Object.fromEntries(Object.entries(options).filter(([_key, value]) => value !== undefined && value !== null));
}

export function stageVerifyProject(projectDir, options = {}) {
  if (options.staging === false) {
    return {
      projectDir,
      staged: false,
      manifest: null,
    };
  }

  const stageRoot = path.join(projectDir, '.coreclaw', 'staging');
  fs.mkdirSync(stageRoot, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(stageRoot, 'coreclaw-verify-stage-'));
  const manifest = copyWorkerFiles(projectDir, stageDir);
  if (options.language === 'go') {
    return stageGoVerifyRuntime({ sourceStageDir: stageDir, stageRoot, manifest, options });
  }
  if (options.language === 'python' && options.install !== false) {
    const venv = createPythonVerifyVenv(stageDir, options);
    return {
      projectDir: stageDir,
      staged: true,
      manifest,
      stageRoot,
      install: options.install,
      python: venv.python,
    };
  }
  return {
    projectDir: stageDir,
    staged: true,
    manifest,
    stageRoot,
    install: options.install,
  };
}

function stageGoVerifyRuntime({ sourceStageDir, stageRoot, manifest, options }) {
  buildGoUploadBinary(sourceStageDir, options);
  const runtimeDir = fs.mkdtempSync(path.join(stageRoot, 'coreclaw-verify-go-runtime-'));
  copyIfExists(path.join(sourceStageDir, 'main'), path.join(runtimeDir, 'main'));
  buildGoRuntimeBinary(sourceStageDir, runtimeDir, options);
  copyIfExists(path.join(sourceStageDir, 'input_schema.json'), path.join(runtimeDir, 'input_schema.json'));
  copyIfExists(path.join(sourceStageDir, 'output_schema.json'), path.join(runtimeDir, 'output_schema.json'));
  return {
    projectDir: runtimeDir,
    staged: true,
    manifest: Array.from(new Set([...manifest, 'main'])).sort(),
    stageRoot,
    cleanupExtraDirs: [sourceStageDir],
    validationProjectDir: sourceStageDir,
    runtimeLanguage: 'go',
    install: false,
  };
}

export function buildVerifyRunOptions(options = {}) {
  const runOptions = {
    ...options,
    python: options.python ?? 'python',
    node: options.node ?? 'node',
    go: options.go ?? 'go',
    minResults: options.minResults ?? '1',
    install: options.install ?? true,
    requireStatusOk: options.requireStatusOk ?? true,
  };
  if (options.strict) {
    runOptions.requireTableHeader = options.requireTableHeader ?? true;
    runOptions.requireOutputSchemaMatch = options.requireOutputSchemaMatch ?? true;
  }
  return runOptions;
}

export function createPythonVerifyVenv(projectDir, options = {}) {
  const venvDir = path.join(projectDir, '.coreclaw-python-venv');
  const [pythonCommand, pythonArgs] = splitCommandLine(options.python ?? 'python', '--python');
  const spawnSyncImpl = typeof options.spawnSyncImpl === 'function' ? options.spawnSyncImpl : spawnSync;
  const result = spawnSyncImpl(pythonCommand, [...pythonArgs, '-m', 'venv', venvDir], {
    cwd: projectDir,
    env: process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new CliError(`Python verify virtualenv failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new CliError(`Python verify virtualenv failed with exit code ${result.status}.${output ? `\n${output}` : ''}`);
  }

  return {
    venvDir,
    python: pythonExecutableInVenv(venvDir),
  };
}

function pythonExecutableInVenv(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

export function buildVerifyCompareOptions(options = {}, output, projectDir = null) {
  const strictGate = options.strict ? true : undefined;
  return {
    keyFields: options.keyFields,
    minShared: options.minShared,
    maxDiff: options.maxDiff,
    maxOnlyLocal: options.maxOnlyLocal,
    maxOnlyCloud: options.maxOnlyCloud,
    compareProfile: options.compareProfile,
    requireStatusOk: options.requireStatusOk ?? true,
    requireResultStatusOk: options.requireResultStatusOk,
    resultStatusFields: options.resultStatusFields,
    resultFailValues: options.resultFailValues,
    requireOutputSchemaMatch: options.requireOutputSchemaMatch ?? strictGate,
    outputSchema: resolveVerifyCompareOutputSchema(options, projectDir),
    ignoreFields: options.ignoreFields,
    ignoreKeys: options.ignoreKeys,
    ignoreKeysFile: options.ignoreKeysFile,
    requireUniqueKeys: options.requireUniqueKeys,
    output,
  };
}

export function buildVerifyPackOptions(projectDir, options = {}) {
  return {
    output: resolveVerifyOutput(projectDir, options),
    validate: true,
    go: options.go,
    strict: options.strict,
  };
}

function resolveVerifyCompareOutputSchema(options, projectDir) {
  if (options.outputSchema) {
    return options.outputSchema;
  }
  if (options.compareProfile) {
    return undefined;
  }
  return defaultCompareOutputSchema(projectDir);
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

function defaultCompareOutputSchema(projectDir) {
  if (!projectDir) {
    return undefined;
  }
  const schemaPath = path.join(projectDir, 'output_schema.json');
  return fs.existsSync(schemaPath) ? schemaPath : undefined;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toCamel(value) {
  return value.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function cleanupVerifyStage(stagedProject) {
  if (stagedProject?.staged) {
    for (const dir of stagedProject.cleanupExtraDirs ?? []) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.rmSync(stagedProject.projectDir, { recursive: true, force: true });
    if (stagedProject.stageRoot) {
      try {
        fs.rmdirSync(stagedProject.stageRoot);
      } catch {
        // Keep the staging root when another process or artifact is still using it.
      }
    }
  }
}

function copyIfExists(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
