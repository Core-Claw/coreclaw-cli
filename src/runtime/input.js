import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { readJson } from '../validation/project.js';
import { inferInputType } from '../validation/schema.js';

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
  const splitFields = new Set(activeSchemaSplitFields(schema));
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

    const propertyType = inferInputType(property);
    if (!inputValueMatchesType(value, propertyType, property)) {
      issues.push(`field "${property.name}" must be ${inputTypeLabel(propertyType, property)}`);
      continue;
    }

    issues.push(...inputNumericBoundIssues(property.name, property, value));
    if (!splitFields.has(property.name)) {
      issues.push(...inputEditorIssues(property, value));
    }
  }
  return issues;
}

export function expandSplitInput(input, schema, splitIndex) {
  const concurrencyFields = normalizedConcurrencyFields(schema);
  if (concurrencyFields.length > 0) {
    return expandConcurrencyInput(input, schema, splitIndex, concurrencyFields);
  }

  const splitKey = normalizedLegacySplitKey(schema);
  if (!splitKey) {
    throw new CliError('--split requires input_schema.json with concurrency.fields or root field "b".');
  }

  if (!Object.prototype.hasOwnProperty.call(input ?? {}, splitKey)) {
    throw new CliError(`missing concurrency field [${splitKey}]`);
  }
  const items = meaningfulConcurrencyItems(input?.[splitKey], splitKey);
  if (items.length === 0) {
    throw new CliError(`concurrency field [${splitKey}] is empty`);
  }

  const index = Number.parseInt(splitIndex, 10);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new CliError(`--split index ${splitIndex} is out of range for input["${splitKey}"] non-empty length ${items.length}.`);
  }

  const item = items[index];
  const expanded = { ...input };
  delete expanded[splitKey];

  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return { ...expanded, ...item };
  }

  return { ...expanded, [splitKey]: [item] };
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

function inputValueMatchesType(value, type, schemaItem = null) {
  if (isMultipleSelect(schemaItem)) {
    return Array.isArray(value);
  }
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

function inputTypeLabel(type, schemaItem = null) {
  if (isMultipleSelect(schemaItem)) {
    return 'an array';
  }
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

function isMultipleSelect(schemaItem) {
  return schemaItem?.editor === 'select' && schemaItem.multiple === true;
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

function expandConcurrencyInput(input, schema, splitIndex, fields) {
  const removeFields = normalizedConcurrencyRemoveFields(schema);
  const removeFieldSet = new Set(removeFields);
  const preferredFields = fields.filter((field) => !removeFieldSet.has(field));
  const preferredHasValues = preferredFields.length > 0
    && preferredFields.some((field) => meaningfulConcurrencyItems(input?.[field], field).length > 0);
  const activeFields = preferredHasValues ? preferredFields : fields;
  const removedFields = preferredHasValues ? removeFieldSet : new Set();
  const chunks = [];

  for (const field of activeFields) {
    const items = meaningfulConcurrencyItems(input?.[field], field);
    for (const item of items) {
      chunks.push({ field, item });
    }
  }

  if (chunks.length === 0) {
    throw new CliError('concurrency fields have no non-empty fields');
  }

  const index = Number.parseInt(splitIndex, 10);
  if (!Number.isInteger(index) || index < 0 || index >= chunks.length) {
    throw new CliError(`--split index ${splitIndex} is out of range for concurrency fields length ${chunks.length}.`);
  }

  const selected = chunks[index];
  const expanded = { ...input };
  for (const field of fields) {
    if (removedFields.has(field)) {
      delete expanded[field];
    } else {
      expanded[field] = [''];
    }
  }

  if (selected.item && typeof selected.item === 'object' && !Array.isArray(selected.item)) {
    delete expanded[selected.field];
    return { ...expanded, ...selected.item };
  }

  expanded[selected.field] = [selected.item];
  return expanded;
}

function meaningfulConcurrencyItems(value, fieldName) {
  if (value === undefined) {
    return [];
  }
  // Platform-verified (2026-07-14): a non-array concurrency field value is
  // treated as "no value" and skipped (the field does not participate in
  // splitting); it does NOT hard-error. Mirror that here so local --split
  // matches cloud behavior.
  if (!Array.isArray(value)) {
    return [];
  }

  let sawObject = false;
  let sawPrimitive = false;
  const items = [];

  value.forEach((item, index) => {
    if (Array.isArray(item)) {
      throw new CliError(`item at index ${index} in [${fieldName}] must be an object or primitive value`);
    }
    if (item && typeof item === 'object') {
      if (Object.prototype.hasOwnProperty.call(item, fieldName)) {
        throw new CliError(`item at index ${index} in [${fieldName}] must not override concurrency field`);
      }
      sawObject = true;
    } else if (item !== null) {
      sawPrimitive = true;
    }
    if (sawObject && sawPrimitive) {
      throw new CliError(`field [${fieldName}] must not mix object and primitive items`);
    }
    if (!isEmptyConcurrencyItem(item)) {
      items.push(item);
    }
  });

  return items;
}

function isEmptyConcurrencyItem(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    const values = Object.values(value);
    return values.length === 0 || values.every(isEmptyConcurrencyItem);
  }
  return false;
}

function activeSchemaSplitFields(schema) {
  const concurrencyFields = normalizedConcurrencyFields(schema);
  if (concurrencyFields.length > 0) {
    return concurrencyFields;
  }
  const legacyField = normalizedLegacySplitKey(schema);
  return legacyField ? [legacyField] : [];
}

function normalizedConcurrencyFields(schema) {
  return normalizeStringList(schema?.concurrency?.fields);
}

function normalizedConcurrencyRemoveFields(schema) {
  return normalizeStringList(schema?.concurrency?.remove_fields);
}

function normalizedLegacySplitKey(schema) {
  return typeof schema?.b === 'string' ? schema.b.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
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
  const paramType = inferInputType(param);
  if (!inputValueMatchesType(value, paramType, param)) {
    return [`field "${itemName}.${name}" must be ${inputTypeLabel(paramType, param)}`];
  }
  const boundIssues = inputNumericBoundIssues(`${itemName}.${name}`, param, value);
  if (boundIssues.length > 0) {
    return boundIssues;
  }
  if (param.editor === 'select' || param.editor === 'radio' || param.editor === 'checkbox') {
    return optionValueIssues(param, value, `${itemName}.${name}`);
  }
  return [];
}

function inputNumericBoundIssues(name, schemaItem, value) {
  if (!isNumericSchemaItem(schemaItem) || typeof value !== 'number' || !Number.isFinite(value)) {
    return [];
  }

  const issues = [];
  if (isFiniteNumber(schemaItem.minimum) && value < schemaItem.minimum) {
    issues.push(`field "${name}" must be >= ${schemaItem.minimum}`);
  }
  if (isFiniteNumber(schemaItem.maximum) && value > schemaItem.maximum) {
    issues.push(`field "${name}" must be <= ${schemaItem.maximum}`);
  }
  return issues;
}

function isNumericSchemaItem(schemaItem) {
  const type = normalizeInputType(inferInputType(schemaItem));
  return type === 'integer' || type === 'number' || schemaItem?.editor === 'number';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
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
