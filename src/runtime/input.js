import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { readJson } from '../validation/project.js';

export function buildInput({ projectDir, inputPath, inlineJson, useDefaults = true, splitIndex = null }) {
  let input;

  if (inputPath) {
    const resolved = path.resolve(process.cwd(), inputPath);
    input = readJson(resolved);
  } else if (inlineJson) {
    try {
      input = JSON.parse(inlineJson);
    } catch (error) {
      throw new CliError(`--json is not valid JSON: ${error.message}`);
    }
  } else if (useDefaults) {
    input = defaultsFromInputSchema(readJson(path.join(projectDir, 'input_schema.json')));
  } else {
    input = {};
  }

  const inputSchema = fs.existsSync(path.join(projectDir, 'input_schema.json'))
    ? readJson(path.join(projectDir, 'input_schema.json'))
    : null;

  if (splitIndex !== null) {
    input = expandSplitInput(input, inputSchema, splitIndex);
  }

  return input;
}

export function defaultsFromInputSchema(schema) {
  const result = {};
  for (const property of schema.properties ?? []) {
    if (Object.prototype.hasOwnProperty.call(property, 'default')) {
      result[property.name] = clone(property.default);
    }
  }
  return result;
}

export function expandSplitInput(input, schema, splitIndex) {
  if (!schema?.b) {
    throw new CliError('--split requires input_schema.json with root field "b".');
  }

  const splitKey = schema.b;
  const list = input?.[splitKey];
  if (!Array.isArray(list)) {
    throw new CliError(`--split requires input["${splitKey}"] to be an array.`);
  }

  const index = Number.parseInt(splitIndex, 10);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new CliError(`--split index ${splitIndex} is out of range for input["${splitKey}"] length ${list.length}.`);
  }

  const item = list[index];
  const expanded = { ...input };
  delete expanded[splitKey];

  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return { ...expanded, ...item };
  }

  return { ...expanded, [singularize(splitKey)]: item };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function singularize(key) {
  if (key.endsWith('ies')) {
    return `${key.slice(0, -3)}y`;
  }
  if (key.endsWith('s')) {
    return key.slice(0, -1);
  }
  return 'item';
}
