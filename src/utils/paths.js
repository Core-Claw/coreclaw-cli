import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(srcDir, '..', '..');

export function resolveProjectPath(value = '.') {
  return path.resolve(process.cwd(), value);
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
