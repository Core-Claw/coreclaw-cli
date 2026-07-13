import path from 'node:path';
import {
  createClientFromOptions,
  parseDurationMs,
  parsePositiveInteger,
  pollRunUntilTerminal,
  readInputJson,
  writeJsonOutput,
} from './cloud-utils.js';
import { compareCommand } from './compare.js';
import { releaseCommand } from './release.js';
import { runsCommand } from './runs.js';
import { verifyCommand } from './verify.js';
import { CliError } from '../utils/errors.js';
import { printJson, shouldPrintJson, withJsonProgressOnStderr } from '../utils/output.js';

export async function proveCommand(projectPath = '.', options = {}) {
  const result = await withJsonProgressOnStderr(options, () => proveCommandInternal(projectPath, {
    ...options,
    jsonOutput: false,
  }));
  if (shouldPrintJson(options)) {
    printJson(result);
  }
  return result;
}

async function proveCommandInternal(projectPath = '.', options = {}) {
  if (!options.scraperSlug) {
    throw new CliError('coreclaw prove: --scraper-slug is required.');
  }
  if (!options.cloudInput) {
    throw new CliError('coreclaw prove: --cloud-input is required.');
  }

  const verifyImpl = options.verifyImpl ?? verifyCommand;
  const compareImpl = options.compareImpl ?? compareCommand;
  const collectImpl = options.collectImpl ?? runsCommand;
  const releaseImpl = options.releaseImpl ?? releaseCommand;
  const client = createClientFromOptions(options);
  const cloudInput = readInputJson(options.cloudInput, '--cloud-input');

  console.log(`CoreClaw proof: ${path.resolve(process.cwd(), projectPath)}`);
  console.log(`Worker: ${options.scraperSlug}`);

  console.log('\n[1/4] Running local upload preflight...');
  const local = await verifyImpl(projectPath, buildProveVerifyOptions(options));
  const localRunDir = local.run_dir;
  if (!localRunDir) {
    throw new CliError('Local preflight did not return a run directory, so cloud comparison cannot continue.');
  }

  console.log('\n[2/4] Starting CoreClaw cloud run...');
  const version = await resolveWorkerVersion(client, options.scraperSlug, options.version);
  const runResponse = await client.runWorker(options.scraperSlug, {
    version,
    input: cloudInput,
    callbackUrl: options.callbackUrl,
    isAsync: true,
  });
  const runSlug = runResponse.data?.run_slug;
  if (!runSlug) {
    throw new CliError('CoreClaw cloud run response did not include data.run_slug.');
  }
  console.log(`Cloud run: ${runSlug}`);

  console.log('\n[3/4] Waiting for cloud run and saving results...');
  const detail = await pollRunUntilTerminal(client, runSlug, {
    timeoutMs: parseDurationMs(options.waitTimeout ?? '10m', '--wait-timeout'),
    pollIntervalMs: parseDurationMs(options.pollInterval ?? '5s', '--poll-interval'),
    sleepImpl: options.sleepImpl,
    nowImpl: options.nowImpl,
  });
  if (String(detail.status ?? '').toLowerCase() !== 'succeeded') {
    throw new CliError(`CoreClaw cloud run ${runSlug} ended with status ${detail.status}. Check logs with "coreclaw runs logs ${runSlug}".`);
  }

  const resultsResponse = await client.listWorkerRunResults(runSlug, {
    offset: parsePositiveInteger(options.pageIndex, 1, '--page-index') - 1,
    limit: parsePositiveInteger(options.pageSize, 100, '--page-size'),
  });
  const cloudResultsPath = resolveCloudResultsPath(localRunDir, options);
  writeJsonOutput(cloudResultsPath, resultsResponse);
  console.log(`Cloud results: ${cloudResultsPath}`);

  console.log('\n[4/4] Comparing cloud output with local output...');
  const compareOutput = resolveCompareOutput(localRunDir, options);
  const compareReport = await compareImpl(
    cloudResultsPath,
    localRunDir,
    buildProveCompareOptions(options, compareOutput),
  );

  const delivery = await buildProveDeliveryArtifacts(projectPath, {
    options,
    collectImpl,
    releaseImpl,
    runSlug,
    local,
    localRunDir,
    compareOutput,
  });

  const result = {
    ok: true,
    project_dir: path.resolve(process.cwd(), projectPath),
    local,
    cloud: {
      scraper_slug: options.scraperSlug,
      version,
      run_slug: runSlug,
      detail,
      result_count: resultsResponse.data?.count ?? resultsResponse.data?.list?.length ?? 0,
    },
    cloud_results_path: cloudResultsPath,
    compare_report_path: compareOutput,
    compare_report: compareReport,
    ...delivery,
  };

  console.log('\nCoreClaw proof passed.');
  console.log(`Local run: ${local.run_id}`);
  console.log(`Cloud run: ${runSlug}`);
  console.log(`Comparison: ${compareOutput}`);
  if (delivery.run_evidence_path) {
    console.log(`Run evidence: ${delivery.run_evidence_path}`);
  }
  if (delivery.release_dossier_path) {
    console.log(`Release dossier: ${delivery.release_dossier_path}`);
  }
  return result;
}

async function buildProveDeliveryArtifacts(projectPath, {
  options,
  collectImpl,
  releaseImpl,
  runSlug,
  local,
  localRunDir,
  compareOutput,
}) {
  const runEvidencePath = options.runEvidenceOutput
    ? path.resolve(process.cwd(), options.runEvidenceOutput)
    : options.releaseOutput
      ? path.join(localRunDir, 'run-evidence.json')
      : null;
  const releaseOutput = options.releaseOutput
    ? path.resolve(process.cwd(), options.releaseOutput)
    : null;
  const delivery = {};

  if (runEvidencePath) {
    console.log('\n[extra] Collecting cloud run evidence...');
    delivery.run_evidence = await collectImpl(['collect', runSlug], {
      ...options,
      output: runEvidencePath,
      format: options.format ?? 'json',
      pageIndex: options.pageIndex,
      pageSize: parsePositiveInteger(options.pageSize, 100, '--page-size'),
      jsonOutput: false,
    });
    delivery.run_evidence_path = runEvidencePath;
  }

  if (releaseOutput) {
    console.log('\n[extra] Writing release dossier...');
    const packagePath = local.package_path ?? local.package;
    delivery.release_dossier = await releaseImpl(['dossier', projectPath], {
      ...options,
      package: packagePath,
      cloudRun: runSlug,
      compareReport: compareOutput,
      runEvidence: runEvidencePath,
      output: releaseOutput,
      jsonOutput: false,
    });
    delivery.release_dossier_path = releaseOutput;
  }

  return delivery;
}

function buildProveVerifyOptions(options = {}) {
  return {
    ...options,
    jsonOutput: false,
    pack: options.pack ?? true,
  };
}

function buildProveCompareOptions(options = {}, output) {
  return {
    keyFields: options.keyFields,
    minShared: options.minShared,
    maxDiff: options.maxDiff,
    maxOnlyLocal: options.maxOnlyLocal,
    maxOnlyCloud: options.maxOnlyCloud,
    compareProfile: options.compareProfile,
    requireStatusOk: options.requireStatusOk ?? true,
    requireResultStatusOk: options.requireResultStatusOk,
    resultStatusFields: options.resultStatusFields,
    resultFailValues: options.resultFailValues,
    requireOutputSchemaMatch: options.requireOutputSchemaMatch,
    outputSchema: options.outputSchema,
    ignoreFields: options.ignoreFields,
    ignoreKeys: options.ignoreKeys,
    ignoreKeysFile: options.ignoreKeysFile,
    requireUniqueKeys: options.requireUniqueKeys,
    output,
  };
}

async function resolveWorkerVersion(client, scraperSlug, version) {
  if (!version || version === 'auto' || version === 'latest') {
    const detail = await client.getWorker(scraperSlug);
    const resolved = detail.data?.version;
    if (!resolved) {
      throw new CliError(`Cannot resolve latest version for Worker ${scraperSlug}. Pass --version explicitly.`);
    }
    return resolved;
  }
  return version;
}

function resolveCloudResultsPath(localRunDir, options = {}) {
  if (options.cloudResultsOutput) {
    return path.resolve(process.cwd(), options.cloudResultsOutput);
  }
  return path.join(localRunDir, 'cloud-results.json');
}

function resolveCompareOutput(localRunDir, options = {}) {
  if (options.compareOutput) {
    return path.resolve(process.cwd(), options.compareOutput);
  }
  return path.join(localRunDir, 'cloud-comparison.json');
}
