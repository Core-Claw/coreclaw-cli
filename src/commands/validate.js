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
  enforceStrictValidation(result, options, 'Validation');

  return result;
}

export function enforceStrictValidation(result, options = {}, label = 'Validation') {
  if (!options.strict || options.soft) {
    return;
  }
  const warnings = result.issues.filter((issue) => issue.severity === 'warn');
  if (warnings.length > 0) {
    const codes = [...new Set(warnings.map((issue) => issue.code).filter(Boolean))].sort();
    const suffix = codes.length > 0 ? ` Issue codes: ${codes.join(', ')}.` : '';
    throw new CliError(`${label} found ${warnings.length} warning(s) and --strict is enabled.${suffix}`);
  }
}
