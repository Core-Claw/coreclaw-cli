import fs from 'node:fs';
import path from 'node:path';
import { CliError } from '../utils/errors.js';
import { formatBytes, parseSizeBytes } from '../utils/bytes.js';
import { resolveProjectPath } from '../utils/paths.js';
import { previewUploadFiles } from '../pack/zip.js';
import { prepareUploadProject } from '../pack/upload-project.js';
import { formatIssues, validateProject } from '../validation/project.js';

export const DEFAULT_MAX_PACKAGE_SIZE_BYTES = 50 * 1000 * 1000;
const LARGEST_ENTRY_COUNT = 5;

const PACKAGE_SPECS = {
  python: {
    label: 'Python',
    entry: 'main.py',
    requiredRoot: ['main.py', 'requirements.txt', 'input_schema.json', 'sdk.py', 'sdk_pb2.py', 'sdk_pb2_grpc.py'],
    recommendedRoot: ['README.md', 'output_schema.json'],
  },
  node: {
    label: 'Node.js',
    entry: 'main.js',
    requiredRoot: ['main.js', 'package.json', 'input_schema.json', 'sdk.js', 'sdk_pb.js', 'sdk_grpc_pb.js'],
    recommendedRoot: ['README.md', 'output_schema.json'],
  },
  go: {
    label: 'Go',
    entry: 'main',
    requiredRoot: ['main', 'input_schema.json'],
    recommendedRoot: ['output_schema.json'],
    executableRoot: 'main',
    executableMode: 0o100755,
  },
};

export async function inspectPackageCommand(packagePath, options = {}) {
  if (!packagePath) {
    throw new CliError('inspect-package requires a ZIP file path.');
  }

  const report = inspectPackage(path.resolve(process.cwd(), packagePath));
  Object.assign(report, validatePackageReport(report, options));
  if (options.project) {
    report.manifest_comparison = comparePackageManifest(report, options.project, options);
    report.issues.push(...manifestComparisonIssues(report.manifest_comparison));
    report.ok = !report.issues.some((issue) => issue.severity === 'error');
  }
  printPackageReport(report);
  enforcePackageGates(report, options);
  return report;
}

export function inspectPackage(packagePath) {
  if (!fs.existsSync(packagePath)) {
    throw new CliError(`Package file does not exist: ${packagePath}`);
  }
  const data = fs.readFileSync(packagePath);
  const entries = readCentralDirectory(data);
  const totalUncompressedSize = entries.reduce((total, entry) => total + entry.uncompressed_size, 0);
  return {
    package_path: packagePath,
    package_size: data.length,
    package_size_human: formatBytes(data.length),
    entry_count: entries.length,
    root_entries: entries
      .filter((entry) => !entry.name.includes('/') && !entry.name.endsWith('/'))
      .map((entry) => entry.name)
      .sort(),
    root_directories: Array.from(new Set(entries
      .map((entry) => firstPathSegment(entry.name))
      .filter(Boolean)))
      .sort(),
    entries,
    largest_entries: largestEntries(entries),
    total_compressed_size: entries.reduce((total, entry) => total + entry.compressed_size, 0),
    total_uncompressed_size: totalUncompressedSize,
    total_uncompressed_size_human: formatBytes(totalUncompressedSize),
  };
}

export function validatePackageReport(report, options = {}) {
  const language = resolvePackageLanguage(report, options.language);
  if (!language) {
    return {
      language: null,
      language_label: null,
      issues: [],
      ok: true,
    };
  }

  const spec = PACKAGE_SPECS[language];
  const issues = [];
  const rootEntries = new Set(report.root_entries);
  const maxPackageSize = parseMaxPackageSize(options.maxPackageSize);

  for (const requiredEntry of spec.requiredRoot) {
    if (rootEntries.has(requiredEntry)) {
      continue;
    }

    issues.push(missingRootIssue(report, language, requiredEntry));
  }

  for (const recommendedEntry of spec.recommendedRoot) {
    if (!rootEntries.has(recommendedEntry)) {
      issues.push({
        severity: 'warn',
        code: 'package_missing_recommended_root_entry',
        message: `${spec.label} upload ZIP is missing recommended root entry "${recommendedEntry}". CoreClaw currently keeps compatibility for some older workers, but docs describe this file as upload-ready project metadata.`,
      });
    }
  }

  if (spec.executableRoot && rootEntries.has(spec.executableRoot)) {
    const entry = report.entries.find((item) => item.name === spec.executableRoot);
    if (entry.mode !== spec.executableMode) {
      issues.push({
        severity: 'error',
        code: 'package_go_main_not_executable',
        message: `Go upload ZIP root "main" mode must be 100755, got ${entry.mode_octal}.`,
      });
    }
  }

  if (maxPackageSize !== null && report.package_size > maxPackageSize) {
    issues.push({
      severity: 'warn',
      code: 'package_size_exceeds_threshold',
      message: `Upload ZIP size is ${formatBytes(report.package_size)}, which exceeds the local advisory threshold ${formatBytes(maxPackageSize)}. CoreClaw installs dependencies from requirements.txt/package.json, so keep upload packages focused on source, SDK files, schemas, and required runtime assets.`,
      evidence: {
        package_size: report.package_size,
        max_package_size: maxPackageSize,
      },
      remediation: 'Remove generated artifacts, caches, bundled dependencies, old ZIP files, and unused runtime assets. For Go Workers, consider UPX compression when the compiled main binary is large.',
    });
  }

  return {
    language,
    language_label: spec.label,
    issues,
    ok: !issues.some((issue) => issue.severity === 'error'),
  };
}

export function comparePackageManifest(report, projectPath, options = {}) {
  const projectDir = resolveProjectPath(projectPath);
  const project = validateProject(projectDir);
  if (!project.ok) {
    const details = formatIssues(project.issues);
    throw new CliError(`Cannot compare package manifest because project validation failed.${details ? `\n${details}` : ''}`);
  }
  if (report.language && report.language !== project.language) {
    throw new CliError(`Package language "${report.language}" does not match project language "${project.language}".`);
  }

  const uploadProject = prepareUploadProject(project, options);
  try {
    const expectedEntries = previewUploadFiles(uploadProject.projectDir).sort();
    const packageEntries = packageFileEntries(report).sort();
    const expectedSet = new Set(expectedEntries);
    const packageSet = new Set(packageEntries);
    const missingFromPackage = expectedEntries.filter((entry) => !packageSet.has(entry));
    const extraInPackage = packageEntries.filter((entry) => !expectedSet.has(entry));

    return {
      project_dir: projectDir,
      expected_entry_count: expectedEntries.length,
      package_entry_count: packageEntries.length,
      matching_entry_count: expectedEntries.length - missingFromPackage.length,
      missing_from_package: missingFromPackage,
      extra_in_package: extraInPackage,
      ok: missingFromPackage.length === 0 && extraInPackage.length === 0,
    };
  } finally {
    uploadProject.cleanup();
  }
}

export function manifestComparisonIssues(comparison) {
  const issues = [];
  if ((comparison?.missing_from_package?.length ?? 0) > 0) {
    issues.push({
      severity: 'error',
      code: 'package_manifest_missing_entries',
      message: `Upload ZIP is missing ${comparison.missing_from_package.length} file(s) expected from the project upload manifest: ${formatEntryList(comparison.missing_from_package)}.`,
      evidence: {
        project_dir: comparison.project_dir,
        missing_from_package: comparison.missing_from_package,
      },
      remediation: 'Recreate the ZIP from the project root with coreclaw pack, or add the missing runtime source/assets before uploading.',
    });
  }
  if ((comparison?.extra_in_package?.length ?? 0) > 0) {
    issues.push({
      severity: 'warn',
      code: 'package_manifest_extra_entries',
      message: `Upload ZIP contains ${comparison.extra_in_package.length} file(s) not produced by the project upload manifest: ${formatEntryList(comparison.extra_in_package)}.`,
      evidence: {
        project_dir: comparison.project_dir,
        extra_in_package: comparison.extra_in_package,
      },
      remediation: 'Remove local examples, stale archives, caches, generated output, or other non-upload files from the ZIP.',
    });
  }
  return issues;
}

function printPackageReport(report) {
  console.log(`Package: ${report.package_path}`);
  if (report.language_label) {
    console.log(`Language: ${report.language_label}`);
  }
  console.log(`Size: ${report.package_size_human}`);
  console.log(`Entries: ${report.entry_count}`);
  if ((report.largest_entries ?? []).length > 0) {
    console.log('Largest entries:');
    for (const entry of report.largest_entries) {
      console.log(`  ${entry.name} (uncompressed ${entry.uncompressed_size_human}, compressed ${entry.compressed_size_human})`);
    }
  }
  console.log(`Root entries: ${report.root_entries.join(', ') || '(none)'}`);
  if (report.root_directories.length > 0) {
    console.log(`Root directories: ${report.root_directories.join(', ')}`);
  }
  const main = report.entries.find((entry) => entry.name === 'main');
  if (main) {
    console.log(`Root main mode: ${main.mode_octal}`);
  }
  if (report.manifest_comparison) {
    printManifestComparison(report.manifest_comparison);
  }
  for (const issue of report.issues ?? []) {
    const marker = issue.severity === 'error' ? 'ERROR' : 'WARN';
    console.log(`[${marker}] ${issue.message}`);
  }
}

function printManifestComparison(comparison) {
  console.log(`Manifest comparison: ${comparison.project_dir}`);
  console.log(`  Expected upload entries: ${comparison.expected_entry_count}`);
  console.log(`  Matching entries: ${comparison.matching_entry_count}`);
  console.log(`  Missing from package: ${comparison.missing_from_package.length ? formatEntryList(comparison.missing_from_package) : '(none)'}`);
  console.log(`  Extra in package: ${comparison.extra_in_package.length ? formatEntryList(comparison.extra_in_package) : '(none)'}`);
}

function parseMaxPackageSize(value) {
  if (value === false || value === '0' || value === 0) {
    return null;
  }
  return parseSizeBytes(value ?? DEFAULT_MAX_PACKAGE_SIZE_BYTES, '--max-package-size');
}

export function enforcePackageGates(report, options = {}) {
  if (report.ok === false) {
    throw new CliError('Package validation failed. See package issues above.');
  }
  if (options.strict) {
    const warnings = (report.issues ?? []).filter((issue) => issue.severity === 'warn');
    if (warnings.length > 0) {
      const codes = [...new Set(warnings.map((issue) => issue.code).filter(Boolean))].sort();
      const suffix = codes.length > 0 ? ` Issue codes: ${codes.join(', ')}.` : '';
      throw new CliError(`Package validation found ${warnings.length} warning(s) and --strict is enabled.${suffix}`);
    }
  }
}

function resolvePackageLanguage(report, languageOption) {
  const explicit = normalizeLanguage(languageOption);
  if (explicit) {
    return explicit;
  }

  const rootMatches = Object.entries(PACKAGE_SPECS)
    .filter(([, spec]) => report.root_entries.includes(spec.entry))
    .map(([language]) => language);

  if (rootMatches.length === 1) {
    return rootMatches[0];
  }

  if (rootMatches.length > 1) {
    throw new CliError(`Upload ZIP contains multiple CoreClaw root entries (${rootMatches.map((language) => PACKAGE_SPECS[language].entry).join(', ')}). Pass --language python, --language node, or --language go.`);
  }

  const nested = findAnyNestedCoreClawEntry(report);
  if (nested) {
    throw new CliError(`Upload ZIP has no CoreClaw entry file at the archive root. Found "${nested}" instead, so the ZIP appears to include the worker directory itself. Zip the contents of the worker directory, not the directory wrapper.`);
  }

  if (report.root_entries.includes('main.go')) {
    throw new CliError('Upload ZIP has source "main.go" at the root, but Go uploads must include the compiled Linux amd64 executable "main" at the root. Pass --language go for the full Go package check.');
  }

  throw new CliError('Upload ZIP has no CoreClaw entry file at the archive root. Expected one of "main.py", "main.js", or compiled Go executable "main".');
}

function normalizeLanguage(language) {
  if (language === undefined || language === null || language === '') {
    return null;
  }
  const value = String(language).toLowerCase();
  if (['python', 'py'].includes(value)) {
    return 'python';
  }
  if (['node', 'nodejs', 'javascript', 'js'].includes(value)) {
    return 'node';
  }
  if (['go', 'golang'].includes(value)) {
    return 'go';
  }
  throw new CliError(`Unsupported package language "${language}". Use python, node, or go.`);
}

function missingRootIssue(report, language, requiredEntry) {
  const spec = PACKAGE_SPECS[language];
  const nested = findNestedEntry(report, requiredEntry);
  if (nested) {
    return {
      severity: 'error',
      code: 'package_entry_nested',
      message: `${spec.label} upload ZIP is missing required root entry "${requiredEntry}", but found "${nested}". The ZIP appears to include the worker directory itself. Zip the contents of the worker directory so required files are at the archive root.`,
    };
  }

  if (language === 'go' && requiredEntry === 'main' && report.root_entries.includes('main.go')) {
    return {
      severity: 'error',
      code: 'package_go_source_without_binary',
      message: 'Go upload ZIP has source "main.go" but is missing the compiled Linux amd64 executable "main" at the root. Build with CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main ./main.go, then package the compiled "main".',
    };
  }

  return {
    severity: 'error',
    code: 'package_missing_required_root_entry',
    message: `${spec.label} upload ZIP is missing required root entry "${requiredEntry}".`,
  };
}

function findNestedEntry(report, requiredEntry) {
  return report.entries
    .map((entry) => entry.name)
    .find((name) => name.endsWith(`/${requiredEntry}`)) ?? null;
}

function findAnyNestedCoreClawEntry(report) {
  const entries = new Set(Object.values(PACKAGE_SPECS).flatMap((spec) => [spec.entry, ...spec.requiredRoot]));
  return report.entries
    .map((entry) => entry.name)
    .find((name) => {
      const segments = name.split('/').filter(Boolean);
      return segments.length > 1 && entries.has(segments.at(-1));
    }) ?? null;
}

function firstPathSegment(name) {
  const segments = name.split('/').filter(Boolean);
  return segments.length > 1 ? segments[0] : null;
}

function packageFileEntries(report) {
  return report.entries
    .filter((entry) => !entry.name.endsWith('/'))
    .map((entry) => entry.name);
}

function largestEntries(entries, limit = LARGEST_ENTRY_COUNT) {
  return entries
    .filter((entry) => !entry.name.endsWith('/'))
    .slice()
    .sort((left, right) => {
      const sizeDiff = right.uncompressed_size - left.uncompressed_size;
      return sizeDiff === 0 ? left.name.localeCompare(right.name) : sizeDiff;
    })
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      compressed_size: entry.compressed_size,
      compressed_size_human: formatBytes(entry.compressed_size),
      uncompressed_size: entry.uncompressed_size,
      uncompressed_size_human: formatBytes(entry.uncompressed_size),
    }));
}

function formatEntryList(entries, limit = 8) {
  const shown = entries.slice(0, limit);
  const suffix = entries.length > limit ? `, ... (+${entries.length - limit} more)` : '';
  return `${shown.join(', ')}${suffix}`;
}

function readCentralDirectory(data) {
  const endOffset = findEndOfCentralDirectory(data);
  const entryCount = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) {
      throw new CliError('Invalid ZIP central directory.');
    }
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const attributes = data.readUInt32LE(cursor + 38);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    const mode = attributes >>> 16;
    entries.push({
      name,
      mode,
      mode_octal: mode.toString(8).padStart(6, '0'),
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(data) {
  for (let offset = data.length - 22; offset >= 0; offset -= 1) {
    if (data.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new CliError('ZIP end of central directory not found.');
}
