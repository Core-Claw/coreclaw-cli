import { CliError } from './errors.js';

const SIZE_UNITS = {
  b: 1,
  kb: 1000,
  k: 1000,
  mb: 1000 ** 2,
  m: 1000 ** 2,
  gb: 1000 ** 3,
  g: 1000 ** 3,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
};

export function parseSizeBytes(value, optionName = '--size') {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  const text = String(value).trim();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
  if (!match) {
    throw new CliError(`Invalid ${optionName} value "${value}". Use bytes or a size suffix such as 25MB, 50MiB, or 1GB.`);
  }

  const amount = Number.parseFloat(match[1]);
  const unitText = match[2] || 'b';
  const multiplier = SIZE_UNITS[unitText.toLowerCase()];
  if (!multiplier) {
    throw new CliError(`Invalid ${optionName} unit "${unitText}". Use B, KB, MB, GB, KiB, MiB, or GiB.`);
  }
  return Math.floor(amount * multiplier);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown size';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
