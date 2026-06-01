import path from 'node:path';
import { resolveProjectPath } from '../utils/paths.js';
import { validateProject, formatIssues } from '../validation/project.js';
import { CliError } from '../utils/errors.js';
import { createWorkerZip } from '../pack/zip.js';
import { prepareUploadProject } from '../pack/upload-project.js';

export async function packCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const result = validateProject(projectDir);

  if (!result.ok && options.validate !== false) {
    console.error(formatIssues(result.issues));
    throw new CliError('Package validation failed.');
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
  console.log(`Created CoreClaw upload ZIP: ${outFile}`);
  return outFile;
}
