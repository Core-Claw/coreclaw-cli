# CoreClaw CLI Roadmap

This document tracks the practical development goals for CoreClaw CLI. Keep it updated whenever the CLI gains a user-facing capability, when a known gap is closed, or when a platform limitation changes.

## Product Goal

CoreClaw CLI should help developers build upload-ready CoreClaw Workers with less guesswork. A developer should be able to create a Worker, validate platform-required files, run it locally through a CoreClaw-compatible SDK runtime, inspect outputs, package it correctly, and compare local output with CoreClaw platform output.

The CLI must stay aligned with the CoreClaw Worker definition in `E:\worker\knowledge-files\docs\developer-guide`.

## Scope Principles

- Prefer CoreClaw platform contracts over generic scraper conventions.
- Treat local success as an upload preflight gate, not as a loose demo runner.
- Keep cloud-only features explicit: local checks should prove integration contracts, while real hosted behavior still needs platform validation.
- Make the first-run path simple, then expose stricter gates for production Workers.
- Keep docs and command help current with real CLI behavior.

## Goal Breakdown

### 1. First Worker Path

Goal: make it obvious how to go from an empty directory to a verified upload package.

Completed:

- `coreclaw init` creates Python, Node.js, and Go Worker templates with SDK files.
- `coreclaw validate` checks root files, SDK files, dependencies, `input_schema.json`, and `output_schema.json`.
- `coreclaw run` starts the local SDK runtime and executes a Worker.
- `coreclaw verify` stages a clean upload-like runtime, runs the Worker, and creates a ZIP.
- README and README_CN describe the Worker structure and upload workflow.
- Top-level help is grouped by workflow, and `coreclaw help <command>` shows command-specific examples.
- `docs/commands.md` is generated from the same command metadata as CLI help.

Solvable gaps:

- Add a guided `create` alias or wizard-style flow for users who do not know which language to pick.
- Add `coreclaw examples` or `coreclaw init --template <name>` once there are more CoreClaw-specific templates.
- Add a generated `input.example.json` option during `init` so users have an immediate test payload.

Currently out of local scope:

- Creating or publishing Workers directly on the CoreClaw platform requires authenticated platform APIs and should not be faked locally.

### 2. Platform Contract Validation

Goal: catch upload-time mistakes before a developer uploads a Worker.

Completed:

- Validates required Python, Node.js, and Go source project files.
- Validates Node.js CommonJS SDK usage and runtime dependency declarations.
- Validates Python imports against `requirements.txt`.
- Validates Go SDK dependencies and `go.sum` checksums.
- Validates input schema root fields, editor/type pairs, defaults, options, numeric bounds, and split key.
- Validates output schema field names and supported types.
- Warns when HTTP request Workers do not read `PROXY_AUTH` and `PROXY_DOMAIN`.
- Warns when browser Workers do not read CoreClaw browser endpoint variables.

Solvable gaps:

- Add a docs contract test that snapshots supported input editors and output field types from the local knowledge docs.
- Add more precise dependency scanners for dynamic imports and optional Worker plugin folders.
- Add `coreclaw validate --json` for CI systems that should consume validation output directly.

Currently out of local scope:

- Proving platform dependency installation speed or platform image availability requires actual CoreClaw runs.

### 3. Runtime Preflight

Goal: make local runs expose the same SDK-facing behavior developers rely on in CoreClaw.

Completed:

- Local gRPC runtime implements parameter, log, table header, and result APIs.
- Local runs write `.coreclaw/runs/<run-id>` artifacts.
- Runtime validates actual input before starting the Worker.
- Runtime projects results through `output_schema.json` and records drift.
- Runtime can require minimum result count, status success, table headers, and output schema match.
- Local temporary state is isolated per run.
- Node.js absolute `/tmp` writes are mapped into the run temp directory.

Solvable gaps:

- Add clearer `inspect-run` remediation hints for missing results, missing table headers, and schema drift.
- Add JSON output mode for `run`, `verify`, and `inspect-run`.
- Add a stable machine-readable summary schema for CI integrations.

Currently out of local scope:

- Exact platform scheduling, retry, and distributed task concurrency behavior cannot be fully reproduced without platform APIs.

### 4. Browser, Proxy, Lightpanda, and CAPTCHA Contracts

Goal: prove Worker code uses CoreClaw runtime integration points correctly before upload.

Completed:

- `--local-proxy` starts an authenticated local SOCKS5 proxy.
- `--require-proxy-usage` fails if HTTP Workers bypass the proxy.
- Local Chrome discovery injects browser endpoint variables.
- `--require-browser` checks CDP or Selenium-style endpoints before running.
- `--browser-cdp-shim` validates host-style `ChromeWs` and DrissionPage-style paths.
- `--lightpanda-shim` validates `LightpandaDomain` normalization and Basic auth.
- `--captcha-solver` validates `Captchas.automaticSolver` command shape and params.

Solvable gaps:

- Add more visible run summaries for observed proxy connections, CDP connections, and CAPTCHA calls.
- Add example Workers for each browser backend contract.
- Add a command that prints the exact env vars a run would inject without executing a Worker.

Currently out of local scope:

- Real fingerprint browser behavior, Lightpanda rendering, proxy geolocation, and CAPTCHA success rates require CoreClaw-hosted infrastructure.

### 5. Packaging and Upload Artifacts

Goal: avoid ZIP layout and Go binary issues that fail before Worker logs appear.

Completed:

- `coreclaw pack` creates upload ZIPs with root entry files.
- Go packages are built as Linux amd64 `main` binaries.
- Go root executable mode is preserved and inspected as `100755`.
- `inspect-package` catches nested directory wrappers and missing root entries.
- Local-only artifacts such as `.coreclaw`, `node_modules`, virtualenvs, caches, and build outputs are excluded.

Solvable gaps:

- Add `coreclaw pack --print-files` to list files before ZIP creation.
- Add package size warnings for unexpectedly large uploads.
- Add upload manifest diffing between source and package contents.

Currently out of local scope:

- Platform-side ZIP acceptance and internal extraction behavior must still be proven by real upload tests.

### 6. Cloud Parity and Reports

Goal: make CoreClaw platform output comparable with local output.

Completed:

- `compare` reads CoreClaw JSON arrays, result-list wrappers, and CSV exports.
- `verify --cloud-output` can fold cloud comparison into upload preflight.
- Compare profiles support reusable keys, ignored fields, ignored rows, status gates, and schema gates.
- `audit` writes JSON and Markdown reports across many Worker directories.

Solvable gaps:

- Add `compare --json-summary` for dashboards.
- Add a profile generator for common Worker result shapes.
- Add a short docs page with recommended cloud export commands and file naming.

Currently out of local scope:

- Automatically downloading platform result exports requires authenticated platform API integration.

## Current Known Gaps

### Solvable In This Repository

- Add command-specific help for every command with richer flag descriptions.
- Add CI-friendly JSON output modes.
- Add more Worker templates and example payloads.
- Add better remediation text for common validation and runtime failures.
- Add versioned docs when CLI behavior becomes stable enough for releases.

### Not Fully Solvable Locally

- Real hosted browser rendering and fingerprint behavior.
- Real Lightpanda navigation performance and compatibility.
- Real CAPTCHA bypass effectiveness.
- Real proxy exit region and target-site reputation.
- Platform scheduler behavior, review flow, monetization, and public Worker Store publishing.
- CoreClaw API authentication and cloud resource management until stable public API contracts are available for this CLI.

## Recently Completed

- Rewrote English and Chinese README files as user/developer guides.
- Removed old implementation-plan and legacy compare wrapper files.
- Added strict upload preflight gates for result status, table headers, output schema, browser shims, Lightpanda, CAPTCHA, proxy usage, and Go package shape.
- Added package inspection for ZIP root entries and Go executable mode.
- Added platform output verification helper scripts for local maintainers.
- Added grouped top-level help, `coreclaw help <command>`, `<command> --help`, and close-command suggestions.
- Added generated command reference docs from CLI command metadata.

## Next Milestones

1. Add JSON output modes for `validate`, `run`, `verify`, and `inspect-run`.
2. Add a package manifest preview command for upload ZIP contents.
3. Add `init --input-example` or default `input.example.json` generation.
4. Add richer examples for HTTP proxy, browser CDP, Lightpanda, and CAPTCHA Workers.
5. Add more precise remediation hints for validation and runtime failures.
