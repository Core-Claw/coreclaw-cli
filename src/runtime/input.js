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

    const value = input[property.name];
    if (property.required === true && isEmptyInputValue(value)) {
      issues.push(`required field "${property.name}" is missing or empty`);
      continue;
    }

    if (!inputValueMatchesType(value, property.type)) {
      issues.push(`field "${property.name}" must be ${inputTypeLabel(property.type)}`);
      continue;
    }

    issues.push(...inputEditorIssues(property, value));
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
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
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
  if (normalized === 'number') {
    return 'a number';
  }
  if (normalized === 'array' || normalized === 'object') {
    return `an ${normalized}`;
  }
  return `a ${normalized}`;
}

function normalizeInputType(type) {
  if (type === 'number') {
    return 'number';
  }
  return type;
}

function inputEditorIssues(property, value) {
  if (property.editor === 'requestList') {
    return requestListIssues(property.name, value);
  }
  if (property.editor === 'requestListSource') {
    return requestListSourceIssues(property, value);
  }
  if (property.editor === 'stringList') {
    return stringListIssues(property.name, value);
  }
  if (property.editor === 'select' || property.editor === 'radio' || property.editor === 'checkbox') {
    return optionValueIssues(property, value);
  }
  return [];
}

function requestListIssues(name, value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [`field "${name}[${index}]" must be an object with a "url" field`];
    }
    if (typeof item.url !== 'string' || item.url.length === 0) {
      return [`field "${name}[${index}].url" must be a non-empty string`];
    }
    return [];
  });
}

function requestListSourceIssues(property, value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    const itemName = `${property.name}[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [`field "${itemName}" must be an object`];
    }
    if (!Array.isArray(property.param_list)) {
      return [];
    }
    return property.param_list.flatMap((param) => requestListSourceParamIssues(itemName, item, param));
  });
}

function requestListSourceParamIssues(itemName, item, param) {
  const name = param?.param ?? param?.name;
  if (!name || typeof name !== 'string') {
    return [];
  }

  if (!Object.prototype.hasOwnProperty.call(item, name)) {
    if (param.required === true) {
      return [`required field "${itemName}.${name}" is missing or empty`];
    }
    return [];
  }

  const value = item[name];
  if (param.required === true && isEmptyInputValue(value)) {
    return [`required field "${itemName}.${name}" is missing or empty`];
  }
  if (!inputValueMatchesType(value, param.type)) {
    return [`field "${itemName}.${name}" must be ${inputTypeLabel(param.type)}`];
  }
  if (param.editor === 'select' || param.editor === 'radio' || param.editor === 'checkbox') {
    return optionValueIssues(param, value, `${itemName}.${name}`);
  }
  return [];
}

function stringListIssues(name, value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [`field "${name}[${index}]" must be an object with a "string" field`];
    }
    if (typeof item.string !== 'string' || item.string.length === 0) {
      return [`field "${name}[${index}].string" must be a non-empty string`];
    }
    return [];
  });
}

function optionValueIssues(property, value, displayName = property.name) {
  if (!Array.isArray(property.options) || property.options.length === 0) {
    return [];
  }
  const allowed = new Set(property.options
    .filter((option) => option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value'))
    .map((option) => comparableValue(option.value)));
  if (allowed.size === 0) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((item) => !allowed.has(comparableValue(item)))
    .map((item) => `field "${displayName}" value ${formatInputValue(item)} is not declared in input_schema options`);
}

function comparableValue(value) {
  if (value && typeof value === 'object') {
    return stableJson(value);
  }
  return `${typeof value}:${String(value)}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function formatInputValue(value) {
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
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
