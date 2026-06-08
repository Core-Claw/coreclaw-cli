import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { validateInputSchema, validateOutputSchema } from './schema.js';

const RUNTIME_HEADER_FORMATS = new Set(['text', 'datetime', 'integer', 'number', 'boolean', 'array', 'object']);
const SOURCE_SCAN_EXTENSIONS = new Set(['.py', '.js', '.cjs', '.mjs', '.go']);
const NODE_SOURCE_SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const PYTHON_SOURCE_SCAN_EXTENSIONS = new Set(['.py']);
const SOURCE_SCAN_IGNORED_DIRS = new Set([
  '.coreclaw',
  '.coreclaw-python-venv',
  '.git',
  '.hg',
  '.svn',
  '.venv',
  '__pycache__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'tests',
  'venv',
]);
const NODE_BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const NODE_IMPORT_SPECIFIER_PATTERNS = [
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /(?:^|[\n;])\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[\n;])\s*export\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
];
const PYTHON_STDLIB_MODULES = new Set([
  '__future__',
  'abc',
  'argparse',
  'array',
  'asyncio',
  'base64',
  'binascii',
  'bisect',
  'builtins',
  'calendar',
  'cmath',
  'collections',
  'concurrent',
  'contextlib',
  'copy',
  'csv',
  'ctypes',
  'dataclasses',
  'datetime',
  'decimal',
  'difflib',
  'email',
  'enum',
  'errno',
  'functools',
  'getpass',
  'glob',
  'gzip',
  'hashlib',
  'heapq',
  'hmac',
  'html',
  'http',
  'importlib',
  'inspect',
  'io',
  'ipaddress',
  'itertools',
  'json',
  'logging',
  'math',
  'multiprocessing',
  'operator',
  'os',
  'pathlib',
  'pickle',
  'platform',
  'queue',
  'random',
  're',
  'secrets',
  'shlex',
  'shutil',
  'signal',
  'socket',
  'sqlite3',
  'ssl',
  'statistics',
  'string',
  'struct',
  'subprocess',
  'sys',
  'tempfile',
  'textwrap',
  'threading',
  'time',
  'timeit',
  'traceback',
  'types',
  'typing',
  'unittest',
  'unicodedata',
  'urllib',
  'uuid',
  'warnings',
  'weakref',
  'xml',
  'zipfile',
]);
const PYTHON_IMPORT_PACKAGE_MAP = new Map([
  ['bs4', 'beautifulsoup4'],
  ['cv2', 'opencv-python'],
  ['dateutil', 'python-dateutil'],
  ['dotenv', 'python-dotenv'],
  ['google', 'protobuf'],
  ['grpc', 'grpcio'],
  ['jobspy', 'python-jobspy'],
  ['pil', 'pillow'],
  ['playwright_stealth', 'playwright-stealth'],
  ['sklearn', 'scikit-learn'],
  ['socks', 'pysocks'],
  ['yaml', 'pyyaml'],
]);
const HTTP_CLIENT_PATTERNS = {
  python: [
    /\bimport\s+requests\b/,
    /\bfrom\s+requests\b/,
    /\brequests\.(get|post|put|patch|delete|head|request|Session)\b/,
    /\bimport\s+httpx\b/,
    /\bfrom\s+httpx\b/,
    /\bhttpx\.(get|post|put|patch|delete|head|request|Client|AsyncClient)\b/,
    /\bimport\s+aiohttp\b/,
    /\baiohttp\.(ClientSession|request)\b/,
    /\bimport\s+urllib\.request\b/,
    /\burllib\.request\.(urlopen|Request)\b/,
    /\bimport\s+cloudscraper\b/,
    /\bcloudscraper\.(create_scraper|CloudScraper)\b/,
  ],
  node: [
    /\brequire\(['"]axios['"]\)/,
    /\bfrom\s+['"]axios['"]/,
    /\baxios\.(get|post|put|patch|delete|head|request|create)\b/,
    /\bfetch\s*\(/,
    /\brequire\(['"]node-fetch['"]\)/,
    /\bfrom\s+['"]node-fetch['"]/,
    /\brequire\(['"]undici['"]\)/,
    /\bfrom\s+['"]undici['"]/,
    /\bimport\s*\(['"]undici['"]\)/,
    /\brequire\(['"]got['"]\)/,
    /\bfrom\s+['"]got['"]/,
    /\bgot\.(get|post|put|patch|delete|head)\b/,
  ],
  go: [
    /import\s*(?:\([^)]*["']net\/http["'][^)]*\)|["']net\/http["'])/s,
    /\bhttp\.(Get|Post|Head|NewRequest|NewRequestWithContext|DefaultClient)\b/,
    /\bhttp\.Client\b/,
  ],
};
const BROWSER_AUTOMATION_PATTERNS = {
  python: [
    /\bfrom\s+playwright(?:\.(?:async_api|sync_api))?\s+import\b/,
    /\bimport\s+playwright\b/,
    /\basync_playwright\s*\(/,
    /\bconnect_over_cdp\s*\(/,
    /\bfrom\s+selenium\b/,
    /\bimport\s+selenium\b/,
    /\bwebdriver\.Remote\s*\(/,
    /\bfrom\s+DrissionPage\b/,
    /\bChromiumOptions\b/,
    /\bChromium\s*\(/,
  ],
  node: [
    /\brequire\(['"](?:playwright|playwright-core|puppeteer|puppeteer-core|selenium-webdriver)['"]\)/,
    /\bfrom\s+['"](?:playwright|playwright-core|puppeteer|puppeteer-core|selenium-webdriver)['"]/,
    /\bconnectOverCDP\s*\(/,
    /\bconnect_over_cdp\s*\(/,
    /\bpuppeteer\.connect\s*\(/,
    /\bchromium\.connectOverCDP\s*\(/,
    /\bwebdriver\.Builder\s*\(/,
  ],
  go: [
    /github\.com\/chromedp\/chromedp/,
    /\bchromedp\./,
  ],
};
const PROXY_AUTH_PATTERNS = {
  python: envReadPattern('python', 'PROXY_AUTH'),
  node: envReadPattern('node', 'PROXY_AUTH'),
  go: envReadPattern('go', 'PROXY_AUTH'),
};
const PROXY_DOMAIN_PATTERNS = {
  python: envReadPattern('python', 'PROXY_DOMAIN'),
  node: envReadPattern('node', 'PROXY_DOMAIN'),
  go: envReadPattern('go', 'PROXY_DOMAIN'),
};
const PROXY_SUPPORT_DOC = 'worker-definition/platform-features/proxy-support.md';
const BROWSER_AUTOMATION_DOCS = [
  'worker-definition/browser-automation/overview.md',
  'worker-definition/browser-automation/playwright.md',
  'worker-definition/browser-automation/puppeteer.md',
  'worker-definition/browser-automation/selenium.md',
  'worker-definition/browser-automation/drissionpage.md',
  'worker-definition/browser-automation/lightpanda.md',
];
const NODE_DEPENDENCY_DOCS = [
  'worker-definition/project-structure.md',
  'worker-definition/examples/nodejs-example.md',
  'builds-and-runs.md',
];
const PYTHON_DEPENDENCY_DOCS = [
  'worker-definition/project-structure.md',
  'worker-definition/examples/python-example.md',
  'builds-and-runs.md',
];

export const LANGUAGE_SPECS = {
  python: {
    label: 'Python',
    entry: 'main.py',
    dependencyFile: 'requirements.txt',
    required: ['main.py', 'requirements.txt', 'input_schema.json', 'sdk.py', 'sdk_pb2.py', 'sdk_pb2_grpc.py'],
    runtimeDependencies: ['grpcio', 'protobuf'],
  },
  node: {
    label: 'Node.js',
    entry: 'main.js',
    dependencyFile: 'package.json',
    required: ['main.js', 'package.json', 'input_schema.json', 'sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js'],
    runtimeDependencies: ['@grpc/grpc-js', 'google-protobuf'],
  },
  go: {
    label: 'Go',
    entry: 'main.go',
    dependencyFile: 'go.mod',
    required: ['main.go', 'go.mod', 'go.sum', 'input_schema.json', 'GoSdk/sdk.go', 'GoSdk/sdk.pb.go', 'GoSdk/sdk_grpc.pb.go'],
    runtimeDependencies: ['google.golang.org/grpc', 'google.golang.org/protobuf'],
  },
};

export function detectProject(projectDir) {
  const matches = Object.entries(LANGUAGE_SPECS)
    .filter(([, spec]) => fs.existsSync(path.join(projectDir, spec.entry)))
    .map(([language]) => language);

  if (matches.length === 0) {
    throw new CliError(`No CoreClaw entry file found in ${projectDir}. Expected one of main.py, main.js, or main.go.`);
  }

  if (matches.length > 1) {
    throw new CliError(`Multiple CoreClaw entry files found (${matches.join(', ')}). Keep one language entry at the project root.`);
  }

  const language = matches[0];
  return {
    projectDir,
    language,
    spec: LANGUAGE_SPECS[language],
  };
}

export function validateProject(projectDir, options = {}) {
  const project = detectProject(projectDir);
  const issues = [];

  for (const requiredFile of project.spec.required) {
    const requiredPath = path.join(projectDir, requiredFile);
    if (fs.existsSync(requiredPath) && !hasExactPathCase(projectDir, requiredFile)) {
      issues.push({
        severity: 'error',
        code: 'required_file_case_mismatch',
        message: `Required file "${requiredFile}" exists with different casing. CoreClaw project structure and upload checks use exact file names, so rename it to "${requiredFile}".`,
        docs: ['worker-definition/project-structure.md', 'deployment.md'],
        evidence: {
          expected_path: requiredFile,
          observed_path: findExistingPathCase(projectDir, requiredFile) ?? '(unknown)',
        },
        remediation: `Rename the file or directory to exactly "${requiredFile}" before packaging or uploading.`,
      });
      continue;
    }

    if (!fs.existsSync(requiredPath)) {
      issues.push({
        severity: 'error',
        code: 'missing_required_file',
        message: `Missing required ${project.spec.label} worker file: ${requiredFile}`,
      });
    }
  }

  const readmePath = path.join(projectDir, 'README.md');
  if (fs.existsSync(readmePath) && !hasExactPathCase(projectDir, 'README.md')) {
    issues.push({
      severity: 'info',
      code: 'readme_file_case_mismatch',
      message: 'README.md exists with different casing. CoreClaw project structure documents the upload-ready usage notes file as README.md.',
      docs: ['worker-definition/project-structure.md'],
      evidence: {
        expected_path: 'README.md',
        observed_path: findExistingPathCase(projectDir, 'README.md') ?? '(unknown)',
      },
      remediation: 'Rename the file to exactly README.md so the local project matches the documented upload structure on case-sensitive runtimes.',
    });
  } else if (!fs.existsSync(readmePath)) {
    issues.push({
      severity: 'warn',
      code: 'missing_readme',
      message: 'Missing README.md. CoreClaw project structure documents README.md as an upload-ready worker file for user-facing usage notes.',
    });
  }

  const inputPath = path.join(projectDir, 'input_schema.json');
  const outputPath = path.join(projectDir, 'output_schema.json');

  if (fs.existsSync(inputPath)) {
    issues.push(...validateInputSchema(readJson(inputPath), inputPath));
  }

  issues.push(...validatePackageCompatibility(project));
  issues.push(...validateRuntimeDependencies(project));
  issues.push(...validateDeclaredNodeSourceDependencies(project));
  issues.push(...validateDeclaredPythonSourceDependencies(project));
  issues.push(...validateGoModuleChecksums(project));
  issues.push(...validateProxyUsageContract(project));
  issues.push(...validateBrowserEndpointContract(project));

  if (fs.existsSync(outputPath)) {
    issues.push(...validateOutputSchema(readJson(outputPath), outputPath));
  } else {
    issues.push({
      severity: 'warn',
      code: 'missing_output_schema_legacy',
      message: 'Missing output_schema.json. CoreClaw currently accepts legacy workers without it, but new workers should include it for stable table export and upload-time compatibility.',
    });
  }

  if (options.tableHeaders && fs.existsSync(outputPath)) {
    issues.push(...validateRuntimeHeaders(readJson(outputPath), options.tableHeaders));
  }

  return {
    ...project,
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  };
}

export function validateBrowserEndpointContract(project) {
  const scan = scanSourceForBrowserContract(project.projectDir, project.language);
  if (!scan.usesBrowserAutomation) {
    return [];
  }

  if (scan.readsProxyAuth && scan.readsAnyBrowserEndpoint) {
    return [];
  }

  const missing = [
    scan.readsProxyAuth ? null : 'PROXY_AUTH',
    scan.readsAnyBrowserEndpoint ? null : 'ChromeWs/ChromeHttp/LightpandaDomain',
  ].filter(Boolean);
  return [{
    severity: 'warn',
    code: 'browser_endpoint_env_not_used',
    message: `Project appears to use browser automation (${scan.evidence.join(', ')}) but does not read ${missing.join(' and ')}. CoreClaw browser workers should connect to the platform-hosted remote browser through ChromeWs, ChromeHttp, or LightpandaDomain with credentials from PROXY_AUTH instead of launching or assuming a local browser.`,
    docs: BROWSER_AUTOMATION_DOCS,
    evidence: {
      browser_client_files: scan.evidence,
      missing_env: missing,
      observed_env: scan.observedEnv,
      source_file_count: scan.source_file_count,
    },
    remediation: 'Read PROXY_AUTH plus ChromeWs, ChromeHttp, or LightpandaDomain at runtime and build the documented remote browser endpoint. Use LOCAL_DEV-only branches for launching a local browser during development.',
  }];
}

export function scanSourceForBrowserContract(projectDir, language) {
  const sourceFiles = collectSourceFiles(projectDir);
  const browserPatterns = BROWSER_AUTOMATION_PATTERNS[language] ?? [];
  const envPatterns = {
    proxyAuth: PROXY_AUTH_PATTERNS[language],
    chromeWs: envReadPattern(language, 'ChromeWs'),
    chromeHttp: envReadPattern(language, 'ChromeHttp'),
    lightpandaDomain: envReadPattern(language, 'LightpandaDomain'),
    cdpEndpoint: envReadPattern(language, 'CDP_ENDPOINT'),
    browserWsEndpoint: envReadPattern(language, 'BROWSER_WS_ENDPOINT'),
  };
  const evidence = [];
  const reads = Object.fromEntries(Object.keys(envPatterns).map((key) => [key, false]));

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectDir, filePath).replaceAll(path.sep, '/');
    for (const [key, pattern] of Object.entries(envPatterns)) {
      if (!reads[key] && pattern?.test(text)) {
        reads[key] = true;
      }
    }
    if (evidence.length < 5 && browserPatterns.some((pattern) => pattern.test(text))) {
      evidence.push(relativePath);
    }
  }

  const observedEnv = [
    reads.proxyAuth ? 'PROXY_AUTH' : null,
    reads.chromeWs ? 'ChromeWs' : null,
    reads.chromeHttp ? 'ChromeHttp' : null,
    reads.lightpandaDomain ? 'LightpandaDomain' : null,
    reads.cdpEndpoint ? 'CDP_ENDPOINT' : null,
    reads.browserWsEndpoint ? 'BROWSER_WS_ENDPOINT' : null,
  ].filter(Boolean);

  return {
    source_file_count: sourceFiles.length,
    usesBrowserAutomation: evidence.length > 0,
    readsProxyAuth: reads.proxyAuth,
    readsAnyBrowserEndpoint: Boolean(
      reads.chromeWs
      || reads.chromeHttp
      || reads.lightpandaDomain
      || reads.cdpEndpoint
      || reads.browserWsEndpoint,
    ),
    observedEnv,
    evidence,
  };
}

export function validateProxyUsageContract(project) {
  const scan = scanSourceForProxyContract(project.projectDir, project.language);
  if (!scan.usesHttpClient) {
    return [];
  }

  if (scan.readsProxyAuth && scan.readsProxyDomain) {
    return [];
  }

  const missing = [
    scan.readsProxyAuth ? null : 'PROXY_AUTH',
    scan.readsProxyDomain ? null : 'PROXY_DOMAIN',
  ].filter(Boolean);
  return [{
    severity: 'warn',
    code: 'http_proxy_env_not_used',
    message: `Project appears to make direct HTTP requests (${scan.evidence.join(', ')}) but does not read ${missing.join(' and ')}. CoreClaw runs HTTP request workers in an isolated network sandbox; build a SOCKS5 proxy URL from PROXY_AUTH and PROXY_DOMAIN or use a hosted browser endpoint for browser automation.`,
    docs: [PROXY_SUPPORT_DOC],
    evidence: {
      http_client_files: scan.evidence,
      missing_env: missing,
      source_file_count: scan.source_file_count,
    },
    remediation: 'Read PROXY_AUTH and PROXY_DOMAIN at runtime, build socks5://PROXY_AUTH@PROXY_DOMAIN, and configure that URL on the HTTP client. For browser automation, connect through ChromeWs or LightpandaDomain instead of making direct HTTP requests.',
  }];
}

function envReadPattern(language, name) {
  const escaped = escapeRegExp(name);
  if (language === 'python') {
    return new RegExp(`\\bos\\.(?:getenv\\(\\s*["']${escaped}["']|environ(?:\\.get\\(\\s*["']${escaped}["']|\\[\\s*["']${escaped}["']\\s*\\]))`);
  }
  if (language === 'node') {
    return new RegExp(`\\bprocess\\.env(?:\\.${escaped}|\\[\\s*["']${escaped}["']\\s*\\])`);
  }
  if (language === 'go') {
    return new RegExp(`\\bos\\.Getenv\\(\\s*["']${escaped}["']\\s*\\)`);
  }
  return null;
}

export function scanSourceForProxyContract(projectDir, language) {
  const sourceFiles = collectSourceFiles(projectDir);
  const httpPatterns = HTTP_CLIENT_PATTERNS[language] ?? [];
  const authPattern = PROXY_AUTH_PATTERNS[language];
  const domainPattern = PROXY_DOMAIN_PATTERNS[language];
  const evidence = [];
  let readsProxyAuth = false;
  let readsProxyDomain = false;

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectDir, filePath).replaceAll(path.sep, '/');
    if (!readsProxyAuth && authPattern?.test(text)) {
      readsProxyAuth = true;
    }
    if (!readsProxyDomain && domainPattern?.test(text)) {
      readsProxyDomain = true;
    }
    if (evidence.length < 5 && httpPatterns.some((pattern) => pattern.test(text))) {
      evidence.push(relativePath);
    }
  }

  return {
    source_file_count: sourceFiles.length,
    usesHttpClient: evidence.length > 0,
    readsProxyAuth,
    readsProxyDomain,
    evidence,
  };
}

function validatePackageCompatibility(project) {
  if (project.language !== 'node') {
    return [];
  }

  const packagePath = path.join(project.projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return [];
  }

  const manifest = readJson(packagePath);
  const issues = [];
  if (manifest.main !== undefined && manifest.main !== 'main.js') {
    issues.push({
      severity: 'warn',
      code: 'node_package_main_not_main_js',
      message: `package.json main is "${manifest.main}", but CoreClaw Node workers document "main.js" as the entry file.`,
    });
  }
  if (manifest.type !== undefined && manifest.type !== 'commonjs') {
    issues.push({
      severity: 'warn',
      code: 'node_package_type_not_commonjs',
      message: `package.json type is "${manifest.type}", but CoreClaw's Node SDK uses CommonJS require() and documents "type": "commonjs".`,
    });
  }
  return issues;
}

function validateRuntimeDependencies(project) {
  const filePath = path.join(project.projectDir, project.spec.dependencyFile);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const declared = readDeclaredDependencies(project.language, filePath);
  return project.spec.runtimeDependencies
    .filter((name) => !declared.has(name))
    .map((name) => ({
      severity: 'error',
      code: 'missing_runtime_dependency',
      message: `Missing SDK runtime dependency "${name}" in ${project.spec.dependencyFile}. CoreClaw installs dependencies from this file after upload, so local runs can pass while cloud runs fail if it is omitted.`,
    }));
}

export function validateDeclaredNodeSourceDependencies(project) {
  if (project.language !== 'node') {
    return [];
  }

  const packagePath = path.join(project.projectDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return [];
  }

  const declared = readDeclaredDependencies('node', packagePath);
  const imports = scanNodeImportSpecifiers(project.projectDir);
  const missingPackages = [];
  const importFiles = new Map();

  for (const item of imports) {
    const packageName = nodePackageNameFromSpecifier(item.specifier);
    if (!packageName || declared.has(packageName)) {
      continue;
    }
    if (!importFiles.has(packageName)) {
      missingPackages.push(packageName);
      importFiles.set(packageName, new Set());
    }
    importFiles.get(packageName).add(item.file);
  }

  if (missingPackages.length === 0) {
    return [];
  }

  const packageEvidence = missingPackages
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `${name} (${[...importFiles.get(name)].sort().join(', ')})`);

  return [{
    severity: 'warn',
    code: 'node_dependency_not_declared',
    message: `Project imports Node package(s) not declared in package.json runtime dependencies: ${packageEvidence.join('; ')}. CoreClaw installs packages from package.json after upload, so local node_modules can hide cloud runtime failures.`,
    docs: NODE_DEPENDENCY_DOCS,
    evidence: {
      missing_packages: missingPackages.sort((a, b) => a.localeCompare(b)),
      import_files: [...new Set([...importFiles.values()].flatMap((files) => [...files]))].sort(),
      package_json_sections_checked: ['dependencies', 'optionalDependencies'],
    },
    remediation: 'Add each imported third-party package to package.json dependencies or optionalDependencies, then rerun coreclaw validate/verify before uploading.',
  }];
}

export function scanNodeImportSpecifiers(projectDir) {
  const imports = [];
  for (const filePath of collectSourceFiles(projectDir, projectDir, NODE_SOURCE_SCAN_EXTENSIONS)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectDir, filePath).replaceAll(path.sep, '/');
    for (const pattern of NODE_IMPORT_SPECIFIER_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        imports.push({
          file: relativePath,
          specifier: match[1],
        });
      }
    }
  }
  return imports;
}

function nodePackageNameFromSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z]+:/i.test(specifier)) {
    return '';
  }
  if (NODE_BUILTIN_MODULES.has(specifier)) {
    return '';
  }
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
  }
  return specifier.split('/')[0];
}

export function validateDeclaredPythonSourceDependencies(project) {
  if (project.language !== 'python') {
    return [];
  }

  const requirementsPath = path.join(project.projectDir, 'requirements.txt');
  if (!fs.existsSync(requirementsPath)) {
    return [];
  }

  const declared = readDeclaredDependencies('python', requirementsPath);
  const imports = scanPythonImportModules(project.projectDir);
  const missingPackages = [];
  const importFiles = new Map();

  for (const item of imports) {
    const packageName = pythonPackageNameFromModule(project.projectDir, item.module);
    if (!packageName || declared.has(packageName)) {
      continue;
    }
    if (!importFiles.has(packageName)) {
      missingPackages.push(packageName);
      importFiles.set(packageName, new Set());
    }
    importFiles.get(packageName).add(item.file);
  }

  if (missingPackages.length === 0) {
    return [];
  }

  const sortedMissing = missingPackages.sort((a, b) => a.localeCompare(b));
  const packageEvidence = sortedMissing
    .map((name) => `${name} (${[...importFiles.get(name)].sort().join(', ')})`);

  return [{
    severity: 'warn',
    code: 'python_dependency_not_declared',
    message: `Project imports Python package(s) not declared in requirements.txt: ${packageEvidence.join('; ')}. CoreClaw installs Python packages from requirements.txt after upload, so local site-packages can hide cloud runtime failures.`,
    docs: PYTHON_DEPENDENCY_DOCS,
    evidence: {
      missing_packages: sortedMissing,
      import_files: [...new Set([...importFiles.values()].flatMap((files) => [...files]))].sort(),
      requirements_file: 'requirements.txt',
    },
    remediation: 'Add each imported third-party package to requirements.txt, preferably with a pinned or bounded version, then rerun coreclaw validate/verify before uploading.',
  }];
}

export function scanPythonImportModules(projectDir) {
  const imports = [];
  for (const filePath of collectRuntimePythonSourceFiles(projectDir)) {
    const fileName = path.basename(filePath);
    if (fileName === 'sdk.py' || fileName === 'sdk_pb2.py' || fileName === 'sdk_pb2_grpc.py') {
      continue;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectDir, filePath).replaceAll(path.sep, '/');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const importMatch = line.match(/^import\s+(.+)$/);
      if (importMatch) {
        for (const modulePart of importMatch[1].split(',')) {
          const moduleName = modulePart.trim().split(/\s+as\s+|\s+/)[0];
          addPythonImport(imports, relativePath, moduleName);
        }
        continue;
      }
      const fromMatch = line.match(/^from\s+([A-Za-z_][A-Za-z0-9_\.]*)\s+import\s+/);
      if (fromMatch) {
        addPythonImport(imports, relativePath, fromMatch[1]);
      }
    }
  }
  return imports;
}

function collectRuntimePythonSourceFiles(projectDir) {
  const entry = path.join(projectDir, 'main.py');
  if (!fs.existsSync(entry)) {
    return collectSourceFiles(projectDir, projectDir, PYTHON_SOURCE_SCAN_EXTENSIONS);
  }

  const visited = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const filePath = pending.pop();
    const realPath = path.resolve(filePath);
    if (visited.has(realPath) || !fs.existsSync(realPath)) {
      continue;
    }
    visited.add(realPath);
    const text = fs.readFileSync(realPath, 'utf8');
    for (const moduleName of parsePythonImportModules(text)) {
      const localFile = resolveLocalPythonModule(projectDir, moduleName);
      if (localFile && !visited.has(path.resolve(localFile))) {
        pending.push(localFile);
      }
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}

function parsePythonImportModules(text) {
  const modules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const importMatch = line.match(/^import\s+(.+)$/);
    if (importMatch) {
      for (const modulePart of importMatch[1].split(',')) {
        const moduleName = modulePart.trim().split(/\s+as\s+|\s+/)[0];
        if (moduleName) {
          modules.push(moduleName);
        }
      }
      continue;
    }
    const fromMatch = line.match(/^from\s+([A-Za-z_][A-Za-z0-9_\.]*)\s+import\s+/);
    if (fromMatch) {
      modules.push(fromMatch[1]);
    }
  }
  return modules;
}

function addPythonImport(imports, file, moduleName) {
  if (!moduleName || moduleName.startsWith('.')) {
    return;
  }
  const topLevelModule = moduleName.split('.')[0].toLowerCase();
  if (topLevelModule) {
    imports.push({ file, module: topLevelModule });
  }
}

function pythonPackageNameFromModule(projectDir, moduleName) {
  if (!moduleName || PYTHON_STDLIB_MODULES.has(moduleName)) {
    return '';
  }
  if (isLocalPythonModule(projectDir, moduleName)) {
    return '';
  }
  return normalizePythonPackageName(PYTHON_IMPORT_PACKAGE_MAP.get(moduleName) ?? moduleName);
}

function isLocalPythonModule(projectDir, moduleName) {
  return Boolean(resolveLocalPythonModule(projectDir, moduleName));
}

function resolveLocalPythonModule(projectDir, moduleName) {
  const parts = moduleName.split('.').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const directModule = path.join(projectDir, `${parts.join(path.sep)}.py`);
  if (fs.existsSync(directModule)) {
    return directModule;
  }
  const packageInit = path.join(projectDir, ...parts, '__init__.py');
  if (fs.existsSync(packageInit)) {
    return packageInit;
  }
  const topLevelModule = path.join(projectDir, `${parts[0]}.py`);
  if (fs.existsSync(topLevelModule)) {
    return topLevelModule;
  }
  const topLevelPackage = path.join(projectDir, parts[0], '__init__.py');
  if (fs.existsSync(topLevelPackage)) {
    return topLevelPackage;
  }
  return null;
}

function normalizePythonPackageName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function readDeclaredDependencies(language, filePath) {
  if (language === 'node') {
    const manifest = readJson(filePath);
    return new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
  }

  const text = fs.readFileSync(filePath, 'utf8');
  if (language === 'python') {
    return new Set(text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(/[<>=!~;\s[]/, 1)[0])
      .filter((name) => name && !name.startsWith('-'))
      .map(normalizePythonPackageName));
  }

  if (language === 'go') {
    return new Set(readGoRequiredModules(filePath).keys());
  }

  return new Set();
}

function validateGoModuleChecksums(project) {
  if (project.language !== 'go') {
    return [];
  }

  const goModPath = path.join(project.projectDir, 'go.mod');
  const goSumPath = path.join(project.projectDir, 'go.sum');
  if (!fs.existsSync(goModPath) || !fs.existsSync(goSumPath)) {
    return [];
  }

  const modules = readGoRequiredModules(goModPath);
  const goSum = fs.readFileSync(goSumPath, 'utf8');
  const issues = [];
  for (const moduleName of project.spec.runtimeDependencies) {
    const version = modules.get(moduleName);
    if (!version) {
      continue;
    }
    const hasChecksum = new RegExp(`^${escapeRegExp(moduleName)}\\s+${escapeRegExp(version)}\\s+h1:`, 'm').test(goSum);
    if (!hasChecksum) {
      issues.push({
        severity: 'error',
        code: 'go_missing_module_checksum',
        message: `go.sum is missing checksum for "${moduleName} ${version}". CoreClaw Go upload builds run with -mod=readonly, so dependency files cannot be rewritten during preflight. Run "go mod tidy" or "go mod download" and commit the updated go.sum before verify/pack.`,
      });
    }
  }
  return issues;
}

function readGoRequiredModules(filePath) {
  const modules = new Map();
  let inRequireBlock = false;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+\/\/.*$/, '').trim();
    if (!line || line.startsWith('//')) {
      continue;
    }
    if (line === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }
    const requireLine = line.startsWith('require ') ? line.slice('require '.length).trim() : (inRequireBlock ? line : '');
    const match = requireLine.match(/^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\s+(v[^\s]+)$/);
    if (match) {
      modules.set(match[1], match[2]);
    }
  }
  return modules;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasExactPathCase(rootDir, relativePath) {
  let currentDir = rootDir;
  for (const segment of relativePath.split(/[\\/]+/).filter(Boolean)) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) {
      return false;
    }
    currentDir = path.join(currentDir, segment);
  }
  return true;
}

function findExistingPathCase(rootDir, relativePath) {
  let currentDir = rootDir;
  const observed = [];
  for (const segment of relativePath.split(/[\\/]+/).filter(Boolean)) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir);
    } catch {
      return observed.length ? observed.join('/') : null;
    }
    const exact = entries.find((entry) => entry === segment);
    const caseInsensitive = exact ?? entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (!caseInsensitive) {
      return observed.length ? observed.join('/') : null;
    }
    observed.push(caseInsensitive);
    currentDir = path.join(currentDir, caseInsensitive);
  }
  return observed.join('/');
}

export function readJson(filePath) {
  try {
    return JSON.parse(stripJsonBom(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export function formatIssues(issues) {
  if (issues.length === 0) {
    return 'No validation issues found.';
  }

  return issues.map(formatIssue).join('\n');
}

export function formatIssue(issue) {
  const marker = issue.severity === 'error' ? 'ERROR' : issue.severity === 'info' ? 'INFO' : 'WARN';
  const lines = [`[${marker}] ${issue.message}`];
  const details = formatIssueDetails(issue);
  if (details.length > 0) {
    lines.push(...details.map((detail) => `  - ${detail}`));
  }
  return lines.join('\n');
}

export function formatIssueDetails(issue) {
  const details = [];
  const docs = formatIssueDocs(issue);
  if (docs) {
    details.push(`Docs: ${docs}`);
  }
  const evidence = formatIssueEvidence(issue);
  if (evidence) {
    details.push(`Evidence: ${evidence}`);
  }
  if (issue.remediation) {
    details.push(`Fix: ${issue.remediation}`);
  }
  if (Array.isArray(issue.commands) && issue.commands.length > 0) {
    details.push(`Commands: ${issue.commands.join(' && ')}`);
  }
  return details;
}

function formatIssueDocs(issue) {
  if (!Array.isArray(issue.docs) || issue.docs.length === 0) {
    return '';
  }
  return issue.docs.join(', ');
}

function formatIssueEvidence(issue) {
  if (!issue.evidence || typeof issue.evidence !== 'object' || Array.isArray(issue.evidence)) {
    return '';
  }
  const parts = [];
  if (Array.isArray(issue.evidence.http_client_files) && issue.evidence.http_client_files.length > 0) {
    parts.push(`HTTP client files=${issue.evidence.http_client_files.join(', ')}`);
  }
  if (Array.isArray(issue.evidence.missing_env) && issue.evidence.missing_env.length > 0) {
    parts.push(`missing env=${issue.evidence.missing_env.join(', ')}`);
  }
  for (const [key, value] of Object.entries(issue.evidence)) {
    if (key === 'http_client_files' || key === 'missing_env') {
      continue;
    }
    if (value === undefined || value === null || value === '') {
      continue;
    }
    parts.push(`${key}=${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return parts.join('; ');
}

export function formatIssueMarkdown(issue, prefix = '-') {
  const lines = [`${prefix} **${issue.severity.toUpperCase()}** \`${issue.code}\`: ${issue.message}`];
  const details = formatIssueDetails(issue);
  for (const detail of details) {
    lines.push(`  ${prefix} ${detail}`);
  }
  return lines.join('\n');
}

function validateRuntimeHeaders(outputSchema, tableHeaders) {
  const issues = [];
  const outputColumns = new Map(Array.isArray(outputSchema)
    ? outputSchema
      .filter((column) => typeof column?.name === 'string' && column.name.length > 0)
      .map((column) => [column.name, column])
    : []);

  for (const header of tableHeaders) {
    if (!header?.key) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_missing_key',
        message: 'Runtime table header is missing required key. CoreClaw table header keys must match pushed result fields.',
      });
      continue;
    }

    if (header.format && !RUNTIME_HEADER_FORMATS.has(header.format)) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_unsupported_format',
        message: `Runtime table header "${header.key}" uses unsupported format "${header.format}". Use text, datetime, integer, number, boolean, array, or object.`,
      });
      continue;
    }

    if (!outputColumns.has(header.key)) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_not_in_output_schema',
        message: `Runtime table header "${header.key}" is not declared in output_schema.json.`,
      });
      continue;
    }

    const headerType = normalizeRuntimeHeaderFormat(header.format);
    const outputType = outputSchemaTypeToHeaderFormat(outputColumns.get(header.key).type);
    if (headerType && outputType && headerType !== outputType) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_format_mismatch',
        message: `Runtime table header "${header.key}" format "${header.format}" does not match output_schema.json type "${outputColumns.get(header.key).type}".`,
      });
    }
  }

  return issues;
}

function outputSchemaTypeToHeaderFormat(type) {
  if (type === 'string') {
    return 'text';
  }
  if (type === 'number') {
    return 'number';
  }
  return RUNTIME_HEADER_FORMATS.has(type) ? type : null;
}

function normalizeRuntimeHeaderFormat(format) {
  if (format === 'string' || format === 'datetime') {
    return 'text';
  }
  return RUNTIME_HEADER_FORMATS.has(format) ? format : null;
}

function collectSourceFiles(rootDir, currentDir = rootDir, extensions = SOURCE_SCAN_EXTENSIONS) {
  const files = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      if (entry.isDirectory() && !SOURCE_SCAN_IGNORED_DIRS.has(entry.name)) {
        files.push(...collectSourceFiles(rootDir, path.join(currentDir, entry.name), extensions));
      }
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!SOURCE_SCAN_IGNORED_DIRS.has(entry.name)) {
        files.push(...collectSourceFiles(rootDir, fullPath, extensions));
      }
      continue;
    }

    if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripJsonBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
