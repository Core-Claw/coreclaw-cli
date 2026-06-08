import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultsFromInputSchema, expandSplitInput, inputSchemaInputIssues, validateInputAgainstSchema } from '../src/runtime/input.js';
import { validateInputSchema, validateOutputSchema } from '../src/validation/schema.js';
import { CliError } from '../src/utils/errors.js';

test('validates documented input schema b field', () => {
  const issues = validateInputSchema({
    description: 'demo',
    b: 'startUrls',
    properties: [
      { name: 'startUrls', type: 'array', editor: 'requestList', default: [{ url: 'https://example.com' }], required: true },
    ],
  });

  assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0);
});

test('rejects b that does not point to an array property', () => {
  const issues = validateInputSchema({
    b: 'keyword',
    properties: [
      { name: 'keyword', type: 'string', editor: 'input', default: 'python' },
    ],
  });

  assert.match(issues.map((issue) => issue.message).join('\n'), /must point to a property with type "array"/);
});

test('builds defaults from input schema', () => {
  const defaults = defaultsFromInputSchema({
    properties: [
      { name: 'limit', type: 'integer', default: 10 },
      { name: 'empty', type: 'string' },
    ],
  });

  assert.deepEqual(defaults, { limit: 10 });
});

test('expands split requestList item into single task shape', () => {
  const input = {
    startUrls: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
    limit: 2,
  };
  const schema = { b: 'startUrls' };

  assert.deepEqual(expandSplitInput(input, schema, 1), {
    url: 'https://b.example',
    limit: 2,
  });
});

test('validates actual run input against required schema fields', () => {
  const schema = {
    properties: [
      { name: 'startUrls', type: 'array', required: true },
      { name: 'limit', type: 'integer', required: true },
      { name: 'includeClosed', type: 'boolean', required: true },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    startUrls: [{ url: 'https://example.com' }],
    limit: 0,
    includeClosed: false,
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({ startUrls: [], includeClosed: false }, schema), [
    'required field "startUrls" is missing or empty',
    'required field "limit" is missing or empty',
  ]);
  assert.throws(
    () => validateInputAgainstSchema({ startUrls: [] }, schema),
    (error) => error instanceof CliError && /Input does not satisfy input_schema\.json/.test(error.message),
  );
});

test('validates actual run input types against input schema fields', () => {
  const schema = {
    properties: [
      { name: 'keyword', type: 'string' },
      { name: 'limit', type: 'integer' },
      { name: 'legacyLimit', type: 'number' },
      { name: 'legacyDelay', type: 'number' },
      { name: 'enabled', type: 'boolean' },
      { name: 'items', type: 'array' },
      { name: 'options', type: 'object' },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    keyword: 'coreclaw',
    limit: 3,
    legacyLimit: 4,
    legacyDelay: 0.5,
    enabled: false,
    items: [],
    options: {},
    extra: 'allowed',
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({
    keyword: 123,
    limit: 1.5,
    legacyLimit: '4',
    legacyDelay: '0.5',
    enabled: 'false',
    items: {},
    options: [],
  }, schema), [
    'field "keyword" must be a string',
    'field "limit" must be an integer',
    'field "legacyLimit" must be a number',
    'field "legacyDelay" must be a number',
    'field "enabled" must be a boolean',
    'field "items" must be an array',
    'field "options" must be an object',
  ]);
});

test('validates actual run input numeric bounds', () => {
  const schema = {
    properties: [
      { name: 'minOnly', type: 'integer', minimum: 1 },
      { name: 'maxOnly', type: 'integer', maximum: 10 },
      { name: 'delay', type: 'number', minimum: 0.5, maximum: 2 },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        param_list: [
          { param: 'limit', type: 'integer', minimum: 1, maximum: 5 },
        ],
      },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    minOnly: 1,
    maxOnly: 10,
    delay: 0.5,
    sources: [{ limit: 5 }],
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({
    minOnly: 0,
    maxOnly: 11,
    delay: 0.25,
    sources: [{ limit: 0 }, { limit: 6 }],
  }, schema), [
    'field "minOnly" must be >= 1',
    'field "maxOnly" must be <= 10',
    'field "delay" must be >= 0.5',
    'field "sources[0].limit" must be >= 1',
    'field "sources[1].limit" must be <= 5',
  ]);
});

test('validates selector inputs against declared schema options', () => {
  const schema = {
    properties: [
      {
        name: 'language',
        type: 'string',
        editor: 'select',
        options: [{ label: 'English', value: 'en' }, { label: 'Chinese', value: 'zh' }],
      },
      {
        name: 'category',
        type: 'integer',
        editor: 'radio',
        options: [{ label: 'Hotel', value: 1 }, { label: 'Restaurant', value: 2 }],
      },
      {
        name: 'sections',
        type: 'array',
        editor: 'checkbox',
        options: [{ label: 'Reviews', value: 'reviews' }, { label: 'Address', value: 'address' }],
      },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    language: 'en',
    category: 2,
    sections: ['reviews', 'address'],
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({
    language: 'de',
    category: 3,
    sections: ['reviews', 'hours'],
  }, schema), [
    'field "language" value "de" is not declared in input_schema options',
    'field "category" value 3 is not declared in input_schema options',
    'field "sections" value "hours" is not declared in input_schema options',
  ]);
});

test('validates documented list editor item shapes', () => {
  const schema = {
    properties: [
      { name: 'startUrls', type: 'array', editor: 'requestList' },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        param_list: [
          { param: 'query', type: 'string', required: true },
          { param: 'limit', type: 'integer' },
          { param: 'mode', type: 'string', editor: 'select', options: [{ label: 'Search', value: 'search' }] },
        ],
      },
      { name: 'searchTerms', type: 'array', editor: 'stringList' },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    startUrls: [{ url: 'https://example.com' }],
    sources: [{ query: 'restaurant', limit: 2, mode: 'search' }],
    searchTerms: [{ string: 'restaurant' }],
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({
    startUrls: [{ link: 'https://example.com' }, 'https://example.com'],
    sources: [{}, 'restaurant', { query: 'school', limit: '2', mode: 'bad' }],
    searchTerms: [{ value: 'restaurant' }, 'school'],
  }, schema), [
    'field "startUrls[0].url" must be a non-empty string',
    'field "startUrls[1]" must be an object with a "url" field',
    'required field "sources[0].query" is missing or empty',
    'field "sources[1]" must be an object',
    'field "sources[2].limit" must be an integer',
    'field "sources[2].mode" value "bad" is not declared in input_schema options',
    'field "searchTerms[0].string" must be a non-empty string',
    'field "searchTerms[1]" must be an object with a "string" field',
  ]);
});

test('validates output schema', () => {
  const issues = validateOutputSchema([
    { name: 'url', type: 'string', description: 'URL' },
    { name: 'ok', type: 'boolean', description: 'OK' },
  ]);

  assert.equal(issues.length, 0);
});

test('accepts number type as a first-class type', () => {
  const inputIssues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'number', editor: 'number' },
    ],
  });
  const outputIssues = validateOutputSchema([
    { name: 'price', type: 'number', description: 'Price' },
  ]);

  assert.equal(inputIssues.some((issue) => issue.severity === 'error'), false);
  assert.equal(outputIssues.some((issue) => issue.severity === 'error'), false);
  assert.equal(inputIssues.some((issue) => issue.code === 'input_legacy_type_alias'), false);
  assert.equal(outputIssues.some((issue) => issue.code === 'output_legacy_type_alias'), false);
});

test('infers input property type when official worker schemas omit type but provide editor or default', () => {
  const issues = validateInputSchema({
    b: 'keyword',
    properties: [
      { name: 'keyword', type: 'array', editor: 'stringList', default: [{ string: 'pizza' }] },
      { name: 'base_location', default: 'New York, USA', required: true },
      { name: 'lang', editor: 'select', default: 'en', options: [{ label: 'English', value: 'en' }] },
      { name: 'max_results', editor: 'number', default: 10, minimum: 1 },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.equal(issues.some((issue) => issue.code === 'input_property_unsupported_type'), false);
});

test('schema validation issues always include stable codes', () => {
  const inputIssues = validateInputSchema({
    b: 'missing',
    properties: [
      'bad',
      { name: 'bad name', type: 'float', editor: 'slider', required: true },
      { name: 'limit', type: 'number' },
    ],
  });
  const outputIssues = validateOutputSchema([
    null,
    { name: 'price', type: 'number' },
    { name: 'price', type: 'float' },
  ]);

  for (const issue of [...inputIssues, ...outputIssues]) {
    assert.equal(typeof issue.code, 'string');
    assert.notEqual(issue.code.length, 0);
  }
  assert.deepEqual(inputIssues.map((issue) => issue.code), [
    'input_property_invalid',
    'input_property_name_invalid',
    'input_property_unsupported_type',
    'input_property_unsupported_editor',
    'input_required_missing_default',
    'input_max_results_naming_convention',
    'input_schema_b_missing_property',
  ]);
  assert.deepEqual(outputIssues.map((issue) => issue.code), [
    'output_column_invalid',
    'output_column_duplicate_name',
    'output_column_unsupported_type',
  ]);
});

test('warns when input editor does not match the documented type', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'string', editor: 'number' },
      { name: 'enabled', type: 'string', editor: 'switch' },
      { name: 'sections', type: 'string', editor: 'checkbox' },
      { name: 'urls', type: 'string', editor: 'requestList' },
      { name: 'terms', type: 'string', editor: 'stringList' },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(issues.filter((issue) => issue.code === 'input_editor_type_mismatch').map((issue) => issue.message), [
    'input_schema.properties[1].editor "number" is documented for type "integer" or "number", but property type is "string".',
    'input_schema.properties[2].editor "switch" is documented for type "boolean", but property type is "string".',
    'input_schema.properties[3].editor "checkbox" is documented for type "array", but property type is "string".',
    'input_schema.properties[4].editor "requestList" is documented for type "array", but property type is "string".',
    'input_schema.properties[5].editor "stringList" is documented for type "array", but property type is "string".',
  ]);
});

test('warns about selector option and default drift in input schema', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList', default: [{ value: 'missing-string' }] },
      { name: 'language', type: 'string', editor: 'select', default: 'de', options: [{ label: 'English', value: 'en' }] },
      { name: 'category', type: 'integer', editor: 'radio', options: [{ label: 'Missing value' }, { value: 2 }] },
      { name: 'sections', type: 'array', editor: 'checkbox' },
      { name: 'limit', type: 'integer', editor: 'number', default: '10' },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        default: [{}, 'bad'],
        param_list: [{ param: 'query', type: 'string', required: true }],
      },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(issues.filter((issue) => issue.code?.startsWith('input_')).map((issue) => issue.code), [
    'input_default_list_item_invalid',
    'input_default_option_not_declared',
    'input_selector_option_invalid',
    'input_selector_option_invalid',
    'input_selector_missing_options',
    'input_default_type_mismatch',
    'input_default_param_missing',
    'input_default_list_item_invalid',
    'input_max_results_naming_convention',
  ]);
});

test('validates documented select multiple and section metadata', () => {
  const schema = {
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      {
        name: 'languages',
        type: 'string',
        editor: 'select',
        multiple: true,
        sectionCaption: 'Locale',
        sectionDescription: 'Language filters',
        default: ['en'],
        options: [{ label: 'English', value: 'en' }, { label: 'Chinese', value: 'zh' }],
      },
    ],
  };

  const issues = validateInputSchema(schema);

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.equal(issues.some((issue) => issue.code === 'input_default_type_mismatch'), false);
  assert.deepEqual(inputSchemaInputIssues({ items: [{ string: 'query' }], languages: ['en', 'zh'] }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({ items: [{ string: 'query' }], languages: 'en' }, schema), [
    'field "languages" must be an array',
  ]);
  assert.deepEqual(inputSchemaInputIssues({ items: [{ string: 'query' }], languages: ['de'] }, schema), [
    'field "languages" value "de" is not declared in input_schema options',
  ]);
});

test('warns about invalid select multiple and section metadata', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'language', type: 'string', editor: 'select', multiple: 'yes', options: [{ label: 'English', value: 'en' }] },
      { name: 'mode', type: 'string', editor: 'radio', multiple: true, sectionCaption: false, sectionDescription: 12 },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        param_list: [
          { param: 'tags', type: 'string', editor: 'radio', multiple: true },
        ],
      },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(issues.filter((issue) => [
    'input_select_multiple_invalid',
    'input_select_multiple_editor_mismatch',
    'input_param_select_multiple_editor_mismatch',
    'input_section_metadata_invalid',
  ].includes(issue.code)).map((issue) => issue.code), [
    'input_select_multiple_invalid',
    'input_select_multiple_editor_mismatch',
    'input_section_metadata_invalid',
    'input_section_metadata_invalid',
    'input_param_select_multiple_editor_mismatch',
  ]);
});

test('warns about invalid requestListSource param_list definitions', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        param_list: [
          { title: 'Missing param', type: 'string', editor: 'input' },
          { param: 'query', type: 'string', editor: 'input' },
          { param: 'query', type: 'string', editor: 'input' },
          { param: 'limit', type: 'string', editor: 'number' },
          { param: 'mode', type: 'string', editor: 'select' },
          { param: 'badType', type: 'float', editor: 'input' },
          { param: 'badEditor', type: 'string', editor: 'slider' },
          { param: 'choice', type: 'string', editor: 'radio', options: [{ label: 'Missing value' }] },
        ],
      },
      {
        name: 'brokenSources',
        type: 'array',
        editor: 'requestListSource',
        param_list: {},
      },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(issues.filter((issue) => issue.code?.startsWith('input_param')).map((issue) => issue.code), [
    'input_param_missing_name',
    'input_param_duplicate_name',
    'input_param_editor_type_mismatch',
    'input_param_selector_missing_options',
    'input_param_unsupported_type',
    'input_param_unsupported_editor',
    'input_param_selector_option_invalid',
    'input_param_list_invalid',
  ]);
});

test('warns about invalid numeric bounds and default bounds drift', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'integer', editor: 'number', minimum: 10, maximum: 5, default: 8 },
      { name: 'delay', type: 'number', editor: 'number', minimum: '0', maximum: false, default: 0.5 },
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        default: [{ limit: 0, mode: 'slow' }],
        param_list: [
          { param: 'limit', type: 'integer', minimum: 1, maximum: 5 },
          { param: 'mode', type: 'string', editor: 'select', options: [{ label: 'Fast', value: 'fast' }] },
        ],
      },
    ],
  });

  assert.equal(issues.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(issues.filter((issue) => issue.code?.includes('bound')).map((issue) => issue.code), [
    'input_numeric_bound_invalid',
    'input_default_bound_mismatch',
    'input_numeric_bound_invalid',
    'input_numeric_bound_invalid',
    'input_default_param_bound_mismatch',
  ]);
  assert.equal(issues.some((issue) => issue.code === 'input_default_param_option_not_declared'), true);
});
