import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { validateInputSchema, validateOutputSchema } from './schema.js';

export const LANGUAGE_SPECS = {
  python: {
    label: 'Python',
    entry: 'main.py',
    dependencyFile: 'requirements.txt',
    required: ['main.py', 'requirements.txt', 'input_schema.json', 'sdk.py', 'sdk_pb2.py', 'sdk_pb2_grpc.py'],
    runtimeDependencies: ['grpcio', 'protobuf'],
  },
  node: {
    label: 'Node.js',
    entry: 'main.js',
    dependencyFile: 'package.json',
    required: ['main.js', 'package.json', 'input_schema.json', 'sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js'],
    runtimeDependencies: ['@grpc/grpc-js', 'google-protobuf'],
  },
  go: {
    label: 'Go',
    entry: 'main.go',
    dependencyFile: 'go.mod',
    required: ['main.go', 'go.mod', 'go.sum', 'input_schema.json', 'GoSdk/sdk.go', 'GoSdk/sdk.pb.go', 'GoSdk/sdk_grpc.pb.go'],
    runtimeDependencies: ['google.golang.org/grpc', 'google.golang.org/protobuf'],
  },
};

export function detectProject(projectDir) {
  const matches = Object.entries(LANGUAGE_SPECS)
    .filter(([, spec]) => fs.existsSync(path.join(projectDir, spec.entry)))
    .map(([language]) => language);

  if (matches.length === 0) {
    throw new CliError(`No CoreClaw entry file found in ${projectDir}. Expected one of main.py, main.js, or main.go.`);
  }

  if (matches.length > 1) {
    throw new CliError(`Multiple CoreClaw entry files found (${matches.join(', ')}). Keep one language entry at the project root.`);
  }

  const language = matches[0];
  return {
    projectDir,
    language,
    spec: LANGUAGE_SPECS[language],
  };
}

export function validateProject(projectDir, options = {}) {
  const project = detectProject(projectDir);
  const issues = [];

  for (const requiredFile of project.spec.required) {
    if (!fs.existsSync(path.join(projectDir, requiredFile))) {
      issues.push({
        severity: 'error',
        code: 'missing_required_file',
        message: `Missing required ${project.spec.label} worker file: ${requiredFile}`,
      });
    }
  }

  if (!fs.existsSync(path.join(projectDir, 'README.md'))) {
    issues.push({
      severity: 'warn',
      code: 'missing_readme',
      message: 'Missing README.md. CoreClaw project structure documents README.md as an upload-ready worker file for user-facing usage notes.',
    });
  }

  const inputPath = path.join(projectDir, 'input_schema.json');
  const outputPath = path.join(projectDir, 'output_schema.json');

  if (fs.existsSync(inputPath)) {
    issues.push(...validateInputSchema(readJson(inputPath), inputPath));
  }

  issues.push(...validatePackageCompatibility(project));
  issues.push(...validateRuntimeDependencies(project));

  if (fs.existsSync(outputPath)) {
    issues.push(...validateOutputSchema(readJson(outputPath), outputPath));
  } else {
    issues.push({
      severity: 'warn',
      code: 'missing_output_schema_legacy',
      message: 'Missing output_schema.json. CoreClaw currently accepts legacy workers without it, but new workers should include it for stable table export and upload-time compatibility.',
    });
  }

  if (options.tableHeaders && fs.existsSync(outputPath)) {
    issues.push(...validateRuntimeHeaders(readJson(outputPath), options.tableHeaders));
  }

  return {
    ...project,
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  };
}

function validatePackageCompatibility(project) {
  if (project.language !== 'node') {
    return [];
  }

  const packagePath = path.join(project.projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return [];
  }

  const manifest = readJson(packagePath);
  const issues = [];
  if (manifest.main !== undefined && manifest.main !== 'main.js') {
    issues.push({
      severity: 'warn',
      code: 'node_package_main_not_main_js',
      message: `package.json main is "${manifest.main}", but CoreClaw Node workers document "main.js" as the entry file.`,
    });
  }
  if (manifest.type !== undefined && manifest.type !== 'commonjs') {
    issues.push({
      severity: 'warn',
      code: 'node_package_type_not_commonjs',
      message: `package.json type is "${manifest.type}", but CoreClaw's Node SDK uses CommonJS require() and documents "type": "commonjs".`,
    });
  }
  return issues;
}

function validateRuntimeDependencies(project) {
  const filePath = path.join(project.projectDir, project.spec.dependencyFile);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const declared = readDeclaredDependencies(project.language, filePath);
  return project.spec.runtimeDependencies
    .filter((name) => !declared.has(name))
    .map((name) => ({
      severity: 'error',
      code: 'missing_runtime_dependency',
      message: `Missing SDK runtime dependency "${name}" in ${project.spec.dependencyFile}. CoreClaw installs dependencies from this file after upload, so local runs can pass while cloud runs fail if it is omitted.`,
    }));
}

function readDeclaredDependencies(language, filePath) {
  if (language === 'node') {
    const manifest = readJson(filePath);
    return new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
  }

  const text = fs.readFileSync(filePath, 'utf8');
  if (language === 'python') {
    return new Set(text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/[<>=!~;\s[]/, 1)[0].toLowerCase()));
  }

  if (language === 'go') {
    const matches = text.matchAll(/(?:^|\s)([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\s+v[0-9]/gm);
    return new Set(Array.from(matches, (match) => match[1]));
  }

  return new Set();
}

export function readJson(filePath) {
  try {
    return JSON.parse(stripJsonBom(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export function formatIssues(issues) {
  if (issues.length === 0) {
    return 'No validation issues found.';
  }

  return issues.map((issue) => {
    const marker = issue.severity === 'error' ? 'ERROR' : 'WARN';
    return `[${marker}] ${issue.message}`;
  }).join('\n');
}

function validateRuntimeHeaders(outputSchema, tableHeaders) {
  const issues = [];
  const outputNames = new Set(Array.isArray(outputSchema) ? outputSchema.map((column) => column.name) : []);

  for (const header of tableHeaders) {
    if (header?.key && !outputNames.has(header.key)) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_not_in_output_schema',
        message: `Runtime table header "${header.key}" is not declared in output_schema.json.`,
      });
    }
  }

  return issues;
}

function stripJsonBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
