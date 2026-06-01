#!/usr/bin/env node
import { runCli } from '../src/cli.js';

runCli(process.argv).catch((error) => {
  if (error?.isCliError) {
    console.error(`Error: ${error.message}`);
    process.exit(error.exitCode ?? 1);
  }

  console.error(error);
  process.exit(1);
});
