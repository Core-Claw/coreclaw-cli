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

test('errors when input editor does not match the documented type', () => {
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

  assert.ok(issues.some((issue) => issue.severity === 'error'));
  assert.deepEqual(issues.filter((issue) => issue.code === 'input_editor_type_mismatch').map((issue) => issue.message), [
    'input_schema.properties[1].editor "number" requires type "integer" or "number", but property type is "string". The platform will reject this as "Invalid custom parameters" (code 4000). Change the type or use a compatible editor.',
    'input_schema.properties[2].editor "switch" requires type "boolean", but property type is "string". The platform will reject this as "Invalid custom parameters" (code 4000). Change the type or use a compatible editor.',
    'input_schema.properties[3].editor "checkbox" requires type "array", but property type is "string". The platform will reject this as "Invalid custom parameters" (code 4000). Change the type or use a compatible editor.',
    'input_schema.properties[4].editor "requestList" requires type "array", but property type is "string". The platform will reject this as "Invalid custom parameters" (code 4000). Change the type or use a compatible editor.',
    'input_schema.properties[5].editor "stringList" requires type "array", but property type is "string". The platform will reject this as "Invalid custom parameters" (code 4000). Change the type or use a compatible editor.',
  ]);
});

test('warns about selector option and default drift, errors on invalid list items', () => {
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

  assert.ok(issues.some((issue) => issue.severity === 'error'));
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
        type: 'array',
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

  assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0);
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

  assert.deepEqual(issues.filter((issue) => issue.code?.includes('bound')).map((issue) => issue.code), [
    'input_numeric_bound_invalid',
    'input_default_bound_mismatch',
    'input_numeric_bound_invalid',
    'input_numeric_bound_invalid',
    'input_default_param_bound_mismatch',
  ]);
  assert.equal(issues.some((issue) => issue.code === 'input_default_param_option_not_declared'), true);
});

test('catches textarea with array type as error (tiktok-scraper regression)', () => {
  const issues = validateInputSchema({
    description: 'Premium TikTok Data Extractor',
    b: 'queries',
    properties: [
      { title: 'Scraping Type', name: 'type', type: 'string', editor: 'select', options: [{ label: 'Profile', value: 'profile' }], required: true },
      { title: 'Queries', name: 'queries', type: 'array', editor: 'textarea', required: true },
      { title: 'Max Results', name: 'max_results', type: 'integer', editor: 'input', default: 10 },
    ],
  });

  const editorErrors = issues.filter((i) => i.code === 'input_editor_type_mismatch' && i.severity === 'error');
  assert.ok(editorErrors.length >= 1, 'textarea + array must be caught as error');
  assert.match(editorErrors[0].message, /Invalid custom parameters/);
  assert.match(editorErrors[0].message, /stringList/);
});

test('accepts stringList with array type (correct tiktok-scraper fix)', () => {
  const issues = validateInputSchema({
    description: 'Premium TikTok Data Extractor',
    b: 'queries',
    properties: [
      { title: 'Scraping Type', name: 'type', type: 'string', editor: 'select', options: [{ label: 'Profile', value: 'profile' }], required: true },
      { title: 'Queries', name: 'queries', type: 'array', editor: 'stringList', required: true, default: [{ string: 'cristiano' }] },
      { title: 'Max Results', name: 'max_results', type: 'integer', editor: 'number', default: 10 },
    ],
  });

  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('catches input with integer type as error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'integer', editor: 'input', default: 10 },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_editor_type_mismatch' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'input + integer must be caught as error');
});

test('catches array type with non-array editor as error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'input' },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_editor_type_mismatch' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'array + input editor must be caught as error');
  assert.match(errors[0].message, /Invalid custom parameters/);
});

test('catches invalid stringList default shape as error', () => {
  const issues = validateInputSchema({
    b: 'terms',
    properties: [
      { name: 'terms', type: 'array', editor: 'stringList', default: ['plain-string', 123] },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_default_list_item_invalid' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'stringList defaults with wrong shape must be errors');
  assert.match(errors[0].message, /must be an object with a "string" field/);
});

test('catches invalid requestList default shape as error', () => {
  const issues = validateInputSchema({
    b: 'urls',
    properties: [
      { name: 'urls', type: 'array', editor: 'requestList', default: ['https://example.com', { noturl: 'bad' }] },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_default_list_item_invalid' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'requestList defaults with wrong shape must be errors');
});

test('warns about unknown root keys in input_schema', () => {
  const issues = validateInputSchema({
    description: 'test',
    b: 'items',
    unknownKey: 'should warn',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
    ],
  });

  const warnings = issues.filter((i) => i.code === 'input_schema_unknown_root_key');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /unknownKey/);
});

test('does not warn about documented root keys', () => {
  const issues = validateInputSchema({
    description: 'test',
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
    ],
  });

  assert.equal(issues.filter((i) => i.code === 'input_schema_unknown_root_key').length, 0);
});

test('schema validation issues always include stable codes after upgrade', () => {
  const inputIssues = validateInputSchema({
    properties: [
      null,
      { name: '@bad!', type: 'float' },
    ],
  });
  assert.deepEqual(inputIssues.map((issue) => issue.code), [
    'input_schema_missing_b',
    'input_property_invalid',
    'input_property_name_invalid',
    'input_property_unsupported_type',
  ]);
});

test('output_schema requires each column to have a type field', () => {
  const issues = validateOutputSchema([
    { name: 'title', type: 'string', description: 'Title' },
    { name: 'missing_type', description: 'No type' },
    { name: 'null_type', type: null, description: 'Null type' },
  ]);

  const typeErrors = issues.filter((i) => i.code === 'output_column_missing_type' && i.severity === 'error');
  assert.equal(typeErrors.length, 2, 'both missing and null type should produce errors');
  assert.match(typeErrors[0].message, /output_schema\[1\]/);
  assert.match(typeErrors[1].message, /output_schema\[2\]/);
});

test('output_schema rejects unsupported column types', () => {
  const issues = validateOutputSchema([
    { name: 'bad', type: 'float' },
  ]);

  const errors = issues.filter((i) => i.code === 'output_column_unsupported_type' && i.severity === 'error');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /float/);
});

test('output_schema accepts all documented column types', () => {
  const issues = validateOutputSchema([
    { name: 'a', type: 'string' },
    { name: 'b', type: 'number' },
    { name: 'c', type: 'integer' },
    { name: 'd', type: 'boolean' },
    { name: 'e', type: 'array' },
    { name: 'f', type: 'object' },
  ]);

  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('catches default value type mismatch as error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'integer', editor: 'number', default: 'not-a-number' },
      { name: 'enabled', type: 'boolean', editor: 'switch', default: 'yes' },
    ],
  });

  const typeMismatchErrors = issues.filter((i) => i.code === 'input_default_type_mismatch' && i.severity === 'error');
  assert.ok(typeMismatchErrors.length >= 2, 'default type mismatches must be errors');
  assert.match(typeMismatchErrors[0].message, /code 4000/);
});

test('accepts type-matched defaults without error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'limit', type: 'integer', editor: 'number', default: 10 },
      { name: 'enabled', type: 'boolean', editor: 'switch', default: true },
      { name: 'keyword', type: 'string', editor: 'input', default: 'test' },
    ],
  });

  assert.equal(issues.filter((i) => i.code === 'input_default_type_mismatch').length, 0);
});

test('rejects Chinese characters in property name as error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: '?????', type: 'string', editor: 'input' },
    ],
  });

  const nameErrors = issues.filter((i) => i.code === 'input_property_name_invalid' && i.severity === 'error');
  assert.ok(nameErrors.length >= 1, 'Chinese characters in name must be caught');
  assert.match(nameErrors[0].message, /unsupported characters/);
});

test('catches requestListSource param default type mismatch as error', () => {
  const issues = validateInputSchema({
    b: 'sources',
    properties: [
      { name: 'sources', type: 'array', editor: 'requestListSource', default: [{ url: 'https://example.com', limit: 'not-a-number' }],
        param_list: [
          { param: 'url', type: 'string', required: true },
          { param: 'limit', type: 'integer' },
        ],
      },
    ],
  });

  const paramTypeErrors = issues.filter((i) => i.code === 'input_default_param_type_mismatch' && i.severity === 'error');
  assert.ok(paramTypeErrors.length >= 1, 'param default type mismatch must be error');
  assert.match(paramTypeErrors[0].message, /code 4000/);
});

test('catches requestListSource non-object default items as error', () => {
  const issues = validateInputSchema({
    b: 'sources',
    properties: [
      { name: 'sources', type: 'array', editor: 'requestListSource', default: ['https://example.com', 123] },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_default_list_item_invalid' && i.severity === 'error');
  assert.ok(errors.length >= 2, 'non-object requestListSource defaults must be errors');
});

test('catches requestListSource missing required param in default as error', () => {
  const issues = validateInputSchema({
    b: 'sources',
    properties: [
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        default: [{ num_of_posts: '10' }],
        param_list: [
          { param: 'url', title: 'URL', required: true },
          { param: 'num_of_posts', title: 'Max Posts' },
        ],
      },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_default_param_missing' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'missing required param in default must be error');
  assert.match(errors[0].message, /code 4000/);
});

test('accepts valid requestListSource defaults without error', () => {
  const issues = validateInputSchema({
    b: 'sources',
    properties: [
      {
        name: 'sources',
        type: 'array',
        editor: 'requestListSource',
        default: [{ url: 'https://example.com', num_of_posts: '10' }],
        param_list: [
          { param: 'url', title: 'URL', required: true },
          { param: 'num_of_posts', title: 'Max Posts' },
        ],
      },
    ],
  });

  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('catches select multiple with non-array type as error', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'languages', type: 'string', editor: 'select', multiple: true, options: [{ label: 'English', value: 'en' }] },
    ],
  });

  const errors = issues.filter((i) => i.code === 'input_select_multiple_type_mismatch' && i.severity === 'error');
  assert.ok(errors.length >= 1, 'select multiple with string type must be error');
  assert.match(errors[0].message, /type must be "array"/);
});

test('accepts select multiple with array type', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'languages', type: 'array', editor: 'select', multiple: true, default: ['en'], options: [{ label: 'English', value: 'en' }] },
    ],
  });

  assert.equal(issues.filter((i) => i.code === 'input_select_multiple_type_mismatch').length, 0);
});

test('accepts select without multiple and string type', () => {
  const issues = validateInputSchema({
    b: 'items',
    properties: [
      { name: 'items', type: 'array', editor: 'stringList' },
      { name: 'language', type: 'string', editor: 'select', default: 'en', options: [{ label: 'English', value: 'en' }] },
    ],
  });

  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

