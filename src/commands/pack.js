import path from 'node:path';
import { resolveProjectPath } from '../utils/paths.js';
import { validateProject, formatIssues } from '../validation/project.js';
import { CliError } from '../utils/errors.js';
import { createWorkerZip } from '../pack/zip.js';
import { prepareUploadProject } from '../pack/upload-project.js';
import { enforcePackageGates, inspectPackage, validatePackageReport } from './inspect-package.js';
import { enforceStrictValidation } from './validate.js';

export async function packCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const result = validateProject(projectDir);

  if (!result.ok && options.validate !== false) {
    console.error(formatIssues(result.issues));
    throw new CliError('Package validation failed.');
  }
  if (options.validate !== false) {
    enforceStrictValidation(result, options, 'Package validation');
  }

  const defaultName = `${path.basename(projectDir)}.zip`;
  const outFile = path.resolve(process.cwd(), options.output ?? path.join(projectDir, 'dist', defaultName));
  const uploadProject = prepareUploadProject(result, options);
  try {
    if (uploadProject.staged && result.language === 'go') {
      console.log('Built Go upload binary: main (CGO_ENABLED=0 GOOS=linux GOARCH=amd64)');
    }
    createWorkerZip({ projectDir: uploadProject.projectDir, outFile });
  } finally {
    uploadProject.cleanup();
  }
  inspectCreatedPackage(outFile, result.language, options);
  console.log(`Created CoreClaw upload ZIP: ${outFile}`);
  return outFile;
}

function inspectCreatedPackage(outFile, language, options = {}) {
  const report = inspectPackage(outFile);
  const validation = validatePackageReport(report, { language });
  const packageReport = { ...report, ...validation };
  try {
    enforcePackageGates(packageReport, options);
  } catch (error) {
    const errors = validation.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `[ERROR] ${issue.message}`)
      .join('\n');
    if (errors) {
      throw new CliError(`Created upload ZIP failed package inspection.\n${errors}`);
    }
    throw error;
  }
  const warnings = validation.issues.filter((issue) => issue.severity === 'warn');
  for (const warning of warnings) {
    console.warn(`[WARN] ${warning.message}`);
  }
}
