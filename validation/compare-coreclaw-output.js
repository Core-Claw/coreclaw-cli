#!/usr/bin/env node
import { compareCommand } from '../src/commands/compare.js';

const [cloudPath, localPath, outPath] = process.argv.slice(2);

compareCommand(cloudPath, localPath, { output: outPath }).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(error.exitCode ?? 1);
});
