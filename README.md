# CoreClaw CLI

Local development CLI for CoreClaw workers.

CoreClaw's official developer guide currently documents upload-ready worker projects, cloud-injected SDK files, `input_schema.json`, `output_schema.json`, the gRPC SDK endpoint `127.0.0.1:20086`, and runtime variables such as `PROXY_AUTH`, `PROXY_DOMAIN`, and `ChromeWs`. It also says local SDK worker mode is not yet available. This CLI fills that gap for local development.

## What It Emulates

- CoreClaw SDK gRPC services:
  - `Parameter/GetInputJSONString`
  - `Result/SetTableHeader`
  - `Result/PushData`
  - `Log/Debug`, `Log/Info`, `Log/Warn`, `Log/Error`
- Runtime input injection from `input_schema.json` defaults, `--input`, or `--json`
- Platform environment variables:
  - `ChromeWs`
  - `CDP_ENDPOINT` / `BROWSER_WS_ENDPOINT`
  - `PROXY_AUTH` / `PROXY_DOMAIN` when cloud proxy mode is requested
- Per-run temporary state isolation for local runs:
  - `CORECLAW_TMP_DIR`
  - `TMPDIR` / `TMP` / `TEMP`
- Run lifecycle artifacts under `.coreclaw/runs/<run-id>/`
- Upload ZIP structure validation and packaging

It does not emulate CoreClaw's real remote fingerprint browser pool or real SOCKS5 proxy. For browser workers, start a local Chrome with remote debugging on `127.0.0.1:9222`, or pass a real remote CDP endpoint with `--chrome-ws`. For proxy-sensitive workers, use `--cloud-proxy` to expose local placeholder proxy variables, or pass real proxy values with `--proxy-auth` / `--proxy-domain`.

## Install

From this repository:

```bash
npm install
node ./bin/coreclaw.js --help
```

For local development, you can use the executable directly:

```bash
node E:/worker/coreclaw-cli/bin/coreclaw.js doctor
```

Before pushing CLI changes:

```bash
npm run verify
```

This runs the unit suite and then executes `coreclaw verify` against the Node example, including a cloud-output comparison against `examples/node-hello-cloud-output.json`.

## Commands

### Create a Worker

```bash
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker
node ./bin/coreclaw.js init ./my-python-worker --language python
node ./bin/coreclaw.js init ./my-go-worker --language go
```

Generated projects include the mandatory SDK files documented by CoreClaw:

- Python: `sdk.py`, `sdk_pb2.py`, `sdk_pb2_grpc.py`
- Node.js: `sdk.js`, `sdk_pb.js`, `sdk_grpc_pb.js`
- Go: `GoSdk/sdk.go`, `GoSdk/sdk.pb.go`, `GoSdk/sdk_grpc.pb.go`

### Validate

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
```

Validation checks:

- Exactly one entry file: `main.py`, `main.js`, or `main.go`
- Required dependency, SDK, and input schema files
- `input_schema.json` root fields, unique property names, supported types/editors
- `input_schema.b` points to an array property
- `output_schema.json` column names and supported types when present

CoreClaw's docs describe `output_schema.json` for upload-ready projects, but the current platform still accepts older workers without it. The CLI treats a missing `output_schema.json` as a warning, not a blocker. Local `export.ndjson` keeps the full raw result rows when no output schema exists.

### Audit Many Workers

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft
```

Audit discovers `worker-*` directories below a root, runs the same project/schema checks as `validate`, and writes reusable JSON/Markdown reports. Use `--all` only when you intentionally want to validate any directory that contains `main.py`, `main.js`, or `main.go`, such as examples with nonstandard names. It treats missing `output_schema.json` and legacy `type: "number"` as warnings because current CoreClaw keeps compatibility with older workers.

### Run Locally

```bash
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./examples/node-hello --input input.json
node ./bin/coreclaw.js run ./examples/node-hello --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./examples/node-hello --min-results 1
```

The run starts a local CoreClaw SDK gRPC server on `127.0.0.1:20086`, then executes the worker.

Use `--timeout-ms` to cap the whole worker process and `--idle-timeout-ms` to stop a worker that has stopped producing output but still has open Node/Python/Go handles. Durations accept milliseconds, `s`, or `m`.

Use `--min-results` for real worker smoke tests. Some existing workers can exit with code `0` after logging an upstream or browser error, so result count is the reliable success gate.

Each run gets an isolated temporary directory at `.coreclaw/runs/<run-id>/tmp`. For Node.js workers, the CLI also preloads a small local hook that maps absolute `/tmp/...` file operations into that run directory, which prevents stale host-machine `/tmp` state from changing repeat runs.

If Chrome remote debugging is reachable at `http://127.0.0.1:9222/json/version`, the CLI automatically discovers the browser WebSocket path and injects:

- `ChromeWs=127.0.0.1:9222/devtools/browser/<id>`
- `CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`
- `BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`

Use `--no-discover-chrome` to disable this discovery. Without a detected browser, `ChromeWs` falls back to `127.0.0.1:9222` so the environment still looks like CoreClaw's documented host-style `ChromeWs`.

Artifacts are written to:

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  logs.ndjson
  results.ndjson      # raw SDK push_data payloads
  export.ndjson       # CoreClaw-style output_schema-projected rows
  table_headers.json
  tmp/                # per-run temporary state
  summary.json
```

### Upload Preflight

```bash
node ./bin/coreclaw.js verify ./examples/node-hello --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --cloud-output ./cloud-output.json --min-shared 1 --max-diff 0
node ./bin/coreclaw.js verify ./worker --no-pack
```

`verify` is the upload-before-you-upload gate. It runs static validation, executes the worker in the local CoreClaw runtime, enforces a result-count gate, optionally compares the local run with a CoreClaw cloud JSON export, and creates an upload ZIP unless `--no-pack` is passed. By default, packages are written under `.coreclaw/verify/<verify-id>/`, and cloud comparison reports are written to `.coreclaw/runs/<run-id>/cloud-comparison.json`. Use `--compare-output <file>` to write the comparison report somewhere else.

### Inspect a Run

```bash
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --min-results 1
```

`inspect-run` checks that `summary.json`, `results.ndjson`, and `export.ndjson` agree on row counts. Use it after running real workers so a clean process exit is not mistaken for a successful data-producing run.

### Simulate Split Tasks

CoreClaw's `input_schema.b` field is the task splitting key and must reference an array property. Use `--split <index>` to run one expanded item locally:

```bash
node ./bin/coreclaw.js run ./examples/node-hello --split 0
```

For a `requestList` item like `{ "url": "https://example.com" }`, the worker receives `url` as a top-level value, matching the single-item pattern used by existing CoreClaw workers.

### Runtime Environment Overrides

```bash
node ./bin/coreclaw.js run ./worker \
  --proxy-auth "user:pass" \
  --proxy-domain "proxy.example:6000" \
  --chrome-ws "127.0.0.1:9222"
```

Default local runs use direct outbound network:

- `PROXY_AUTH` is unset
- `PROXY_DOMAIN` is unset
- `ChromeWs` is auto-discovered from local Chrome CDP when available; otherwise `127.0.0.1:9222`

To emulate CoreClaw cloud proxy variables without a real proxy, opt in explicitly:

```bash
node ./bin/coreclaw.js run ./worker --cloud-proxy
```

Cloud proxy mode exposes local placeholders:

- `PROXY_AUTH=coreclaw-local:coreclaw-local`
- `PROXY_DOMAIN=127.0.0.1:6000`

### Package for Upload

```bash
node ./bin/coreclaw.js pack ./examples/node-hello --output ./dist/node-hello.zip
```

The ZIP has the worker entry file at archive root and excludes `.coreclaw`, `node_modules`, virtualenvs, build outputs, caches, and git metadata.

## Cloud Comparison Workflow

For a cloud run exported as JSON, compare it with a local run's captured results as a standalone step:

```bash
node ./bin/coreclaw.js compare \
  E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  E:/worker/worker-username-finder/.coreclaw/runs/<run-id> \
  --output ./tmp/username-finder-comparison.json \
  --min-shared 1
```

This compares row counts, shared keys, cloud-only rows, local-only rows, and value differences. The local path can be a run directory, `export.ndjson`, or `results.ndjson`. Use `--key-fields username,site,urlUser` when the default key is not specific enough, and CI gates such as `--min-shared`, `--max-diff`, `--max-only-local`, and `--max-only-cloud` when cloud parity should be strict. For network-heavy workers, expect output differences unless the local machine uses equivalent CoreClaw proxy/browser infrastructure.

The same comparison can be folded into upload preflight:

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  --compare-output ./tmp/username-finder-comparison.json \
  --key-fields username,site,urlUser \
  --min-shared 1 \
  --max-diff 0
```

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local verification gate, runtime compatibility rules, and the real-worker smoke matrix used before releasing CLI changes.

## Verified Locally

On this Windows machine:

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js validate ./examples/python-hello
node ./bin/coreclaw.js run ./examples/python-hello --command "py -3 main.py"
```

The Python example uses `py -3` because this machine's default `python` points to a Hermes virtual environment without `pip`.

Real worker smoke runs verified during development:

```bash
# Node.js, no browser dependency
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-dedup-datasets --input %TEMP%/coreclaw-dedup-smoke-input.json --timeout-ms 30s --idle-timeout-ms 10s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-dedup-datasets/.coreclaw/runs/<run-id> --min-results 2

# Python, explicit interpreter because this machine's default python is a Hermes venv
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-yfinance --input %TEMP%/coreclaw-yfinance-smoke-input.json --command "py -3 main.py" --timeout-ms 60s --idle-timeout-ms 20s --min-results 1

# Go, browser/CDP worker. Start Chrome remote debugging first, then run:
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --timeout-ms 90s --idle-timeout-ms 30s --min-results 1
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-yfinance/.coreclaw/runs/<run-id> --min-results 1

# Go, browser worker with a local Chrome CDP endpoint
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --chrome-ws 127.0.0.1:9222/devtools/browser/<id> --timeout-ms 90s --idle-timeout-ms 30s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-google-maps-scraper/.coreclaw/runs/<run-id> --min-results 1
```

## Official-Docs Contract Used

This implementation is based on the local official docs under:

- `E:\worker\knowledge-files\docs\developer-guide\develop-worker\quick-start.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\project-structure.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\sdk-modules.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\input-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\output-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\builds-and-runs.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\proxy-support.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\browser-fingerprinting.md`
