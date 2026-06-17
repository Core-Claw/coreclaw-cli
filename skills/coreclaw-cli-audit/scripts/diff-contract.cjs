#!/usr/bin/env node

/**
 * Contract Diff Script
 * 
 * Scans coreclaw-cli validation code for error() and warn() calls,
 * cross-references with contract-checklist.md, and outputs coverage statistics.
 * 
 * Usage: node diff-contract.js [--verbose]
 */

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');

// Paths relative to repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCHEMA_JS = path.join(REPO_ROOT, 'src/validation/schema.js');
const PROJECT_JS = path.join(REPO_ROOT, 'src/validation/project.js');
const CHECKLIST = path.join(__dirname, '../references/contract-checklist.md');

function extractValidations(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const validations = [];
    const errorRegex = /error\(['"]([^'"]+)['"]/g;
    const warnRegex = /warn\(['"]([^'"]+)['"]/g;
    let match;
    while ((match = errorRegex.exec(content)) !== null) {
      validations.push({ type: 'error', message: match[1], file: path.basename(filePath), line: content.substring(0, match.index).split('\n').length });
    }
    while ((match = warnRegex.exec(content)) !== null) {
      validations.push({ type: 'warn', message: match[1], file: path.basename(filePath), line: content.substring(0, match.index).split('\n').length });
    }
    return validations;
  } catch (err) {
    console.error('Error reading ' + filePath + ':', err.message);
    return [];
  }
}

function parseChecklist(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const rules = [];
    const ruleRegex = /- \[([ x])\] (R\d+): (.+)/g;
    let match;
    while ((match = ruleRegex.exec(content)) !== null) {
      rules.push({ id: match[2], description: match[3], implemented: match[1] === 'x' });
    }
    return rules;
  } catch (err) {
    console.error('Error reading checklist:', err.message);
    return [];
  }
}

function analyze() {
  console.log('=== Contract Diff Analysis ===\n');
  const schemaValidations = extractValidations(SCHEMA_JS);
  const projectValidations = extractValidations(PROJECT_JS);
  const allValidations = [...schemaValidations, ...projectValidations];
  const checklistRules = parseChecklist(CHECKLIST);

  const stats = {
    totalRules: checklistRules.length,
    implemented: checklistRules.filter(r => r.implemented).length,
    validationsInCode: allValidations.length,
    errorCalls: allValidations.filter(v => v.type === 'error').length,
    warnCalls: allValidations.filter(v => v.type === 'warn').length
  };

  console.log('Statistics:');
  console.log('  Total contract rules: ' + stats.totalRules);
  console.log('  Implemented rules: ' + stats.implemented);
  if (stats.totalRules > 0) {
    console.log('  Coverage: ' + ((stats.implemented / stats.totalRules) * 100).toFixed(1) + '%');
  }
  console.log('  Validation calls in code: ' + stats.validationsInCode);
  console.log('    - error(): ' + stats.errorCalls);
  console.log('    - warn(): ' + stats.warnCalls);
  console.log('');

  const unimplemented = checklistRules.filter(r => !r.implemented);
  if (unimplemented.length > 0) {
    console.log('Unimplemented Rules:');
    unimplemented.forEach(rule => { console.log('  [ ] ' + rule.id + ': ' + rule.description); });
    console.log('');
  }

  if (VERBOSE) {
    console.log('Validation Calls in Code:');
    allValidations.forEach(v => { console.log('  ' + v.file + ':' + v.line + ' [' + v.type + '] ' + v.message); });
    console.log('');
  }

  console.log('Potential Issues:');
  const warnCalls = allValidations.filter(v => v.type === 'warn');
  if (warnCalls.length > 0) {
    console.log('  warn: ' + warnCalls.length + ' warn() calls - review if any should be error()');
  }
  console.log('  info: ' + allValidations.length + ' total validation messages');
}

try {
  analyze();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
