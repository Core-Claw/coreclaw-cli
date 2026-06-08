const SUPPORTED_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array', 'object']);
const LEGACY_COMPAT_TYPES = new Map([]);
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
const EDITOR_EXPECTED_TYPES = new Map([
  ['number', ['integer', 'number']],
  ['switch', ['boolean']],
  ['checkbox', ['array']],
  ['requestList', ['array']],
  ['requestListSource', ['array']],
  ['stringList', ['array']],
]);
const SELECTOR_EDITORS = new Set(['select', 'radio', 'checkbox']);

export function validateInputSchema(schema, filePath = 'input_schema.json') {
  const issues = [];

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [error(`${filePath} must be a JSON object.`, 'input_schema_root_invalid')];
  }

  if (!schema.b || typeof schema.b !== 'string') {
    issues.push(error('input_schema.json must define root field "b" as the task splitting key.', 'input_schema_missing_b'));
  }

  if (!Array.isArray(schema.properties)) {
    issues.push(error('input_schema.json must define "properties" as an array.', 'input_schema_properties_invalid'));
    return issues;
  }

  const names = new Set();
  let splitProperty = null;

  for (const [index, property] of schema.properties.entries()) {
    const prefix = `input_schema.properties[${index}]`;
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      issues.push(error(`${prefix} must be an object.`, 'input_property_invalid'));
      continue;
    }

    if (!property.name || typeof property.name !== 'string') {
      issues.push(error(`${prefix}.name is required and must be a string.`, 'input_property_missing_name'));
    } else {
      if (/[^\w.-]/.test(property.name)) {
        issues.push(error(`${prefix}.name "${property.name}" contains unsupported characters. Use ASCII letters, numbers, underscore, dash, or dot.`, 'input_property_name_invalid'));
      }
      if (names.has(property.name)) {
        issues.push(error(`${prefix}.name "${property.name}" is duplicated.`, 'input_property_duplicate_name'));
      }
      names.add(property.name);
      if (property.name === schema.b) {
        splitProperty = property;
      }
    }

    const propertyType = inferInputType(property);
    if (!SUPPORTED_TYPES.has(propertyType)) {
      if (LEGACY_COMPAT_TYPES.has(propertyType)) {
        issues.push(warn(`${prefix}.type "${propertyType}" is accepted for legacy compatibility, but CoreClaw documents "${LEGACY_COMPAT_TYPES.get(propertyType)}"; prefer "${LEGACY_COMPAT_TYPES.get(propertyType)}" for whole-number fields.`, 'input_legacy_type_alias'));
      } else {
        issues.push(error(`${prefix}.type "${propertyType}" is not supported. Use ${[...SUPPORTED_TYPES].join(', ')}.`, 'input_property_unsupported_type'));
      }
    }

    if (property.editor && !SUPPORTED_EDITORS.has(property.editor)) {
      issues.push(warn(`${prefix}.editor "${property.editor}" is not documented by CoreClaw. Verify platform rendering before upload.`, 'input_property_unsupported_editor'));
    }

    if (property.editor && EDITOR_EXPECTED_TYPES.has(property.editor)) {
      const expectedTypes = EDITOR_EXPECTED_TYPES.get(property.editor);
      const normalizedType = normalizeType(propertyType);
      if (!expectedTypes.includes(normalizedType)) {
        issues.push(warn(
          `${prefix}.editor "${property.editor}" is documented for type ${formatTypeList(expectedTypes)}, but property type is "${normalizedType}".`,
          'input_editor_type_mismatch',
        ));
      }
    }

    if (property.required === true && property.default === undefined) {
      issues.push(warn(`${prefix} is required but has no default. Local default runs will need --input or --json.`, 'input_required_missing_default'));
    }

    issues.push(...validatePropertyOptions(property, prefix));
    issues.push(...validateSelectMultiple(property, prefix, 'input_select_multiple_invalid', 'input_select_multiple_editor_mismatch'));
    issues.push(...validateSectionMetadata(property, prefix));
    issues.push(...validateNumericBounds(property, prefix, 'input_numeric_bound_invalid'));
    issues.push(...validatePropertyParamList(property, prefix));
    issues.push(...validatePropertyDefault(property, prefix));
  }

  issues.push(...validateMaxResultsNaming(schema));

  if (schema.b && !splitProperty) {
    issues.push(error(`input_schema.json b="${schema.b}" does not match any property name.`, 'input_schema_b_missing_property'));
  } else if (splitProperty && inferInputType(splitProperty) !== 'array') {
    issues.push(error(`input_schema.json b="${schema.b}" must point to a property with type "array".`, 'input_schema_b_not_array'));
  }

  return issues;
}

export function validateOutputSchema(schema, filePath = 'output_schema.json') {
  if (!Array.isArray(schema)) {
    return [error(`${filePath} must be a JSON array.`, 'output_schema_root_invalid')];
  }

  const issues = [];
  const names = new Set();

  for (const [index, column] of schema.entries()) {
    const prefix = `output_schema[${index}]`;
    if (!column || typeof column !== 'object' || Array.isArray(column)) {
      issues.push(error(`${prefix} must be an object.`, 'output_column_invalid'));
      continue;
    }

    if (!column.name || typeof column.name !== 'string') {
      issues.push(error(`${prefix}.name is required and must be a string.`, 'output_column_missing_name'));
    } else {
      if (names.has(column.name)) {
        issues.push(error(`${prefix}.name "${column.name}" is duplicated.`, 'output_column_duplicate_name'));
      }
      names.add(column.name);
    }

    if (!SUPPORTED_TYPES.has(column.type)) {
      if (LEGACY_COMPAT_TYPES.has(column.type)) {
        issues.push(warn(`${prefix}.type "${column.type}" is accepted as a legacy compatibility alias for "${LEGACY_COMPAT_TYPES.get(column.type)}"; prefer documented CoreClaw type "${LEGACY_COMPAT_TYPES.get(column.type)}".`, 'output_legacy_type_alias'));
      } else {
        issues.push(error(`${prefix}.type "${column.type}" is not supported. Use ${[...SUPPORTED_TYPES].join(', ')}.`, 'output_column_unsupported_type'));
      }
    }
  }

  return issues;
}

function error(message, code = 'schema_error') {
  return { severity: 'error', code, message };
}

function warn(message, code = 'schema_warning') {
  return { severity: 'warn', code, message };
}

function normalizeType(type) {
  return LEGACY_COMPAT_TYPES.get(type) ?? type;
}

function validatePropertyOptions(property, prefix) {
  return validateSelectorOptions(property, prefix, {
    missingCode: 'input_selector_missing_options',
    invalidCode: 'input_selector_option_invalid',
  });
}

function validatePropertyParamList(property, prefix) {
  if (property.editor !== 'requestListSource' || property.param_list === undefined) {
    return [];
  }

  if (!Array.isArray(property.param_list)) {
    return [warn(`${prefix}.param_list should be an array of requestListSource parameter definitions.`, 'input_param_list_invalid')];
  }

  const issues = [];
  const names = new Set();
  for (const [index, param] of property.param_list.entries()) {
    const paramPrefix = `${prefix}.param_list[${index}]`;
    if (!param || typeof param !== 'object' || Array.isArray(param)) {
      issues.push(warn(`${paramPrefix} should be an object.`, 'input_param_invalid'));
      continue;
    }

    const name = param.param ?? param.name;
    if (!name || typeof name !== 'string') {
      issues.push(warn(`${paramPrefix}.param is required and must be a string.`, 'input_param_missing_name'));
    } else {
      if (/[^\w.-]/.test(name)) {
        issues.push(warn(`${paramPrefix}.param "${name}" contains unsupported characters. Use ASCII letters, numbers, underscore, dash, or dot.`, 'input_param_name_invalid'));
      }
      if (names.has(name)) {
        issues.push(warn(`${paramPrefix}.param "${name}" is duplicated.`, 'input_param_duplicate_name'));
      }
      names.add(name);
    }

    const paramType = inferInputType(param);
    if (param.type && !SUPPORTED_TYPES.has(paramType)) {
      if (!LEGACY_COMPAT_TYPES.has(paramType)) {
        issues.push(warn(`${paramPrefix}.type "${paramType}" is not documented by CoreClaw. Use ${[...SUPPORTED_TYPES].join(', ')}.`, 'input_param_unsupported_type'));
      }
    }

    if (param.editor && !SUPPORTED_EDITORS.has(param.editor)) {
      issues.push(warn(`${paramPrefix}.editor "${param.editor}" is not documented by CoreClaw. Verify platform rendering before upload.`, 'input_param_unsupported_editor'));
    }

    if (param.editor && EDITOR_EXPECTED_TYPES.has(param.editor)) {
      const expectedTypes = EDITOR_EXPECTED_TYPES.get(param.editor);
      const normalizedType = normalizeType(paramType);
      if (!expectedTypes.includes(normalizedType)) {
        issues.push(warn(
          `${paramPrefix}.editor "${param.editor}" is documented for type ${formatTypeList(expectedTypes)}, but param type is "${normalizedType}".`,
          'input_param_editor_type_mismatch',
        ));
      }
    }

    issues.push(...validateNumericBounds(param, paramPrefix, 'input_param_numeric_bound_invalid'));
    issues.push(...validateSelectorOptions(param, paramPrefix, {
      missingCode: 'input_param_selector_missing_options',
      invalidCode: 'input_param_selector_option_invalid',
    }));
    issues.push(...validateSelectMultiple(
      param,
      paramPrefix,
      'input_param_select_multiple_invalid',
      'input_param_select_multiple_editor_mismatch',
    ));
  }
  return issues;
}

function validateSelectorOptions(item, prefix, codes) {
  const issues = [];
  if (!SELECTOR_EDITORS.has(item.editor)) {
    return issues;
  }

  if (!Array.isArray(item.options) || item.options.length === 0) {
    issues.push(warn(`${prefix}.editor "${item.editor}" should define a non-empty options array so CoreClaw can render selectable values.`, codes.missingCode));
    return issues;
  }

  for (const [index, option] of item.options.entries()) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      issues.push(warn(`${prefix}.options[${index}] should be an object with label and value.`, codes.invalidCode));
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(option, 'label') || !Object.prototype.hasOwnProperty.call(option, 'value')) {
      issues.push(warn(`${prefix}.options[${index}] should include both label and value.`, codes.invalidCode));
    }
  }
  return issues;
}

function validateSelectMultiple(item, prefix, invalidCode, editorCode) {
  if (!Object.prototype.hasOwnProperty.call(item, 'multiple')) {
    return [];
  }

  const issues = [];
  if (typeof item.multiple !== 'boolean') {
    issues.push(warn(`${prefix}.multiple should be a boolean when present.`, invalidCode));
  }
  if (item.multiple === true && item.editor !== 'select') {
    issues.push(warn(`${prefix}.multiple is documented for editor "select", but editor is "${item.editor ?? 'undefined'}".`, editorCode));
  }
  return issues;
}

function validateSectionMetadata(property, prefix) {
  const issues = [];
  for (const key of ['sectionCaption', 'sectionDescription']) {
    if (Object.prototype.hasOwnProperty.call(property, key) && typeof property[key] !== 'string') {
      issues.push(warn(`${prefix}.${key} should be a string when present.`, 'input_section_metadata_invalid'));
    }
  }
  return issues;
}

function validatePropertyDefault(property, prefix) {
  if (!Object.prototype.hasOwnProperty.call(property, 'default')) {
    return [];
  }

  const issues = [];
  const propertyType = inferInputType(property);
  const expectedType = inputTypeLabel(propertyType, property);
  if (!valueMatchesInputType(property.default, propertyType, property)) {
    issues.push(warn(`${prefix}.default should match declared type "${expectedType}", but got ${valueType(property.default)}.`, 'input_default_type_mismatch'));
    return issues;
  }

  issues.push(...defaultNumericBoundIssues(property.default, property, `${prefix}.default`, 'input_default_bound_mismatch'));

  if (SELECTOR_EDITORS.has(property.editor) && Array.isArray(property.options) && property.options.length > 0) {
    const allowed = new Set(property.options
      .filter((option) => option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value'))
      .map((option) => comparableValue(option.value)));
    const values = Array.isArray(property.default) ? property.default : [property.default];
    for (const item of values) {
      if (!allowed.has(comparableValue(item))) {
        issues.push(warn(`${prefix}.default value ${formatValue(item)} is not declared in options.`, 'input_default_option_not_declared'));
      }
    }
  }

  if (property.editor === 'requestList') {
    issues.push(...validateRequestListDefault(property, prefix));
  } else if (property.editor === 'requestListSource') {
    issues.push(...validateRequestListSourceDefault(property, prefix));
  } else if (property.editor === 'stringList') {
    issues.push(...validateStringListDefault(property, prefix));
  }

  return issues;
}

function validateRequestListDefault(property, prefix) {
  if (!Array.isArray(property.default)) {
    return [];
  }
  return property.default.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [warn(`${prefix}.default[${index}] should be an object with a url field.`, 'input_default_list_item_invalid')];
    }
    if (typeof item.url !== 'string' || item.url.length === 0) {
      return [warn(`${prefix}.default[${index}].url should be a non-empty string.`, 'input_default_list_item_invalid')];
    }
    return [];
  });
}

function validateRequestListSourceDefault(property, prefix) {
  if (!Array.isArray(property.default)) {
    return [];
  }
  return property.default.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [warn(`${prefix}.default[${index}] should be an object.`, 'input_default_list_item_invalid')];
    }
    if (!Array.isArray(property.param_list)) {
      return [];
    }
    return property.param_list.flatMap((param) => validateParamDefault(item, param, `${prefix}.default[${index}]`));
  });
}

function validateParamDefault(item, param, prefix) {
  const name = param?.param ?? param?.name;
  if (!name || typeof name !== 'string') {
    return [];
  }
  if (!Object.prototype.hasOwnProperty.call(item, name)) {
    if (param.required === true) {
      return [warn(`${prefix}.${name} is required by param_list but missing from the default item.`, 'input_default_param_missing')];
    }
    return [];
  }

  const issues = [];
  const paramType = inferInputType(param);
  if (!valueMatchesInputType(item[name], paramType, param)) {
    issues.push(warn(`${prefix}.${name} should match declared type "${inputTypeLabel(paramType, param)}", but got ${valueType(item[name])}.`, 'input_default_param_type_mismatch'));
  }
  issues.push(...defaultNumericBoundIssues(item[name], param, `${prefix}.${name}`, 'input_default_param_bound_mismatch'));
  if (SELECTOR_EDITORS.has(param.editor) && Array.isArray(param.options) && param.options.length > 0) {
    const allowed = new Set(param.options
      .filter((option) => option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value'))
      .map((option) => comparableValue(option.value)));
    const values = Array.isArray(item[name]) ? item[name] : [item[name]];
    for (const value of values) {
      if (!allowed.has(comparableValue(value))) {
        issues.push(warn(`${prefix}.${name} value ${formatValue(value)} is not declared in param_list options.`, 'input_default_param_option_not_declared'));
      }
    }
  }
  return issues;
}

function validateStringListDefault(property, prefix) {
  if (!Array.isArray(property.default)) {
    return [];
  }
  return property.default.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [warn(`${prefix}.default[${index}] should be an object with a string field.`, 'input_default_list_item_invalid')];
    }
    if (typeof item.string !== 'string' || item.string.length === 0) {
      return [warn(`${prefix}.default[${index}].string should be a non-empty string.`, 'input_default_list_item_invalid')];
    }
    return [];
  });
}

function validateNumericBounds(item, prefix, code) {
  const issues = [];
  if (!item || typeof item !== 'object' || !isNumericSchemaItem(item)) {
    return issues;
  }

  const hasMinimum = Object.prototype.hasOwnProperty.call(item, 'minimum');
  const hasMaximum = Object.prototype.hasOwnProperty.call(item, 'maximum');

  if (hasMinimum && !isFiniteNumber(item.minimum)) {
    issues.push(warn(`${prefix}.minimum should be a finite number.`, code));
  }
  if (hasMaximum && !isFiniteNumber(item.maximum)) {
    issues.push(warn(`${prefix}.maximum should be a finite number.`, code));
  }
  if (hasMinimum && hasMaximum && isFiniteNumber(item.minimum) && isFiniteNumber(item.maximum) && item.minimum > item.maximum) {
    issues.push(warn(`${prefix}.minimum should be less than or equal to maximum.`, code));
  }
  return issues;
}

function defaultNumericBoundIssues(value, item, prefix, code) {
  if (!isNumericSchemaItem(item) || !isFiniteNumber(value)) {
    return [];
  }
  if (isFiniteNumber(item.minimum) && value < item.minimum) {
    return [warn(`${prefix} should be greater than or equal to ${item.minimum}, but got ${value}.`, code)];
  }
  if (isFiniteNumber(item.maximum) && value > item.maximum) {
    return [warn(`${prefix} should be less than or equal to ${item.maximum}, but got ${value}.`, code)];
  }
  return [];
}

function valueMatchesInputType(value, type, item = null) {
  if (isMultipleSelect(item)) {
    return Array.isArray(value);
  }
  switch (inputTypeLabel(type)) {
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

function inputTypeLabel(type, item = null) {
  if (isMultipleSelect(item)) {
    return 'array';
  }
  if (type === 'number') {
    return 'number';
  }
  return normalizeType(type);
}

function isMultipleSelect(item) {
  return item?.editor === 'select' && item.multiple === true;
}

export function inferInputType(item) {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  if (item.type !== undefined) {
    return item.type;
  }
  if (item.editor && EDITOR_EXPECTED_TYPES.has(item.editor)) {
    return EDITOR_EXPECTED_TYPES.get(item.editor)[0];
  }
  if (Object.prototype.hasOwnProperty.call(item, 'default')) {
    const type = valueType(item.default);
    return type === 'integer' ? 'integer' : type;
  }
  if (item.editor === 'input' || item.editor === 'textarea' || item.editor === 'datepicker') {
    return 'string';
  }
  if (item.options && SELECTOR_EDITORS.has(item.editor)) {
    return 'string';
  }
  return undefined;
}

function isNumericSchemaItem(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const type = inputTypeLabel(inferInputType(item));
  return type === 'integer' || type === 'number' || item.editor === 'number';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function valueType(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (Number.isInteger(value)) {
    return 'integer';
  }
  return typeof value;
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

function formatValue(value) {
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function formatTypeList(types) {
  if (types.length === 1) {
    return `"${types[0]}"`;
  }
  return types.map((type) => `"${type}"`).join(' or ');
}

function validateMaxResultsNaming(schema) {
  const issues = [];
  if (!Array.isArray(schema.properties)) {
    return issues;
  }
  const maxResultLikeNames = ['max_results', 'maxResults', 'max-results', 'max_result', 'maxResult', 'limit', 'count', 'total', 'size'];
  for (const property of schema.properties) {
    if (!property || typeof property.name !== 'string') {
      continue;
    }
    const name = property.name;
    const lower = name.toLowerCase();
    if (maxResultLikeNames.includes(name) || lower.includes('max') && (lower.includes('result') || lower.includes('item') || lower.includes('record') || lower.includes('count') || lower.includes('limit'))) {
      if (name !== 'max_results') {
        issues.push(warn(
          `input_schema property "${name}" looks like a max-results limiter. CoreClaw convention requires this field to be named "max_results" when present.`,
          'input_max_results_naming_convention',
        ));
      }
    }
  }
  return issues;
}
