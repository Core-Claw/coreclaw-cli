import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultsFromInputSchema, expandSplitInput } from '../src/runtime/input.js';
import { validateInputSchema, validateOutputSchema } from '../src/validation/schema.js';

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
