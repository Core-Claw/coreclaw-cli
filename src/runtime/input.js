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

  validateInputAgainstSchema(input, inputSchema);

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

export function validateInputAgainstSchema(input, schema) {
  const issues = inputSchemaInputIssues(input, schema);
  if (issues.length > 0) {
    throw new CliError(`Input does not satisfy input_schema.json: ${issues.join('; ')}. Pass --input or --json with the required values.`);
  }
  return input;
}

export function inputSchemaInputIssues(input, schema) {
  if (!schema || !Array.isArray(schema.properties)) {
    return [];
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return ['run input must be a JSON object'];
  }

  const issues = [];
  for (const property of schema.properties) {
    if (!property || typeof property.name !== 'string') {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(input, property.name)) {
      if (property.required === true) {
        issues.push(`required field "${property.name}" is missing or empty`);
      }
      continue;
    }

    if (property.required === true && isEmptyInputValue(input[property.name])) {
      issues.push(`required field "${property.name}" is missing or empty`);
      continue;
    }

    if (!inputValueMatchesType(input[property.name], property.type)) {
      issues.push(`field "${property.name}" must be ${inputTypeLabel(property.type)}`);
    }
  }
  return issues;
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

function isEmptyInputValue(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}

function inputValueMatchesType(value, type) {
  switch (normalizeInputType(type)) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

function inputTypeLabel(type) {
  const normalized = normalizeInputType(type);
  if (normalized === 'integer') {
    return 'an integer';
  }
  if (normalized === 'array' || normalized === 'object') {
    return `an ${normalized}`;
  }
  return `a ${normalized}`;
}

function normalizeInputType(type) {
  if (type === 'number') {
    return 'integer';
  }
  return type;
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
