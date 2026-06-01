const SUPPORTED_TYPES = new Set(['string', 'integer', 'boolean', 'array', 'object']);
const LEGACY_COMPAT_TYPES = new Map([
  ['number', 'integer'],
]);
const SUPPORTED_EDITORS = new Set([
  'input',
  'textarea',
  'number',
  'select',
  'radio',
  'checkbox',
  'switch',
  'datepicker',
  'requestList',
  'requestListSource',
  'stringList',
]);

export function validateInputSchema(schema, filePath = 'input_schema.json') {
  const issues = [];

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [error(`${filePath} must be a JSON object.`)];
  }

  if (!schema.b || typeof schema.b !== 'string') {
    issues.push(error('input_schema.json must define root field "b" as the task splitting key.'));
  }

  if (!Array.isArray(schema.properties)) {
    issues.push(error('input_schema.json must define "properties" as an array.'));
    return issues;
  }

  const names = new Set();
  let splitProperty = null;

  for (const [index, property] of schema.properties.entries()) {
    const prefix = `input_schema.properties[${index}]`;
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      issues.push(error(`${prefix} must be an object.`));
      continue;
    }

    if (!property.name || typeof property.name !== 'string') {
      issues.push(error(`${prefix}.name is required and must be a string.`));
    } else {
      if (/[^\w.-]/.test(property.name)) {
        issues.push(error(`${prefix}.name "${property.name}" contains unsupported characters. Use ASCII letters, numbers, underscore, dash, or dot.`));
      }
      if (names.has(property.name)) {
        issues.push(error(`${prefix}.name "${property.name}" is duplicated.`));
      }
      names.add(property.name);
      if (property.name === schema.b) {
        splitProperty = property;
      }
    }

    if (!SUPPORTED_TYPES.has(property.type)) {
      if (LEGACY_COMPAT_TYPES.has(property.type)) {
        issues.push(warn(`${prefix}.type "${property.type}" is accepted as a legacy compatibility alias for "${LEGACY_COMPAT_TYPES.get(property.type)}"; prefer documented CoreClaw type "${LEGACY_COMPAT_TYPES.get(property.type)}".`));
      } else {
        issues.push(error(`${prefix}.type "${property.type}" is not supported. Use ${[...SUPPORTED_TYPES].join(', ')}.`));
      }
    }

    if (property.editor && !SUPPORTED_EDITORS.has(property.editor)) {
      issues.push(warn(`${prefix}.editor "${property.editor}" is not documented by CoreClaw. Verify platform rendering before upload.`));
    }

    if (property.required === true && property.default === undefined) {
      issues.push(warn(`${prefix} is required but has no default. Local default runs will need --input or --json.`));
    }
  }

  if (schema.b && !splitProperty) {
    issues.push(error(`input_schema.json b="${schema.b}" does not match any property name.`));
  } else if (splitProperty && splitProperty.type !== 'array') {
    issues.push(error(`input_schema.json b="${schema.b}" must point to a property with type "array".`));
  }

  return issues;
}

export function validateOutputSchema(schema, filePath = 'output_schema.json') {
  if (!Array.isArray(schema)) {
    return [error(`${filePath} must be a JSON array.`)];
  }

  const issues = [];
  const names = new Set();

  for (const [index, column] of schema.entries()) {
    const prefix = `output_schema[${index}]`;
    if (!column || typeof column !== 'object' || Array.isArray(column)) {
      issues.push(error(`${prefix} must be an object.`));
      continue;
    }

    if (!column.name || typeof column.name !== 'string') {
      issues.push(error(`${prefix}.name is required and must be a string.`));
    } else {
      if (names.has(column.name)) {
        issues.push(error(`${prefix}.name "${column.name}" is duplicated.`));
      }
      names.add(column.name);
    }

    if (!SUPPORTED_TYPES.has(column.type)) {
      if (LEGACY_COMPAT_TYPES.has(column.type)) {
        issues.push(warn(`${prefix}.type "${column.type}" is accepted as a legacy compatibility alias for "${LEGACY_COMPAT_TYPES.get(column.type)}"; prefer documented CoreClaw type "${LEGACY_COMPAT_TYPES.get(column.type)}".`));
      } else {
        issues.push(error(`${prefix}.type "${column.type}" is not supported. Use ${[...SUPPORTED_TYPES].join(', ')}.`));
      }
    }
  }

  return issues;
}

function error(message) {
  return { severity: 'error', message };
}

function warn(message) {
  return { severity: 'warn', message };
}
