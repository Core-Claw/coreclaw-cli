import { CliError } from '../utils/errors.js';
import { resolveProjectPath } from '../utils/paths.js';
import { formatIssues, validateProject } from '../validation/project.js';

export async function validateCommand(projectPath = '.', options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const result = validateProject(projectDir);

  console.log(`CoreClaw worker: ${projectDir}`);
  console.log(`Language: ${result.spec.label}`);
  console.log(formatIssues(result.issues));

  if (!result.ok && !options.soft) {
    throw new CliError('Validation failed.');
  }

  return result;
}
