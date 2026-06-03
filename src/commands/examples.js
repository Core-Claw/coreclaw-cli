import { EXAMPLE_WORKERS, examplesReport } from '../examples/catalog.js';
import { printJson, shouldPrintJson } from '../utils/output.js';

export async function examplesCommand(options = {}) {
  if (shouldPrintJson(options)) {
    printJson(examplesReport());
    return examplesReport();
  }

  console.log('CoreClaw example Workers');
  console.log('');
  for (const example of EXAMPLE_WORKERS) {
    console.log(`${example.name} (${example.language})`);
    console.log(`  Path: ${example.path}`);
    console.log(`  Contract: ${example.contract}`);
    console.log(`  Purpose: ${example.purpose}`);
    console.log(`  Verify: ${example.verify}`);
    console.log('');
  }
  console.log('Run "coreclaw verify <path> ..." to execute an example as an upload preflight.');
  return examplesReport();
}
