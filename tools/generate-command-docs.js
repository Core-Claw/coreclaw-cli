import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCommandDocs } from '../src/command-docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'docs', 'commands.md');

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, renderCommandDocs());
console.log(`Generated ${path.relative(ROOT, OUT_FILE).replaceAll(path.sep, '/')}`);
