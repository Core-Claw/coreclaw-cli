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
  ['x_client_transaction', 'xclienttransaction'],
  ['yaml', 'pyyaml'],
]);
const HTTP_CLIENT_PATTERNS = {
  python: [
    /^\s*import\s+requests\b/m,
    /^\s*from\s+requests\b/m,
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
  'worker-definition/browser-automation/camoufox.md',
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
const BROWSER_FRAMEWORK_DEPENDENCY_DOCS = [
  'worker-definition/browser-automation/overview.md',
  'worker-definition/platform-features/browser-fingerprinting.md',
];
const PROTOBUF_VERSION_DOCS = [
  'worker-definition/sdk-modules.md',
  'worker-definition/examples/python-example.md',
];
const BROWSER_FRAMEWORK_PATTERNS = {
  python: [
    { pattern: /\b(?:from\s+playwright|import\s+playwright)\b/, packages: ['playwright'] },
    { pattern: /\b(?:from\s+selenium|import\s+selenium)\b/, packages: ['selenium'] },
    { pattern: /\b(?:from\s+DrissionPage|import\s+DrissionPage)\b/, packages: ['DrissionPage'] },
    { pattern: /\bimport\s+pyppeteer\b/, packages: ['pyppeteer'] },
  ],
  node: [
    { pattern: /\brequire\(['""]playwright(?:-core)?['""]\)|from\s+['""]playwright(?:-core)?['""]/, packages: ['playwright', 'playwright-core'] },
    { pattern: /\brequire\(['""]puppeteer(?:-core)?['""]\)|from\s+['""]puppeteer(?:-core)?['""]/, packages: ['puppeteer', 'puppeteer-core'] },
    { pattern: /\brequire\(['""]selenium-webdriver['""]\)|from\s+['""]selenium-webdriver['""]/, packages: ['selenium-webdriver'] },
  ],
};
const BROWSER_USER_AGENT_OVERRIDE_PATTERNS = [
  /\bnew_context\s*\([\s\S]{0,300}\buser_agent\s*=/i,
  /\bnewContext\s*\([\s\S]{0,300}\buserAgent\s*:/,
  /\bset_extra_http_headers\s*\([\s\S]{0,300}['"]User-Agent['"]/i,
  /\bsetExtraHTTPHeaders\s*\([\s\S]{0,300}['"]User-Agent['"]/,
  /\bsetUserAgent\s*\(/,
  /\badd_argument\s*\([\s\S]{0,120}(?:--)?user-agent=/i,
  /(?:--)?user-agent=/i,
];
const PYTHON_BROWSER_IMPORT_ROOTS = new Map([
  ['playwright', 'playwright'],
  ['selenium', 'selenium'],
  ['DrissionPage', 'DrissionPage'],
  ['pyppeteer', 'pyppeteer'],
]);

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
      severity: 'error',
      code: 'missing_output_schema',
      message: 'Missing output_schema.json. CoreClaw lists output_schema.json as a required worker file in every language project tree, and the platform ZIP validation checks for it alongside the entry file and input_schema.json. Cloud upload will be rejected without it.',
      docs: ['worker-definition/output-schema.md', 'worker-definition/project-structure.md', 'builds-and-runs.md'],
      remediation: 'Create output_schema.json as a JSON array of {name, type, description} column definitions matching the keys your Worker pushes via push_data.',
    });
  }

  if (options.tableHeaders && fs.existsSync(outputPath)) {
    issues.push(...validateRuntimeHeaders(readJson(outputPath), options.tableHeaders));
  }

  issues.push(...validateStaticPushDataKeys(project));
  issues.push(...validateUpsertUniqueKey(project));
  issues.push(...validateHeaderBeforePush(project));
  issues.push(...validateSocksProxyDependencies(project));
  issues.push(...validateNodeSocksProxyDependencies(project));
  issues.push(...validateHardcodedUserAgent(project));
  issues.push(...validateHardcodedProxyCredentials(project));
  issues.push(...validateBrowserFrameworkDependencies(project));
  issues.push(...validateProtobufVersionMatch(project));
  issues.push(...validateCamoufoxPlaywrightVersion(project));
  issues.push(...validateHardcodedApiKeys(project));
  issues.push(...validateAiohttpWithoutProxy(project));
  issues.push(...validateAsyncioRunWithSdk(project));
  issues.push(...validateExternalWorkerSlugs(project));
  issues.push(...validateDynamicCssSelectors(project));

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
    scan.readsAnyBrowserEndpoint ? null : 'ChromeWs/ChromeHttp/CamoufoxDomain/LightpandaDomain',
  ].filter(Boolean);
  return [{
    severity: 'warn',
    code: 'browser_endpoint_env_not_used',
    message: `Project appears to use browser automation (${scan.evidence.join(', ')}) but does not read ${missing.join(' and ')}. CoreClaw browser workers should connect to the platform-hosted remote browser through ChromeWs, ChromeHttp, CamoufoxDomain, or LightpandaDomain with credentials from PROXY_AUTH instead of launching or assuming a local browser.`,
    docs: BROWSER_AUTOMATION_DOCS,
    evidence: {
      browser_client_files: scan.evidence,
      missing_env: missing,
      observed_env: scan.observedEnv,
      source_file_count: scan.source_file_count,
    },
    remediation: 'Read PROXY_AUTH plus ChromeWs, ChromeHttp, CamoufoxDomain, or LightpandaDomain at runtime and build the documented remote browser endpoint. Use LOCAL_DEV-only branches for launching a local browser during development.',
  }];
}

export function scanSourceForBrowserContract(projectDir, language) {
  const sourceFiles = collectSourceFiles(projectDir);
  const browserPatterns = BROWSER_AUTOMATION_PATTERNS[language] ?? [];
  const envPatterns = {
    proxyAuth: PROXY_AUTH_PATTERNS[language],
    chromeWs: envReadPattern(language, 'ChromeWs'),
    chromeHttp: envReadPattern(language, 'ChromeHttp'),
    camoufoxDomain: envReadPattern(language, 'CamoufoxDomain'),
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
    reads.camoufoxDomain ? 'CamoufoxDomain' : null,
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
      || reads.camoufoxDomain
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
    severity: 'error',
    code: 'http_proxy_env_not_used',
    message: `Project makes direct HTTP requests (${scan.evidence.join(', ')}) but does not read ${missing.join(' and ')}. CoreClaw runs workers in an isolated network sandbox; without SOCKS5 proxy configuration, all outbound HTTP requests will fail in cloud runs.`,
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
      severity: 'error',
      code: 'node_package_main_not_main_js',
      message: `package.json main is "${manifest.main}", but CoreClaw Node workers require "main.js" as the entry file. The platform will fail to start the worker if main does not point to main.js.`,
    });
  }
  if (manifest.type !== undefined && manifest.type !== 'commonjs') {
    issues.push({
      severity: 'error',
      code: 'node_package_type_not_commonjs',
      message: `package.json type is "${manifest.type}", but CoreClaw's Node SDK uses CommonJS require(). Setting "module" or other non-commonjs types will cause the SDK to fail at runtime. Use "type": "commonjs" or omit the field.`,
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

export function validateStaticPushDataKeys(project) {
  const outputPath = path.join(project.projectDir, 'output_schema.json');
  if (!fs.existsSync(outputPath)) {
    return [];
  }

  const outputSchema = readJson(outputPath);
  if (!Array.isArray(outputSchema)) {
    return [];
  }

  const outputNames = new Set(
    outputSchema
      .filter((col) => typeof col?.name === 'string')
      .map((col) => col.name),
  );

  const sourceFiles = collectSourceFiles(project.projectDir);
  const headerKeys = new Set();

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const headerCallMatch = text.match(/(?:set_table_header|setTableHeader)\s*\(([\s\S]*?)\)/);
    if (!headerCallMatch) {
      continue;
    }

    const headerBlock = headerCallMatch[1];
    const keyMatches = headerBlock.matchAll(/["']key["']\s*:\s*["']([^"']+)["']/g);
    for (const m of keyMatches) {
      headerKeys.add(m[1]);
    }
  }

  if (headerKeys.size === 0) {
    return [];
  }

  const issues = [];

  for (const key of headerKeys) {
    if (!outputNames.has(key)) {
      issues.push({
        severity: 'warn',
        code: 'runtime_header_not_in_output_schema_static',
        message: `set_table_header defines key "${key}" which is not declared in output_schema.json. Data pushed with this key may not display correctly.`,
        docs: ['worker-definition/output-schema.md', 'worker-definition/sdk-modules.md'],
        remediation: `Add this field to output_schema.json or remove it from set_table_header.`,
      });
    }
  }

  for (const name of outputNames) {
    if (!headerKeys.has(name)) {
      issues.push({
        severity: 'warn',
        code: 'output_schema_field_not_in_header',
        message: `output_schema.json declares column "${name}" but set_table_header does not define a matching key. This column will be empty in results.`,
        docs: ['worker-definition/output-schema.md'],
        remediation: `Add a header entry with key "${name}" to set_table_header, or remove the column from output_schema.json.`,
      });
    }
  }

  return issues;
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

const PYTHON_SOCKS_CAPABLE_CLIENTS = [
  // requests / httpx need PySocks for socks5:// URLs
  { client: 'requests', requires: ['pysocks', 'requests[socks]'] },
  { client: 'httpx', requires: ['pysocks', 'httpx[socks]', 'socksio'] },
  // aiohttp uses aiohttp-socks for SOCKS proxy support
  { client: 'aiohttp', requires: ['aiohttp-socks'] },
  // curl_cffi has built-in SOCKS support (libcurl), no extra dependency
  { client: 'curl_cffi', requires: [] },
];

function pythonSocksClientRequires(sourceFiles) {
  const requires = new Map();
  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!/socks[45]:\/\//.test(text)) continue;
    if (/\bimport\s+requests\b|\bfrom\s+requests\b|\brequests\.(get|post|put|patch|delete|head|request|Session)\b/.test(text)) {
      requires.set('requests', PYTHON_SOCKS_CAPABLE_CLIENTS.find((c) => c.client === 'requests'));
    }
    if (/\bimport\s+httpx\b|\bfrom\s+httpx\b|\bhttpx\.(get|post|put|patch|delete|head|request|Client|AsyncClient)\b/.test(text)) {
      requires.set('httpx', PYTHON_SOCKS_CAPABLE_CLIENTS.find((c) => c.client === 'httpx'));
    }
    if (/\bimport\s+aiohttp\b|\baiohttp\.(ClientSession|request)\b/.test(text)) {
      requires.set('aiohttp', PYTHON_SOCKS_CAPABLE_CLIENTS.find((c) => c.client === 'aiohttp'));
    }
    if (/\bimport\s+curl_cffi\b|\bfrom\s+curl_cffi\b|\bcurl_cffi\./.test(text)) {
      requires.set('curl_cffi', PYTHON_SOCKS_CAPABLE_CLIENTS.find((c) => c.client === 'curl_cffi'));
    }
  }
  return [...requires.values()];
}

export function validateSocksProxyDependencies(project) {
  if (project.language !== 'python') return [];
  const sourceFiles = collectSourceFiles(project.projectDir, project.projectDir, PYTHON_SOURCE_SCAN_EXTENSIONS);
  const clients = pythonSocksClientRequires(sourceFiles);
  if (clients.length === 0) return [];

  const depFile = path.join(project.projectDir, 'requirements.txt');
  if (!fs.existsSync(depFile)) {
    const names = clients.map((c) => c.client).sort().join(', ');
    const needed = clients.flatMap((c) => c.requires).filter((v, i, a) => a.indexOf(v) === i);
    return [{ severity: 'error', code: 'missing_socks_proxy_dependency', message: `Project builds SOCKS5 proxy URLs and uses ${names}, but requirements.txt does not exist. ${needed.length > 0 ? `Required SOCKS dependency: ${needed.join(' or ')}.` : ''} Cloud runs will fail with "Missing dependencies for SOCKS support".`, docs: [PROXY_SUPPORT_DOC], remediation: needed.length > 0 ? `Create requirements.txt with ${needed.map((n) => `"${n}"`).join(' or ')}.` : 'Create requirements.txt.' }];
  }
  const declared = readDeclaredDependencies('python', depFile);

  const missing = [];
  for (const client of clients) {
    if (client.requires.length === 0) continue;
    if (!client.requires.some((dep) => declared.has(dep))) {
      missing.push({ client: client.client, requires: client.requires });
    }
  }
  if (missing.length === 0) return [];
  const evidence = missing.map((m) => `${m.client} needs ${m.requires.map((n) => `"${n}"`).join(' or ')}`).join('; ');
  return [{ severity: 'error', code: 'missing_socks_proxy_dependency', message: `Project builds SOCKS5 proxy URLs but requirements.txt is missing the SOCKS dependency for the detected HTTP client(s): ${evidence}. Cloud runs will fail with "Missing dependencies for SOCKS support".`, docs: [PROXY_SUPPORT_DOC], remediation: missing.flatMap((m) => m.requires).filter((v, i, a) => a.indexOf(v) === i).map((n) => `Add "${n}" to requirements.txt.`).join(' ') }];
}

export function validateNodeSocksProxyDependencies(project) {
  if (project.language !== 'node') return [];
  const sourceFiles = collectSourceFiles(project.projectDir, project.projectDir, NODE_SOURCE_SCAN_EXTENSIONS);
  let usesSocksUrl = false;
  let usesSocksAgent = false;
  let usesAxios = false;
  let setsProxyFalse = false;
  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!usesSocksUrl && /socks[45]:\/\//.test(text)) usesSocksUrl = true;
    if (!usesSocksAgent && /socks-proxy-agent/.test(text)) usesSocksAgent = true;
    if (!usesAxios && /\brequire\s*\(\s*['"]axios['"]\s*\)|\bfrom\s+['"]axios['"]/.test(text)) usesAxios = true;
    if (!setsProxyFalse && /\bproxy\s*:\s*false\b/.test(text)) setsProxyFalse = true;
    if (usesSocksUrl && usesSocksAgent && usesAxios && setsProxyFalse) break;
  }
  if (!usesSocksUrl && !usesSocksAgent) return [];
  const issues = [];
  if (usesSocksAgent) {
    const packagePath = path.join(project.projectDir, 'package.json');
    if (!fs.existsSync(packagePath)) {
      issues.push({ severity: 'error', code: 'missing_socks_proxy_dependency', message: 'Project uses socks-proxy-agent, but package.json does not exist. Cloud runs will fail with a module not found error.', docs: [PROXY_SUPPORT_DOC], remediation: 'Add "socks-proxy-agent" to package.json dependencies.' });
    } else {
      const declared = readDeclaredDependencies('node', packagePath);
      if (!declared.has('socks-proxy-agent')) {
        issues.push({ severity: 'error', code: 'missing_socks_proxy_dependency', message: 'Project uses SOCKS5 proxy with socks-proxy-agent, but package.json does not declare "socks-proxy-agent". Cloud runs will fail with a module not found error.', docs: [PROXY_SUPPORT_DOC], remediation: 'Add "socks-proxy-agent" to package.json dependencies.' });
      }
    }
  }
  if (usesAxios && usesSocksAgent && !setsProxyFalse) {
    issues.push({
      severity: 'warn',
      code: 'axios_proxy_not_disabled',
      message: 'Project uses axios with a SOCKS proxy agent but does not set "proxy: false" on the axios config. axios applies its own HTTP proxy by default, which prevents the SOCKS agent from working. The docs require setting proxy=false in Node.js when using a SOCKS agent.',
      docs: [PROXY_SUPPORT_DOC],
      remediation: 'Add "proxy: false" to the axios config object alongside httpAgent/httpsAgent.',
    });
  }
  return issues;
}

export function validateHardcodedUserAgent(project) {
  const sourceFiles = collectSourceFiles(project.projectDir);
  const evidence = [];
  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    if (BROWSER_USER_AGENT_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))) {
      evidence.push(relativePath);
      if (evidence.length >= 5) break;
    }
  }
  if (evidence.length === 0) return [];
  return [{ severity: 'warn', code: 'hardcoded_user_agent', message: `Project overrides browser User-Agent settings (${evidence.join(', ')}). The platform provides browser fingerprinting; hardcoded browser User-Agent values may trigger anti-bot detection.`, docs: ['worker-definition/platform-features/browser-fingerprinting.md'], evidence: { files: evidence }, remediation: 'Remove browser User-Agent overrides and rely on the platform browser fingerprint environment instead.' }];
}

export function validateBrowserFrameworkDependencies(project) {
  const sourceFiles = collectSourceFiles(project.projectDir);
  const frameworks = BROWSER_FRAMEWORK_PATTERNS[project.language] ?? [];
  if (frameworks.length === 0) return [];
  const detected = new Map();
  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    for (const { pattern, packages } of frameworks) {
      if (pattern.test(text)) {
        for (const pkg of packages) {
          const usage = {
            file: relativePath,
            severity: browserFrameworkDependencySeverity(project.language, text, pkg),
          };
          const existing = detected.get(pkg);
          if (!existing || severityRank(usage.severity) > severityRank(existing.severity)) {
            detected.set(pkg, usage);
          }
        }
      }
    }
  }
  if (detected.size === 0) return [];
  const depFile = project.spec.dependencyFile;
  const depPath = path.join(project.projectDir, depFile);
  if (!fs.existsSync(depPath)) {
    return [...detected.entries()].map(([pkg, usage]) => missingBrowserFrameworkDependencyIssue(pkg, usage, depFile, false));
  }
  const declared = readDeclaredDependencies(project.language, depPath);
  const issues = [];
  for (const [pkg, usage] of detected) {
    const allVariants = frameworks.filter((f) => f.packages.includes(pkg)).flatMap((f) => f.packages);
    const hasAny = allVariants.some((v) => declared.has(v));
    if (!hasAny) {
      issues.push(missingBrowserFrameworkDependencyIssue(pkg, usage, depFile, true));
    }
  }
  return issues;
}

function browserFrameworkDependencySeverity(language, text, packageName) {
  if (language !== 'python') {
    return 'error';
  }
  const importRoot = PYTHON_BROWSER_IMPORT_ROOTS.get(packageName);
  if (!importRoot) {
    return 'error';
  }
  const root = escapeRegExp(importRoot);
  const topLevelImport = new RegExp(`^(?:from\\s+${root}(?:\\.|\\s+import\\b)|import\\s+${root}\\b)`, 'm');
  return topLevelImport.test(text) ? 'error' : 'warn';
}

function missingBrowserFrameworkDependencyIssue(pkg, usage, depFile, dependencyFileExists) {
  if (usage.severity === 'warn') {
    return {
      severity: 'warn',
      code: 'missing_browser_framework_dependency',
      message: `Project has optional or dynamic use of ${pkg} (${usage.file}) but ${depFile} does not declare "${pkg}". The worker can start, but any code path that imports this browser framework will fail unless the dependency is declared.`,
      docs: BROWSER_FRAMEWORK_DEPENDENCY_DOCS,
      remediation: `Add "${pkg}" to ${depFile}, or remove the unused browser automation code path.`,
    };
  }
  if (!dependencyFileExists) {
    return {
      severity: 'error',
      code: 'missing_browser_framework_dependency',
      message: `Project uses ${pkg} (${usage.file}) but ${depFile} does not exist. Cloud runs will fail with a module not found error.`,
      docs: BROWSER_FRAMEWORK_DEPENDENCY_DOCS,
      remediation: `Create ${depFile} and add "${pkg}" as a dependency.`,
    };
  }
  return {
    severity: 'error',
    code: 'missing_browser_framework_dependency',
    message: `Project uses ${pkg} (${usage.file}) but ${depFile} does not declare "${pkg}". Cloud runs will fail with ModuleNotFoundError.`,
    docs: BROWSER_FRAMEWORK_DEPENDENCY_DOCS,
    remediation: `Add "${pkg}" to ${depFile}.`,
  };
}

function severityRank(severity) {
  return severity === 'error' ? 2 : 1;
}

export function validateProtobufVersionMatch(project) {
  if (project.language !== 'python') return [];
  const depPath = path.join(project.projectDir, 'requirements.txt');
  if (!fs.existsSync(depPath)) return [];
  const text = fs.readFileSync(depPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(protobuf(?:\[.*\])?)\s*(?:(==|>=|<=|~=|!=)\s*(.+))?$/i);
    if (match) {
      const operator = match[2];
      if (operator === '==' || operator === '~=') return [];
      return [{ severity: 'warn', code: 'protobuf_version_not_pinned', message: 'requirements.txt declares protobuf without a pinned version (e.g., protobuf==5.29.0). The protobuf version must match the one used to generate sdk_pb2.py; unpinned versions may cause deserialization errors in cloud runs.', docs: PROTOBUF_VERSION_DOCS, remediation: 'Check the version comment in sdk_pb2.py and pin protobuf to that exact version in requirements.txt (e.g., protobuf==5.29.0).' }];
    }
  }
  return [];
}

function stripJsonBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const CAMOUFOX_DOC = 'worker-definition/browser-automation/camoufox.md';
const CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION = '1.49.1';
const UPSERT_DOC = 'worker-definition/output-schema.md';
const SDK_MODULES_DOC = 'worker-definition/sdk-modules.md';

export function validateCamoufoxPlaywrightVersion(project) {
  if (project.language !== 'python') return [];
  const scan = scanSourceForBrowserContract(project.projectDir, project.language);
  if (!scan.usesBrowserAutomation || !scan.observedEnv.includes('CamoufoxDomain')) {
    return [];
  }

  const depPath = path.join(project.projectDir, 'requirements.txt');
  if (!fs.existsSync(depPath)) {
    return [{
      severity: 'error',
      code: 'camoufox_playwright_not_pinned',
      message: `Project reads CamoufoxDomain but requirements.txt is missing. Camoufox workers must pin playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION} (camoufox.md).`,
      docs: [CAMOUFOX_DOC],
      remediation: `Create requirements.txt and pin "playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION}".`,
    }];
  }

  const text = fs.readFileSync(depPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^playwright(?:\[[^\]]*\])?\s*(?:(==|>=|<=|~=|!=)\s*(.+))?$/i);
    if (!match) continue;
    const operator = match[1];
    const version = (match[2] ?? '').trim();
    if (operator === '==' && version === CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION) {
      return [];
    }
    return [{
      severity: 'error',
      code: 'camoufox_playwright_not_pinned',
      message: `Camoufox workers must pin playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION} in requirements.txt, but found "playwright${operator ? operator + version : ''}". Camoufox connects through Playwright Firefox and only the documented version is validated against the platform-hosted backend (camoufox.md).`,
      docs: [CAMOUFOX_DOC],
      remediation: `Pin "playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION}" in requirements.txt.`,
    }];
  }

  return [{
    severity: 'error',
    code: 'camoufox_playwright_not_pinned',
    message: `Camoufox workers must declare playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION} in requirements.txt, but playwright is not declared. Camoufox connects through Playwright Firefox (camoufox.md).`,
    docs: [CAMOUFOX_DOC],
    remediation: `Add "playwright==${CAMOUFOX_REQUIRED_PLAYWRIGHT_VERSION}" to requirements.txt.`,
  }];
}

const UPSERT_CALL_PATTERN = /\b(?:upsert_data|upsertData|UpsertData)\s*\(/g;
const UPSERT_KEY_LITERAL_PATTERN = /['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/;

export function validateUpsertUniqueKey(project) {
  const outputPath = path.join(project.projectDir, 'output_schema.json');
  if (!fs.existsSync(outputPath)) return [];
  const outputSchema = readJson(outputPath);
  if (!Array.isArray(outputSchema)) return [];

  const outputNames = new Set(
    outputSchema
      .filter((col) => typeof col?.name === 'string')
      .map((col) => col.name),
  );

  const issues = [];
  const reported = new Set();
  for (const filePath of collectSourceFiles(project.projectDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    UPSERT_CALL_PATTERN.lastIndex = 0;
    let callMatch;
    while ((callMatch = UPSERT_CALL_PATTERN.exec(text)) !== null) {
      const callStart = callMatch.index;
      const tail = text.slice(callStart);
      const keyMatch = tail.match(UPSERT_KEY_LITERAL_PATTERN);
      if (!keyMatch) continue;
      const key = keyMatch[1];
      if (reported.has(key)) continue;
      if (!outputNames.has(key)) {
        reported.add(key);
        issues.push({
          severity: 'error',
          code: 'upsert_unique_key_not_in_output_schema',
          message: `Source calls upsert with unique key "${key}" (in ${relativePath}) but output_schema.json has no column named "${key}". The platform needs this column to match and update existing rows; upsert_data will fail to deduplicate without it.`,
          docs: [UPSERT_DOC],
          evidence: { upsert_key: key, source_file: relativePath },
          remediation: `Add a column {"name": "${key}", "type": "..."} to output_schema.json, or change the upsert unique key to an existing column name.`,
        });
      }
    }
  }
  return issues;
}

const HEADER_CALL_PATTERN = /\b(?:set_table_header|setTableHeader|SetTableHeader)\s*\(/g;
const PUSH_DATA_CALL_PATTERN = /\b(?:push_data|pushData|PushData)\s*\(/g;

export function validateHeaderBeforePush(project) {
  const issues = [];
  for (const filePath of collectSourceFiles(project.projectDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    let firstHeader = null;
    let firstPush = null;
    HEADER_CALL_PATTERN.lastIndex = 0;
    let m;
    while ((m = HEADER_CALL_PATTERN.exec(text)) !== null) {
      if (firstHeader === null) firstHeader = m.index;
    }
    PUSH_DATA_CALL_PATTERN.lastIndex = 0;
    while ((m = PUSH_DATA_CALL_PATTERN.exec(text)) !== null) {
      if (firstPush === null) firstPush = m.index;
    }
    if (firstHeader !== null && firstPush !== null && firstHeader > firstPush) {
      issues.push({
        severity: 'warn',
        code: 'push_data_before_table_header',
        message: `${relativePath} calls push_data before set_table_header. The SDK requires the table header to be defined before the first data push so the platform can render columns correctly.`,
        docs: [SDK_MODULES_DOC, UPSERT_DOC],
        evidence: { source_file: relativePath },
        remediation: 'Move the set_table_header call ahead of any push_data call in this file.',
      });
    }
  }
  return issues;
}

const HARDCODED_PROXY_CREDENTIAL_PATTERN = /socks[45]:\/\/[^\s'"\/@]*:[^\s'"\/@]*@/;

export function validateHardcodedProxyCredentials(project) {
  const evidence = [];
  for (const filePath of collectSourceFiles(project.projectDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (HARDCODED_PROXY_CREDENTIAL_PATTERN.test(line)) {
        evidence.push({ file: relativePath, line: index + 1 });
        if (evidence.length >= 5) break;
      }
    }
    if (evidence.length >= 5) break;
  }
  if (evidence.length === 0) return [];
  const files = [...new Set(evidence.map((item) => item.file))].sort();
  return [{
    severity: 'error',
    code: 'hardcoded_proxy_credentials',
    message: `Project hardcodes proxy credentials in a SOCKS URL (${files.join(', ')}). The docs require reading platform-injected PROXY_AUTH at runtime; hardcoded credentials leak secrets and will not match the platform proxy.`,
    docs: [PROXY_SUPPORT_DOC],
    evidence: { files: evidence },
    remediation: 'Replace the hardcoded credentials with process.env.PROXY_AUTH / os.environ.get("PROXY_AUTH") and build the SOCKS URL at runtime.',
  }];
}

// ── New validators added based on runtime testing of 12 worker scripts ──

const HARDCODED_API_KEY_PATTERNS = [
  /['"](?:scraper_api|coreclaw_api|api_key|apikey|access_token)['"]\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i,
  /\bscraper_api_[A-Z0-9]{10,}/,
  /['"]Bearer\s+[a-zA-Z0-9._-]{20,}['"]/,
  /get_api_key\(\)\s*[\s\S]{0,200}return\s+['"][a-zA-Z0-9._-]{16,}['"]/,
];

/**
 * Detect hardcoded API keys / tokens in source code.
 * Hardcoded secrets are a security risk and will not match the platform-injected credentials.
 */
export function validateHardcodedApiKeys(project) {
  const evidence = [];
  for (const filePath of collectSourceFiles(project.projectDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    // Skip sdk files
    if (relativePath.startsWith('sdk') || relativePath.includes('/sdk')) continue;
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const pattern of HARDCODED_API_KEY_PATTERNS) {
        if (pattern.test(line)) {
          evidence.push({ file: relativePath, line: index + 1, snippet: line.trim().slice(0, 120) });
          if (evidence.length >= 5) break;
        }
      }
      if (evidence.length >= 5) break;
    }
    if (evidence.length >= 5) break;
  }
  if (evidence.length === 0) return [];
  const files = [...new Set(evidence.map((item) => item.file))].sort();
  return [{
    severity: 'error',
    code: 'hardcoded_api_key',
    message: `Project contains hardcoded API keys or tokens (${files.join(', ')}). Hardcoded secrets are a security risk and will not match the platform-injected credentials at runtime. Use environment variables or the platform SDK context instead.`,
    docs: ['worker-definition/platform-features/proxy-support.md'],
    evidence: { files: evidence },
    remediation: 'Remove hardcoded API keys. Read credentials from environment variables (e.g., os.environ.get("API_KEY")) or use the platform SDK context for Worker-to-Worker calls.',
  }];
}

/**
 * Detect aiohttp usage without SOCKS5 proxy configuration.
 * In CoreClaw sandbox, direct HTTP connections are blocked; aiohttp needs aiohttp_socks proxy.
 */
export function validateAiohttpWithoutProxy(project) {
  if (project.language !== 'python') return [];
  const sourceFiles = collectSourceFiles(project.projectDir);
  const evidence = [];

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');

    const usesAiohttp = /\bimport\s+aiohttp\b/.test(text) || /\baiohttp\.ClientSession\b/.test(text);
    if (!usesAiohttp) continue;

    const hasAiohttpSocks = /\baiohttp_socks\b/.test(text) || /\bProxyConnector\b/.test(text);
    const hasSocksProxy = /\bsocks5:\/\//.test(text) && /\bproxy\b/i.test(text);

    if (!hasAiohttpSocks && !hasSocksProxy) {
      evidence.push(relativePath);
    }
  }

  if (evidence.length === 0) return [];
  return [{
    severity: 'error',
    code: 'aiohttp_without_proxy',
    message: `Project uses aiohttp for HTTP requests (${evidence.join(', ')}) but does not configure SOCKS5 proxy. CoreClaw sandbox blocks direct outbound connections; aiohttp requests will fail silently without proxy configuration. Use aiohttp_socks.ProxyConnector or switch to requests + socks5 proxy.`,
    docs: [PROXY_SUPPORT_DOC, 'worker-definition/examples/python-example.md'],
    evidence: { files: evidence },
    remediation: 'Either: (1) Add aiohttp_socks dependency and configure ProxyConnector with socks5://PROXY_AUTH@PROXY_DOMAIN, or (2) switch to requests library with socks5 proxy (recommended pattern in CoreClaw examples).',
  }];
}

/**
 * Detect asyncio.run() usage that may conflict with the platform's event loop.
 * If the platform SDK is already running in an event loop, asyncio.run() will fail.
 */
export function validateAsyncioRunWithSdk(project) {
  if (project.language !== 'python') return [];
  const sourceFiles = collectSourceFiles(project.projectDir);
  const evidence = [];

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    if (relativePath.startsWith('sdk')) continue;

    if (/\basyncio\.run\s*\(/.test(text) && /\bCoreSDK\b/.test(text)) {
      evidence.push(relativePath);
    }
  }

  if (evidence.length === 0) return [];
  return [{
    severity: 'warn',
    code: 'asyncio_run_with_sdk',
    message: `Project calls asyncio.run() (${evidence.join(', ')}) while also using CoreSDK. If the platform SDK is already running in an event loop, asyncio.run() will raise RuntimeError. Consider using synchronous HTTP (requests) or running async code via the platform's async support.`,
    docs: ['worker-definition/examples/python-example.md'],
    evidence: { files: evidence },
    remediation: 'Replace asyncio.run() with synchronous requests library calls, or use the platform documented async pattern.',
  }];
}

const WORKER_SLUG_REFERENCE_PATTERN = /trigger_worker|callWorker|context\.callWorker|\/workers\/.+?\/runs/;

/**
 * Detect external Worker slug references that may not exist on the platform.
 */
export function validateExternalWorkerSlugs(project) {
  const sourceFiles = collectSourceFiles(project.projectDir);
  const slugs = new Set();
  const evidence = [];

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    if (relativePath.startsWith('sdk')) continue;

    if (!WORKER_SLUG_REFERENCE_PATTERN.test(text)) continue;

    // Pattern 1: trigger_worker(api_key, "slug", ...) — slug as string literal
    let match;
    const slugLiteralPattern = /trigger_worker\s*\(\s*[^,]+,\s*['"]([a-zA-Z0-9_-]+)['"]/g;
    while ((match = slugLiteralPattern.exec(text)) !== null) {
      slugs.add(match[1]);
      evidence.push({ file: relativePath, slug: match[1], pattern: 'trigger_worker' });
    }

    // Pattern 2: WORKER_SLUG = "01KPAFF816MDMRD5MSCH2SBT68" — slug as constant
    const slugConstPattern = /(?:_SLUG|_WORKER)\s*=\s*['"]([a-zA-Z0-9_-]{10,})['"]/g;
    while ((match = slugConstPattern.exec(text)) !== null) {
      slugs.add(match[1]);
      evidence.push({ file: relativePath, slug: match[1], pattern: 'constant' });
    }

    // Pattern 3: /workers/{slug}/runs — slug in URL path
    const slugUrlPattern = /\/workers\/([a-zA-Z0-9_-]+)\/runs/g;
    while ((match = slugUrlPattern.exec(text)) !== null) {
      // Skip template variables like {worker_slug}
      if (match[1].startsWith('{')) continue;
      slugs.add(match[1]);
      evidence.push({ file: relativePath, slug: match[1], pattern: 'url_path' });
    }
  }

  if (evidence.length === 0) return [];
  return [{
    severity: 'warn',
    code: 'external_worker_slug_reference',
    message: `Project references external Worker slugs (${[...slugs].join(', ')}). These slugs must exist on the platform at runtime; if the referenced Worker is unavailable or renamed, the call will fail silently. Verify these slugs are correct and the Workers are deployed.`,
    docs: ['worker-definition/sdk-modules.md'],
    evidence: { slugs: [...slugs], files: evidence },
    remediation: 'Verify the referenced Worker slugs exist on the platform. Add error handling for failed Worker calls (check run_slug is not None/empty).',
  }];
}

const DYNAMIC_CSS_CLASS_PATTERN = /[a-z][a-z0-9]*__[a-z0-9]{6,}__[a-z]+/i;

/**
 * Detect CSS selectors that use dynamically-generated class names (e.g., CSS Modules hashes).
 * These class names change on every frontend deployment and will break scraping.
 */
export function validateDynamicCssSelectors(project) {
  const sourceFiles = collectSourceFiles(project.projectDir);
  const evidence = [];

  for (const filePath of sourceFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(project.projectDir, filePath).replaceAll(path.sep, '/');
    if (relativePath.startsWith('sdk')) continue;

    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      // Look for CSS selectors with dynamic hash patterns in select() / select_one() calls
      if ((/\bselect(?:_one)?\s*\(/.test(line) || /\bselectors?\b/.test(line)) && DYNAMIC_CSS_CLASS_PATTERN.test(line)) {
        evidence.push({ file: relativePath, line: index + 1 });
        if (evidence.length >= 5) break;
      }
    }
    if (evidence.length >= 5) break;
  }

  if (evidence.length === 0) return [];
  const files = [...new Set(evidence.map((item) => item.file))].sort();
  return [{
    severity: 'warn',
    code: 'dynamic_css_class_selector',
    message: `CSS selectors use dynamically-generated class names (${files.join(', ')}). These class names (e.g., businessName__09f24__EAYoJ) are typically CSS Modules hashes that change on every frontend deployment, causing the scraper to silently return 0 results. Prefer stable selectors: data attributes, semantic HTML tags, or aria-labels.`,
    docs: [],
    evidence: { files: evidence },
    remediation: 'Replace dynamic class selectors with stable alternatives: [data-testid], semantic tags (h2, article), aria-label attributes, or URL-based patterns. If dynamic classes are unavoidable, add fallback selectors.',
  }];
}
