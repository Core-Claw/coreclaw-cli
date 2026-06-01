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
      { name: 'enabled', type: 'boolean' },
      { name: 'items', type: 'array' },
      { name: 'options', type: 'object' },
    ],
  };

  assert.deepEqual(inputSchemaInputIssues({
    keyword: 'coreclaw',
    limit: 3,
    legacyLimit: 4,
    enabled: false,
    items: [],
    options: {},
    extra: 'allowed',
  }, schema), []);
  assert.deepEqual(inputSchemaInputIssues({
    keyword: 123,
    limit: 1.5,
    legacyLimit: '4',
    enabled: 'false',
    items: {},
    options: [],
  }, schema), [
    'field "keyword" must be a string',
    'field "limit" must be an integer',
    'field "legacyLimit" must be an integer',
    'field "enabled" must be a boolean',
    'field "items" must be an array',
    'field "options" must be an object',
  ]);
});

test('validates output schema', () => {
  const issues = validateOutputSchema([
    { name: 'url', type: 'string', description: 'URL' },
    { name: 'ok', type: 'boolean', description: 'OK' },
  ]);

  assert.equal(issues.length, 0);
});

test('accepts legacy number type as compatibility warning', () => {
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
  assert.equal(inputIssues.some((issue) => issue.severity === 'warn' && issue.message.includes('legacy compatibility alias')), true);
  assert.equal(outputIssues.some((issue) => issue.severity === 'warn' && issue.message.includes('legacy compatibility alias')), true);
});
