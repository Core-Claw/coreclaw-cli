import fs from 'node:fs';
import path from 'node:path';
import { createCoreClawClient, resolveApiKey } from '../cloud/client.js';
import { CliError } from '../utils/errors.js';
import { printJson, shouldPrintJson } from '../utils/output.js';

const TERMINAL_STATUSES = new Set([3, 4, 5]);

export function createClientFromOptions(options = {}) {
  return createCoreClawClient({
    apiKey: resolveApiKey(options),
    apiBaseUrl: options.apiBaseUrl,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}

export function printOrReturn(response, options = {}) {
  if (shouldPrintJson(options)) {
    printJson(response);
  }
  return response;
}

export function requireSubcommand(positionals, commandName, allowed) {
  const subcommand = positionals[0];
  if (!subcommand || !allowed.includes(subcommand)) {
    throw new CliError(`coreclaw ${commandName} requires a subcommand: ${allowed.join(', ')}.`);
  }
  return subcommand;
}

export function requireArg(value, message) {
  if (!value) {
    throw new CliError(message);
  }
  return value;
}

export function readInputJson(filePath, flagName = '--input') {
  if (!filePath) {
    throw new CliError(`${flagName} is required.`);
  }
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(stripBom(fs.readFileSync(resolved, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${resolved}: ${error.message}`);
  }
}

export function writeJsonOutput(filePath, value) {
  if (!filePath) {
    return null;
  }
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return resolved;
}

export function writeBinaryOutput(filePath, value) {
  if (!filePath) {
    return null;
  }
  const resolved = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, value);
  return resolved;
}

export function parsePositiveInteger(value, defaultValue, flagName) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 1) {
    throw new CliError(`${flagName} must be a positive integer.`);
  }
  return number;
}

export function parseNonNegativeInteger(value, defaultValue, flagName) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 0) {
    throw new CliError(`${flagName} must be a non-negative integer.`);
  }
  return number;
}

export function parseCommaList(value) {
  if (!value) {
    return [];
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function statusLabel(status) {
  return {
    0: 'All',
    1: 'Ready',
    2: 'Running',
    3: 'Succeeded',
    4: 'Failed',
    5: 'Aborted',
  }[Number(status)] ?? String(status ?? 'unknown');
}

export async function pollRunUntilTerminal(client, runSlug, {
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 5000,
  sleepImpl = sleep,
  nowImpl = Date.now,
} = {}) {
  const started = nowImpl();
  let detail = null;
  while (true) {
    const response = await client.runDetail(runSlug);
    detail = response.data ?? {};
    if (TERMINAL_STATUSES.has(Number(detail.status))) {
      return detail;
    }
    if (nowImpl() - started >= timeoutMs) {
      throw new CliError(`Timed out waiting for CoreClaw run ${runSlug}. Last status: ${detail.status ?? 'unknown'}.`);
    }
    await sleepImpl(pollIntervalMs);
  }
}

export function parseDurationMs(value, flagName) {
  if (typeof value === 'number') {
    return value;
  }
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new CliError(`${flagName} must be a duration like 500ms, 5s, 10m, or 1h.`);
  }
  const number = Number.parseInt(match[1], 10);
  const unit = match[2] ?? 'ms';
  return number * {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  }[unit];
}

export function formatTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return '-';
  }
  const millis = number > 10_000_000_000 ? number : number * 1000;
  return new Date(millis).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
