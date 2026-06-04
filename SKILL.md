---
name: coreclaw-cli
description: Use this skill when developing, reviewing, testing, documenting, packaging, or operating the CoreClaw CLI repository. It guides an AI agent through CoreClaw Worker contract validation, local runtime verification, upload package checks, cloud result comparison, Apify migration support, release dossier generation, and safe GitHub push workflow.
---

# CoreClaw CLI Agent Skill

Use this skill whenever the task touches the `coreclaw-cli` repository, CoreClaw Worker local validation, CoreClaw upload packages, Worker runtime emulation, platform output comparison, or migration from Apify/Crawlee Actors.

The goal is not to make a generic script runner. The goal is to keep CoreClaw CLI aligned with the CoreClaw Worker platform contract and make it a reliable pre-upload gate for real Worker products.

## Repository Role

CoreClaw CLI is a local development, verification, and packaging tool for CoreClaw Workers. It helps users:

- Generate Worker templates for Node.js, Python, and Go.
- Validate required Worker files and schema contracts.
- Run Workers locally through a CoreClaw-compatible SDK gRPC runtime.
- Validate real input against `input_schema.json`.
- Capture logs, table headers, result rows, run evidence, and diagnostics.
- Enforce upload-readiness gates before a Worker reaches the platform.
- Package upload-ready ZIP files with the correct archive root layout.
- Inspect existing ZIP packages before upload.
- Compare CoreClaw cloud output with local output.
- Collect run evidence and produce release dossiers.
- Audit Apify/Crawlee migration effort and generate CoreClaw input schema drafts.

## First Actions

Before editing:

1. Inspect the worktree:

```bash
git status -sb
```

2. Read the task-relevant files instead of guessing. For broad CLI work, start with:

```bash
README.md
package.json
src/command-metadata.js
src/cli.js
docs/commands.md
docs/roadmap.md
docs/platform-backlog.md
```

3. Re-check the official CoreClaw docs when behavior depends on platform contracts:

```text
../knowledge-files/docs/developer-guide/worker-definition/input-schema.md
../knowledge-files/docs/developer-guide/worker-definition/output-schema.md
../knowledge-files/docs/developer-guide/deployment.md
../knowledge-files/docs/developer-guide/builds-and-runs.md
../knowledge-files/docs/developer-guide/worker-definition/platform-features/proxy-support.md
../knowledge-files/docs/developer-guide/worker-definition/platform-features/browser-fingerprinting.md
../knowledge-files/docs/developer-guide/worker-definition/platform-features/lightpanda.md
../knowledge-files/docs/developer-guide/worker-definition/platform-features/captcha-handling.md
```

If a platform behavior is undocumented, do not invent a hard guarantee. Represent it as a local compatibility gate, a cloud-only limitation, or a backlog item.

## Non-Negotiable Rules

- Do not leak API keys or credentials in commands, logs, docs, tests, commits, or examples.
- Do not use a real CoreClaw API key unless the user explicitly provides one for the current task.
- Do not claim platform upload, version, publish, review, or Store submission automation exists unless official docs or tested endpoints prove it.
- Keep local CLI behavior grounded in official docs or explicit empirical evidence.
- Keep generated command docs synchronized with `src/command-metadata.js`.
- For Go Workers, distinguish source projects from uploaded ZIP artifacts.
- For Windows work, avoid brittle shell quoting; prefer direct PowerShell commands with an explicit working directory.
- Never revert unrelated user changes in a dirty worktree.

## Core Worker Contract

A CoreClaw Worker is a project, not a single script.

Python source project:

```text
main.py
requirements.txt
README.md
input_schema.json
output_schema.json
sdk.py
sdk_pb2.py
sdk_pb2_grpc.py
```

Node.js source project:

```text
main.js
package.json
README.md
input_schema.json
output_schema.json
sdk.js
sdk_pb.js
sdk_grpc_pb.js
```

Go source project:

```text
main.go
go.mod
go.sum
README.md
input_schema.json
output_schema.json
GoSdk/
  sdk.go
  sdk.pb.go
  sdk_grpc.pb.go
```

Go upload ZIP artifact:

```text
main
input_schema.json
output_schema.json
README.md
```

The Go upload entry is a compiled Linux amd64 executable named `main` at the ZIP root. Do not expect `main.go`, `go.mod`, `go.sum`, or `GoSdk/` to exist at runtime inside the uploaded artifact unless deliberately included for runtime use.

## Input Schema Contract

`input_schema.json` has:

- `description`: optional summary shown to users.
- `b`: required task-splitting key.
- `properties`: required array of field definitions.

The `b` value must match the `name` of a property whose `type` is `array`.

Supported property types:

```text
string
integer
boolean
array
object
```

Common editors:

```text
input
textarea
number
select
radio
checkbox
switch
datepicker
requestList
requestListSource
stringList
```

Useful validation expectations:

- `name` values should be unique and ASCII-friendly.
- `required: true` fields must exist and be non-empty in runtime input.
- `requestList` items must contain non-empty `url`.
- `stringList` items must contain non-empty `string`.
- `select`, `radio`, and `checkbox` values must match declared `options`.
- Numeric inputs may declare `minimum` and `maximum`.

## Output Schema Contract

`output_schema.json` is a JSON array. Each item has:

- `name`: required output key.
- `type`: required, one of `string`, `integer`, `boolean`, `array`, `object`.
- `description`: optional table label.

The `name` values must match keys pushed through SDK `PushData`. If runtime output contains fields not declared in `output_schema.json`, call that drift out. If a declared field is never pushed, call that out too.

## Runtime Contract

The CLI local runtime should emulate documented SDK behavior:

- `Parameter/GetInputJSONString`
- `Result/SetTableHeader`
- `Result/PushData`
- `Log/Debug`
- `Log/Info`
- `Log/Warn`
- `Log/Error`

Runtime variables and platform features to validate locally:

- `CORECLAW_TMP_DIR`, `TMPDIR`, `TMP`, `TEMP`
- `PROXY_AUTH`, `PROXY_DOMAIN`
- `ChromeWs`, `ChromeHttp`, `CDP_ENDPOINT`, `BROWSER_WS_ENDPOINT`
- `LightpandaDomain`
- Local SOCKS5 proxy contract
- Browser CDP shim contract
- Lightpanda CDP endpoint normalization
- CAPTCHA custom CDP command `Captchas.automaticSolver`

The local CLI cannot prove the real remote browser pool, real Lightpanda rendering, real target-site bot tolerance, or real CAPTCHA solving success. It can prove the Worker honors the documented interface and produces observable evidence locally.

## Command Map

Use `src/command-metadata.js` as the source of help text. Regenerate docs after metadata changes:

```bash
npm run docs:commands
```

Important command families:

- `init`: generate Worker templates.
- `validate`: statically validate project files and schemas.
- `run`: execute a Worker through the local CoreClaw runtime.
- `verify`: run upload-like preflight, runtime gates, comparison, and package creation.
- `pack`: create upload ZIP packages.
- `inspect-package`: inspect ZIP structure and package manifest drift.
- `inspect-run`: inspect local run artifacts.
- `compare`: compare cloud exports with local results.
- `env`: print masked runtime environment variables.
- `doctor`: check local tools, browser endpoints, and optional cloud smoke checks.
- `account`, `workers`, `tasks`, `runs`: use documented CoreClaw cloud endpoints.
- `prove`: combine local and cloud checks when explicit cloud input is available.
- `release dossier`: summarize package, run evidence, comparisons, diagnostics, cost, and manual Console release steps.
- `migrate apify`: audit Apify/Crawlee migration effort and optionally generate a CoreClaw `input_schema.json` draft.
- `audit`: audit multiple `worker-*` projects in a workspace.

## Development Workflow

Use test-first development for behavior changes where practical.

1. Add or update a focused test that captures the missing behavior.
2. Run the focused test and confirm it fails for the expected reason.
3. Implement the smallest correct change.
4. Run the focused test again.
5. Run affected integration tests.
6. Run full verification before committing.

For command parser changes, update:

```text
src/cli.js
test/cli.test.js
```

For command help changes, update:

```text
src/command-metadata.js
docs/commands.md
test/command-docs.test.js
```

For Worker validation changes, update:

```text
src/validation/schema.js
src/validation/project.js
test/schema.test.js
test/project.test.js
test/validate.test.js
```

For runtime behavior changes, update:

```text
src/runtime/*
src/commands/run.js
test/run.test.js
test/run-store.test.js
test/result-gates.test.js
```

For packaging changes, update:

```text
src/pack/*
src/commands/pack.js
src/commands/inspect-package.js
test/pack.test.js
test/inspect-package.test.js
test/package-manifest.test.js
```

For cloud commands, update:

```text
src/cloud/client.js
src/commands/cloud-utils.js
src/commands/account.js
src/commands/workers.js
src/commands/tasks.js
src/commands/runs.js
test/cloud-client.test.js
test/cloud-commands.test.js
```

## Verification Commands

For focused tests:

```bash
node --test ./test/cli.test.js
node --test ./test/schema.test.js
node --test ./test/run.test.js
node --test ./test/pack.test.js
```

For full repository verification:

```bash
npm test
git diff --check
npm pack --dry-run --json
```

For release verification:

```bash
npm run verify:release
```

Use sensitive-token scans before committing if any task touched auth, cloud commands, docs examples, or logs:

```bash
rg -n "CORECLAW_API_KEY|scraper_api_|Bearer |Authorization|api[_-]?key|secret|token" .
```

Review any hits manually. Do not treat a hit as safe just because it appears in a test; confirm it is fake and intentionally masked.

## Worker Verification Recipes

Validate a Worker:

```bash
node ./bin/coreclaw.js validate ../worker-google-maps-scraper --strict
```

Run a Worker locally with explicit input:

```bash
node ./bin/coreclaw.js run ../worker-google-maps-scraper --input ./tmp/input.json --min-results 1
```

Verify upload-like behavior:

```bash
node ./bin/coreclaw.js verify ../worker-google-maps-scraper --strict --input ./tmp/input.json --min-results 1 --require-table-header --require-output-schema-match
```

Pack a Go Worker:

```bash
node ./bin/coreclaw.js pack ../worker-google-maps-scraper --output ./tmp/google-maps-worker.zip
node ./bin/coreclaw.js inspect-package ./tmp/google-maps-worker.zip --language go --project ../worker-google-maps-scraper --strict
```

Compare a cloud export with local output:

```bash
node ./bin/coreclaw.js compare ./cloud-results.json ./local-results.ndjson --output ./tmp/comparison.json --json-summary
```

If a Worker depends on real CoreClaw browser infrastructure, local `run` may only prove local contracts. Ask the user for platform logs, exported results, run slug, input JSON, and timing after they run the Worker in CoreClaw.

## Apify Migration Workflow

Use this when migrating an Apify/Crawlee Actor:

```bash
node ./bin/coreclaw.js migrate apify ./apify-actor --output migration.json --markdown migration.md
node ./bin/coreclaw.js migrate apify ./apify-actor --schema-output ./coreclaw-worker/input_schema.json
```

Expect the migration audit to identify:

- Apify input schema conversion work.
- Dataset output to CoreClaw SDK `PushData`.
- KeyValueStore usage.
- RequestQueue usage.
- Proxy configuration differences.
- Browser crawler differences.
- SDK lifecycle changes.

Do not claim the CLI fully rewrites Apify Actors unless code generation exists and is tested. Treat the current migration command as audit plus input schema draft generation.

## Release Dossier Workflow

Use `release dossier` when the user needs a publish-ready evidence bundle but platform upload or Store publish APIs are not documented.

Expected evidence:

- Local validation report.
- Local run artifacts.
- Upload ZIP inspection.
- Cloud test run results, if available.
- Cloud/local comparison, if available.
- Run diagnosis and cost report, if available.
- Manual Console next steps.

Do not pretend release dossier submits to the Store. It prepares evidence and instructions for manual Console release.

## Documentation Rules

- `docs/commands.md` is generated. Do not hand-edit it unless regenerating is impossible.
- Keep `README.md` practical and English-first.
- Keep `README_CN.md` as the Chinese companion if updating Chinese docs.
- Keep platform gaps in `docs/platform-backlog.md` instead of hiding them in prose.
- Keep roadmap claims tied to actual implemented behavior and verification.

## Commit And Push Workflow

Before committing:

```bash
git status -sb
git diff --stat
npm test
git diff --check
npm pack --dry-run --json
```

Then:

```bash
git add <changed-files>
git commit -m "<clear message>"
git push origin main
git status -sb
```

After pushing, report:

- Commit hash.
- Verification commands and outcomes.
- Any known limitations or platform-only validation still needed.

## Platform Validation Requests To Ask Users For

When a Worker needs real CoreClaw validation, ask the user for:

- Exact input JSON used on the platform.
- Run slug.
- Build logs.
- Runtime logs from start to finish.
- Exported JSON or CSV results.
- Number of requested rows versus pushed rows.
- Total runtime and cost/usage if available.
- Screenshots only when logs/results do not expose the issue.

For scraping products, also ask for:

- Field completeness expectations.
- Minimum acceptable rows per minute.
- Target countries/languages.
- Whether emails are required or optional.
- Whether browser-only extraction is acceptable for cost.
- A small test input and a larger batch input.

Use that evidence to adjust limits, selectors, wait strategy, retry behavior, output schema, and product documentation.
