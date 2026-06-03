param(
  [string]$WorkerRoot = "E:\worker",
  [string]$CloudOutput = "E:\downloads\coreclaw_v1.0.1_20260602.json",
  [string]$Python = "py -3",
  [string]$Go = "go"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Coreclaw = Join-Path $RepoRoot "bin\coreclaw.js"
$ReportsDir = Join-Path $RepoRoot ".coreclaw\reports"
New-Item -ItemType Directory -Force -Path $ReportsDir | Out-Null

function Invoke-Step {
  param(
    [string]$Name,
    [string[]]$Command
  )

  Write-Host ""
  Write-Host "==> $Name"
  Write-Host ($Command -join " ")

  $started = Get-Date
  & $Command[0] @($Command | Select-Object -Skip 1) | ForEach-Object {
    Write-Host $_
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode."
  }

  [pscustomobject]@{
    name = $Name
    command = $Command
    started_at = $started.ToUniversalTime().ToString("o")
    completed_at = (Get-Date).ToUniversalTime().ToString("o")
  }
}

function Read-JsonFile {
  param([string]$Path)
  Get-Content -Raw -Encoding UTF8 $Path | ConvertFrom-Json
}

$docsWorker = Join-Path $WorkerRoot "worker-definition-docs-contract-test"
$nodeWorker = Join-Path $WorkerRoot "worker-definition-node-puppeteer-contract-test"
$goWorker = Join-Path $WorkerRoot "worker-definition-go-contract-test"
$lightpandaWorker = Join-Path $WorkerRoot "worker-lightpanda-doc-test"

$requiredPaths = @(
  $Coreclaw,
  $CloudOutput,
  $docsWorker,
  $nodeWorker,
  $goWorker,
  $lightpandaWorker,
  (Join-Path $docsWorker ".coreclaw\smoke-input.json"),
  (Join-Path $docsWorker ".coreclaw\profiles\platform-all-vs-local-ignore-keys.json"),
  (Join-Path $nodeWorker ".coreclaw\smoke-input.json"),
  (Join-Path $goWorker ".coreclaw\smoke-input.json"),
  (Join-Path $lightpandaWorker ".coreclaw\smoke-input.json")
)

foreach ($path in $requiredPaths) {
  if (-not (Test-Path $path)) {
    throw "Required path is missing: $path"
  }
}

$auditJson = Join-Path $ReportsDir "audit-soft-latest.json"
$auditMd = Join-Path $ReportsDir "audit-soft-latest.md"
$docsCompare = Join-Path $docsWorker ".coreclaw\platform-compare-profile-final.json"
$nodeZip = Join-Path $nodeWorker ".coreclaw\verify\latest-node-puppeteer-cli.zip"
$goZip = Join-Path $goWorker ".coreclaw\verify\latest-coreclaw-cli-go.zip"
$lightpandaZip = Join-Path $lightpandaWorker ".coreclaw\verify\latest-lightpanda-cli.zip"

$steps = @()
$steps += Invoke-Step "workspace-audit" @(
  "node", $Coreclaw, "audit", $WorkerRoot,
  "--audit-profile", (Join-Path $RepoRoot "examples\coreclaw-audit-profile.json"),
  "--soft",
  "--output", $auditJson,
  "--markdown", $auditMd
)

$steps += Invoke-Step "docs-contract-cloud-compare" @(
  "node", $Coreclaw, "verify", $docsWorker,
  "--input", (Join-Path $docsWorker ".coreclaw\smoke-input.json"),
  "--python", $Python,
  "--no-pack",
  "--min-results", "45",
  "--compare-output", $docsCompare,
  "--cloud-output", $CloudOutput,
  "--compare-profile", (Join-Path $docsWorker ".coreclaw\profiles\platform-all-vs-local-ignore-keys.json")
)

$steps += Invoke-Step "node-puppeteer-contract" @(
  "node", $Coreclaw, "verify", $nodeWorker,
  "--input", (Join-Path $nodeWorker ".coreclaw\smoke-input.json"),
  "--browser-cdp-shim",
  "--min-results", "8",
  "--output", $nodeZip
)

$steps += Invoke-Step "go-contract-package" @(
  "node", $Coreclaw, "verify", $goWorker,
  "--input", (Join-Path $goWorker ".coreclaw\smoke-input.json"),
  "--go", $Go,
  "--strict",
  "--no-install",
  "--no-require-status-ok",
  "--min-results", "7",
  "--output", $goZip
)

$steps += Invoke-Step "go-package-inspection" @(
  "node", $Coreclaw, "inspect-package", $goZip,
  "--language", "go",
  "--strict"
)

$steps += Invoke-Step "lightpanda-endpoint-contract" @(
  "node", $Coreclaw, "verify", $lightpandaWorker,
  "--input", (Join-Path $lightpandaWorker ".coreclaw\smoke-input.json"),
  "--python", $Python,
  "--no-install",
  "--require-table-header",
  "--require-output-schema-match",
  "--min-results", "1",
  "--output", $lightpandaZip
)

$audit = Read-JsonFile $auditJson
$compare = Read-JsonFile $docsCompare
$artifacts = @($nodeZip, $goZip, $lightpandaZip, $docsCompare, $auditJson, $auditMd) | ForEach-Object {
  $item = Get-Item $_
  [pscustomobject]@{
    path = $item.FullName
    bytes = $item.Length
    last_write_time = $item.LastWriteTimeUtc.ToString("o")
  }
}

$report = [pscustomobject]@{
  ok = $true
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  repo_root = $RepoRoot.Path
  worker_root = (Resolve-Path $WorkerRoot).Path
  cloud_output = (Resolve-Path $CloudOutput).Path
  steps = $steps
  audit = [pscustomobject]@{
    worker_count = $audit.totals.workers
    pass_count = $audit.totals.pass
    warn_count = $audit.totals.warn
    error_count = $audit.totals.errors
    ignored_issue_count = $audit.totals.ignored_issue_count
  }
  docs_compare = [pscustomobject]@{
    ok = $compare.ok
    cloud_count = $compare.cloud_count
    local_count = $compare.local_count
    ignored_cloud_row_count = $compare.ignored_cloud_row_count
    ignored_local_row_count = $compare.ignored_local_row_count
    shared_count = $compare.shared_count
    only_cloud_count = $compare.only_cloud_count
    only_local_count = $compare.only_local_count
    value_diff_count = $compare.value_diff_count
    cloud_result_status_issue_count = $compare.cloud_result_status_issue_count
    local_result_status_issue_count = $compare.local_result_status_issue_count
    cloud_output_schema_issue_count = $compare.cloud_output_schema_issue_count
    local_output_schema_issue_count = $compare.local_output_schema_issue_count
  }
  upload_candidates = [pscustomobject]@{
    node_puppeteer_zip = (Resolve-Path $nodeZip).Path
    go_zip = (Resolve-Path $goZip).Path
    lightpanda_zip = (Resolve-Path $lightpandaZip).Path
  }
  artifacts = $artifacts
}

$reportJson = Join-Path $ReportsDir "windows-worker-matrix-latest.json"
$reportMd = Join-Path $ReportsDir "windows-worker-matrix-latest.md"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($reportJson, ($report | ConvertTo-Json -Depth 8), $utf8NoBom)

$md = @"
# CoreClaw Windows Worker Matrix

- Generated at: $($report.generated_at)
- Worker root: $($report.worker_root)
- Cloud output: $($report.cloud_output)
- Status: pass

## Audit

- Workers: $($report.audit.worker_count)
- Pass: $($report.audit.pass_count)
- Warn: $($report.audit.warn_count)
- Error: $($report.audit.error_count)
- Ignored issues: $($report.audit.ignored_issue_count)

## Docs Contract Cloud Compare

- OK: $($report.docs_compare.ok)
- Cloud rows: $($report.docs_compare.cloud_count)
- Local rows: $($report.docs_compare.local_count)
- Ignored cloud rows: $($report.docs_compare.ignored_cloud_row_count)
- Ignored local rows: $($report.docs_compare.ignored_local_row_count)
- Shared rows: $($report.docs_compare.shared_count)
- Only cloud: $($report.docs_compare.only_cloud_count)
- Only local: $($report.docs_compare.only_local_count)
- Value diffs: $($report.docs_compare.value_diff_count)
- Cloud status issues: $($report.docs_compare.cloud_result_status_issue_count)
- Local status issues: $($report.docs_compare.local_result_status_issue_count)
- Cloud schema issues: $($report.docs_compare.cloud_output_schema_issue_count)
- Local schema issues: $($report.docs_compare.local_output_schema_issue_count)

## Upload Candidates

- Node/Puppeteer: $($report.upload_candidates.node_puppeteer_zip)
- Go: $($report.upload_candidates.go_zip)
- Lightpanda: $($report.upload_candidates.lightpanda_zip)

## Reports

- JSON: $reportJson
- Audit JSON: $auditJson
- Audit Markdown: $auditMd
- Docs compare JSON: $docsCompare
"@

[System.IO.File]::WriteAllText($reportMd, $md, $utf8NoBom)

Write-Host ""
Write-Host "Windows worker matrix passed."
Write-Host "Report: $reportJson"
Write-Host "Markdown: $reportMd"
