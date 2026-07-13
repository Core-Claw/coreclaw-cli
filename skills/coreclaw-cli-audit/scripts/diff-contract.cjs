#!/usr/bin/env node

/**
 * Contract Diff Script
 *
 * Cross-references coreclaw-cli validation code against contract-checklist.md and
 * the exported openapi.json spec. Reports coverage, severity mismatches, and API
 * surface gaps.
 *
 * Usage: node diff-contract.cjs [--verbose]
 */

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCHEMA_JS = path.join(REPO_ROOT, 'src/validation/schema.js');
const PROJECT_JS = path.join(REPO_ROOT, 'src/validation/project.js');
const CLIENT_JS = path.join(REPO_ROOT, 'src/cloud/client.js');
const CHECKLIST = path.join(__dirname, '../references/contract-checklist.md');
const OPENAPI = path.resolve(REPO_ROOT, '../exported-api-docs/openapi.json');

// ---- validation code scanner ----

function scanValidationCalls(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const validations = [];
  const lines = content.split('\n');

  // Pattern 1: error('msg', 'code') / warn('msg', 'code') helper calls (schema.js style)
  const helperRegex = /\b(error|warn|info)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  let match;
  while ((match = helperRegex.exec(content)) !== null) {
    validations.push({
      type: match[1],
      code: match[3],
      file: path.basename(filePath),
      line: content.substring(0, match.index).split('\n').length,
    });
  }

  // Pattern 2: object-literal issues { severity: 'error', code: 'code', ... } (project.js style)
  const literalRegex = /severity:\s*['"`](error|warn|info)['"`][\s\S]{0,400}?code:\s*['"`]([A-Za-z0-9_]+)['"`]/g;
  while ((match = literalRegex.exec(content)) !== null) {
    const type = match[1];
    const code = match[2];
    const line = content.substring(0, match.index).split('\n').length;
    // Avoid double-counting codes already captured by the helper pattern on the same line range.
    if (!validations.some((v) => v.code === code && v.file === path.basename(filePath) && Math.abs(v.line - line) < 10)) {
      validations.push({ type, code, file: path.basename(filePath), line });
    }
  }
  return validations;
}

// ---- checklist parser ----

function parseChecklist(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rules = [];
  // Matches: - [x] R016: ... — **error** / **warn** / **info** / error / warn
  const ruleRegex = /- \[([ x])\] (R\d+[a-z]?):\s*(.+)/g;
  let match;
  while ((match = ruleRegex.exec(content)) !== null) {
    const description = match[3];
    const severity = inferChecklistSeverity(description);
    rules.push({
      id: match[2],
      description: description.replace(/\s*—.*$/, '').trim(),
      implemented: match[1] === 'x',
      severity,
      raw: description,
    });
  }
  return rules;
}

function inferChecklistSeverity(description) {
  if (/\*\*error\*\*|\berror\b/i.test(description) && !/\*\*warn\*\*|not error/i.test(description)) {
    if (/\*\*error\*\*|validated with error|— error/i.test(description)) {
      return 'error';
    }
  }
  if (/\*\*warn\*\*|validated with warn|— warn/i.test(description)) {
    return 'warn';
  }
  if (/\*\*info\*\*|— info/i.test(description)) {
    return 'info';
  }
  return 'unknown';
}

// ---- cloud client vs openapi cross-check ----

function scanClientMethods(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const methods = new Set();
  // Matches: const methodName = (...) => ... or methodName: (...) => ...
  const methodRegex = /\b(?:const|)\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?::[^=]*|=)\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    methods.add(match[1]);
  }
  return methods;
}

function loadOpenapiOperations(specPath) {
  if (!fs.existsSync(specPath)) {
    return { operations: [], available: false };
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const operations = [];
  for (const [route, item] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(item)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        continue;
      }
      operations.push({
        method: method.toUpperCase(),
        path: route,
        operationId: item[method].operationId ?? `${method.toUpperCase()} ${route}`,
      });
    }
  }
  return { operations, available: true };
}

// ---- analysis ----

function analyze() {
  console.log('=== Contract Diff Analysis ===\n');

  const schemaValidations = scanValidationCalls(SCHEMA_JS);
  const projectValidations = scanValidationCalls(PROJECT_JS);
  const allValidations = [...schemaValidations, ...projectValidations];
  const checklistRules = parseChecklist(CHECKLIST);

  const errorCount = allValidations.filter((v) => v.type === 'error').length;
  const warnCount = allValidations.filter((v) => v.type === 'warn').length;
  const infoCount = allValidations.filter((v) => v.type === 'info').length;
  const codeSet = new Set(allValidations.map((v) => v.code));

  console.log('Validation stats (schema.js + project.js):');
  console.log(`  error-severity issue codes: ${errorCount}`);
  console.log(`  warn-severity issue codes: ${warnCount}`);
  console.log(`  info-severity issue codes: ${infoCount}`);
  console.log(`  distinct issue codes: ${codeSet.size}`);
  console.log('');

  console.log('Contract checklist stats:');
  console.log(`  total rules: ${checklistRules.length}`);
  console.log(`  implemented: ${checklistRules.filter((r) => r.implemented).length}`);
  console.log(`  error-severity rules: ${checklistRules.filter((r) => r.severity === 'error').length}`);
  console.log(`  warn-severity rules: ${checklistRules.filter((r) => r.severity === 'warn').length}`);
  console.log('');

  const unimplemented = checklistRules.filter((r) => !r.implemented);
  if (unimplemented.length > 0) {
    console.log('Unimplemented rules:');
    unimplemented.forEach((rule) => console.log(`  [ ] ${rule.id}: ${rule.description}`));
    console.log('');
  }

  // Cross-check: checklist error rules should have a matching error-severity code in code.
  const codeHasError = new Set(allValidations.filter((v) => v.type === 'error').map((v) => v.code));
  const checklistErrorRules = checklistRules.filter((r) => r.severity === 'error' && r.implemented);
  const severityMismatches = [];
  for (const rule of checklistErrorRules) {
    // Heuristic: find issue codes mentioned in the rule description.
    const mentionedCodes = rule.raw.match(/\b[a-z]+_[a-z_]+\b/gi) ?? [];
    const ruleCodes = mentionedCodes.filter((c) => c.length > 8 && c.includes('_'));
    if (ruleCodes.length === 0) {
      continue;
    }
    const anyErrorInCode = ruleCodes.some((c) => codeHasError.has(c));
    if (!anyErrorInCode && ruleCodes.length > 0) {
      // Only flag if ALL mentioned codes are warn (a real downgrade candidate).
      const allWarn = ruleCodes.every((c) => allValidations.some((v) => v.code === c && v.type === 'warn'));
      if (allWarn) {
        severityMismatches.push({ rule: rule.id, codes: ruleCodes, note: 'rule says error but code uses warn' });
      }
    }
  }
  if (severityMismatches.length > 0) {
    console.log('Severity mismatches (checklist=error but code=warn):');
    severityMismatches.forEach((m) => console.log(`  ${m.rule}: ${m.codes.join(', ')} — ${m.note}`));
    console.log('');
  }

  // API-contract cross-check: cloud client methods vs openapi operationIds.
  const clientMethods = scanClientMethods(CLIENT_JS);
  const { operations, available } = loadOpenapiOperations(OPENAPI);
  console.log('API contract (cloud client vs exported-api-docs):');
  if (!available) {
    console.log(`  openapi spec not found at ${OPENAPI} — skipped (run inside the github workspace)`);
  } else {
    console.log(`  openapi operations: ${operations.length}`);
    const covered = operations.filter((op) => clientMethods.has(op.operationId));
    const missing = operations.filter((op) => !clientMethods.has(op.operationId));
    console.log(`  client methods covering an operationId: ${covered.length}`);
    console.log(`  operations without a direct client method: ${missing.length}`);
    if (missing.length > 0) {
      console.log('  uncovered operationIds (may be covered indirectly):');
      missing.forEach((op) => console.log(`    ${op.method} ${op.path} (${op.operationId})`));
    }
  }
  console.log('');

  if (VERBOSE) {
    console.log('Validation calls in code:');
    allValidations.forEach((v) => console.log(`  ${v.file}:${v.line} [${v.type}] ${v.code}`));
    console.log('');
  }
}

try {
  analyze();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
