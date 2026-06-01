# CoreClaw CLI

Local CoreClaw worker runtime, verifier, and upload preflight CLI.

CoreClaw's official developer guide currently documents upload-ready worker projects, cloud-injected SDK files, `input_schema.json`, `output_schema.json`, the gRPC SDK endpoint `127.0.0.1:20086`, and runtime variables such as `PROXY_AUTH`, `PROXY_DOMAIN`, and `ChromeWs`. It also says local SDK worker mode is not yet available. This CLI fills that gap for local development.

Chinese documentation: [README_CN.md](./README_CN.md).

## What It Emulates

- CoreClaw SDK gRPC services:
  - `Parameter/GetInputJSONString`
  - `Result/SetTableHeader`
  - `Result/PushData`
  - `Log/Debug`, `Log/Info`, `Log/Warn`, `Log/Error`
- Runtime input injection from `input_schema.json` defaults, `--input`, or `--json`
- Run input validation for required fields and declared value types in `input_schema.json` before the worker starts
- Platform environment variables:
  - `ChromeWs`
  - `CDP_ENDPOINT` / `BROWSER_WS_ENDPOINT`
  - `PROXY_AUTH` / `PROXY_DOMAIN` when cloud proxy mode is requested
- Per-run temporary state isolation for local runs:
  - `CORECLAW_TMP_DIR`
  - `TMPDIR` / `TMP` / `TEMP`
- Run lifecycle artifacts under `.coreclaw/runs/<run-id>/`
- Output table projection and result/schema drift reporting for `output_schema.json`
- Upload ZIP structure validation and packaging
- Go upload packaging:
  - clean upload staging
  - `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main ./main.go`
  - executable `main` at the ZIP root

It does not emulate CoreClaw's real remote fingerprint browser pool. For browser workers, start a local Chrome with remote debugging on `127.0.0.1:9222`, or pass a real remote CDP/WebDriver endpoint with `--chrome-ws` / `--chrome-http`, then use `--require-browser` to fail fast if the endpoint is not reachable. For HTTP workers, use `--local-proxy --require-proxy-usage` to expose a local SOCKS5 proxy through `PROXY_AUTH` / `PROXY_DOMAIN` and fail the run if the worker bypasses it.

It also does not solve real CAPTCHAs locally. Use `--captcha-solver` to expose a local CDP shim for CoreClaw's custom `Captchas.automaticSolver` command, and `--require-captcha-solver` to fail a smoke run if the worker never calls that command. This verifies the integration contract before upload; real CAPTCHA bypass still happens only in CoreClaw's hosted fingerprint browser.

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
- SDK runtime dependencies declared in the platform dependency file:
  - Python: `grpcio`, `protobuf` in `requirements.txt`
  - Node.js: `@grpc/grpc-js`, `google-protobuf` in `package.json`
  - Go: `google.golang.org/grpc`, `google.golang.org/protobuf` in `go.mod`
- `input_schema.json` root fields, unique property names, supported types/editors
- `input_schema.b` points to an array property
- `output_schema.json` column names and supported types when present

CoreClaw installs dependencies from `requirements.txt`, `package.json`, or `go.mod` after upload. The CLI therefore rejects workers that rely on locally installed SDK packages but do not declare those packages for the cloud installer.

At run time, the CLI also validates the actual input assembled from defaults, `--input`, or `--json`. If a field marked `"required": true` is missing or empty, or if a declared input field has the wrong JSON type, the command fails before creating run artifacts or starting the worker, matching CoreClaw's form-level launch behavior.

CoreClaw's docs describe `output_schema.json` for upload-ready projects, but the current platform still accepts older workers without it. The CLI treats a missing `output_schema.json` as a warning, not a blocker. Local `export.ndjson` keeps the full raw result rows when no output schema exists.

When `output_schema.json` exists, local runs project `export.ndjson` through the declared columns and record result/schema drift in `output_schema_issues.json`. Add `--require-output-schema-match` to `run` or `verify` when you want upload-preflight behavior to fail if pushed rows are missing declared fields, include undeclared fields, or are not JSON objects.

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
node ./bin/coreclaw.js run ./examples/node-hello --require-output-schema-match
node ./bin/coreclaw.js run ./worker --local-proxy --require-proxy-usage
node ./bin/coreclaw.js run ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js run ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
```

The run starts a local CoreClaw SDK gRPC server on `127.0.0.1:20086`, then executes the worker.

Use `--timeout-ms` to cap the whole worker process and `--idle-timeout-ms` to stop a worker that has stopped producing output but still has open Node/Python/Go handles. Durations accept milliseconds, `s`, or `m`.

If the input schema marks a field as required, local runs require a non-empty value for that field. Declared fields must also match their schema type, for example `integer` must be an integer, `boolean` must be a boolean, and `array` must be a JSON array. Use `--input input.json` or `--json '{"field":"value"}'` when the schema does not provide a default.

Use `--min-results` for real worker smoke tests. Some existing workers can exit with code `0` after logging an upstream or browser error, so result count is the reliable success gate.

Use `--require-output-schema-match` when validating workers for upload. It keeps legacy workers compatible by default, but makes schema drift a hard failure when explicitly requested.

Each run gets an isolated temporary directory at `.coreclaw/runs/<run-id>/tmp`. For Node.js workers, the CLI also preloads a small local hook that maps absolute `/tmp/...` file operations into that run directory, which prevents stale host-machine `/tmp` state from changing repeat runs.

If Chrome remote debugging is reachable at `http://127.0.0.1:9222/json/version`, the CLI automatically discovers the browser WebSocket path and injects:

- `ChromeWs=127.0.0.1:9222/devtools/browser/<id>`
- `ChromeHttp=127.0.0.1:9222`
- `CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`
- `BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`

Use `--no-discover-chrome` to disable this discovery. Without a detected browser, `ChromeWs` and `ChromeHttp` fall back to `127.0.0.1:9222` so the environment still looks like CoreClaw's documented host-style browser variables. `ChromeHttp` is used by Selenium Remote WebDriver workers, while `ChromeWs` is used by Playwright, Puppeteer, and DrissionPage CDP workers.

Use `--require-browser` for browser worker smoke tests. It turns browser availability into a preflight gate: local Chrome discovery passes immediately, host-style CDP endpoints are checked through `/json/version`, and Selenium-style endpoints are checked through `/status`. If no endpoint is reachable, the run fails before creating run artifacts instead of letting a browser worker fail later with a less specific connection error.

Use `--browser-cdp-shim` when testing browser workers that should connect through CoreClaw's host-style `ChromeWs` variable. The CLI starts a local CDP WebSocket shim, injects `ChromeWs=<host:port>`, `ChromeHttp=<host:port>`, and a full `CDP_ENDPOINT`, and accepts both `ws://<ChromeWs>/devtools/browser/<id>` and DrissionPage's documented `ws://<ChromeWs>/ws?apiKey=<PROXY_AUTH>` path. Add `--require-browser-cdp-shim` to fail the run if the worker never connects to that shim.

Use `--captcha-solver` when testing workers that call CoreClaw's documented custom CDP method `Captchas.automaticSolver`. The CLI starts the same local CDP WebSocket shape, injects it through `ChromeWs`, `CDP_ENDPOINT`, and `BROWSER_WS_ENDPOINT`, and returns `{ "status": true }` for `Captchas.automaticSolver`. Other CDP messages are forwarded to the discovered or explicit upstream CDP endpoint when one exists. Add `--require-captcha-solver` to fail the run if no solver call was observed.

Artifacts are written to:

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  upload_manifest.json # files used by staged upload-like preflight runs
  logs.ndjson
  results.ndjson      # raw SDK push_data payloads
  export.ndjson       # CoreClaw-style output_schema-projected rows
  output_schema_issues.json # present when pushed rows drift from output_schema.json
  table_headers.json
  tmp/                # per-run temporary state
  summary.json
```

`summary.json` records both `project_dir` and `worker_dir`. In regular `run` commands these paths are the same. In staged `verify` commands, `project_dir` is the original worker directory where artifacts are stored, while `worker_dir` is the temporary upload-like execution directory.

### Upload Preflight

```bash
node ./bin/coreclaw.js verify ./examples/node-hello --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --cloud-output ./cloud-output.json --min-shared 1 --max-diff 0
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
node ./bin/coreclaw.js verify ./worker --no-pack
node ./bin/coreclaw.js verify ./my-go-worker --go go --min-results 1
node ./bin/coreclaw.js verify ./worker --require-output-schema-match --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
```

`verify` is the upload-before-you-upload gate. It runs static validation, copies the uploadable worker files to `.coreclaw/staging/<stage-id>/`, installs dependencies there, executes the staged worker in the local CoreClaw runtime, enforces a result-count gate, optionally enforces result/output_schema matching, optionally compares the local run with a CoreClaw cloud JSON export, and creates an upload ZIP unless `--no-pack` is passed. This catches workers that only pass because the source directory contains ignored files such as `.coreclaw`, `node_modules`, `dist`, or other files that will not be uploaded.

For Go workers, the local run still executes the staged source with `go run .` so SDK behavior is tested on the developer machine. The package step then cross-compiles the upload artifact exactly for CoreClaw's Linux runtime with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main ./main.go`, and includes the generated executable `main` at the ZIP root. This catches Go workers that run locally but cannot produce the binary that CoreClaw expects after upload. Use `--go <binary>` when you need a pinned Go toolchain or `go` is not on `PATH`.

By default, run artifacts are still written under the original project `.coreclaw/runs/<run-id>/`, packages are written under `.coreclaw/verify/<verify-id>/`, and cloud comparison reports are written to `.coreclaw/runs/<run-id>/cloud-comparison.json`. Staged preflight runs also write `upload_manifest.json` into the run directory so you can audit exactly which files were copied into the upload-like execution directory. Use `--compare-output <file>` to write the comparison report somewhere else. Use `--no-staging` or `--no-install` only when debugging the source directory directly.

### Inspect a Run

```bash
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --min-results 1
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-output-schema-match
```

`inspect-run` checks that `summary.json`, `results.ndjson`, `export.ndjson`, and `output_schema_issues.json` agree with each other. Use it after running real workers so a clean process exit is not mistaken for a successful data-producing run.

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
  --chrome-ws "127.0.0.1:9222" \
  --chrome-http "127.0.0.1:9222"
```

Default local runs use direct outbound network:

- `PROXY_AUTH` is unset
- `PROXY_DOMAIN` is unset
- `ChromeWs` is auto-discovered from local Chrome CDP when available; otherwise `127.0.0.1:9222`
- `ChromeHttp` follows `ChromeWs` host/port by default, or can be set explicitly for Selenium workers

`coreclaw doctor` checks whether local Chrome CDP is reachable at `127.0.0.1:9222` and prints the browser variables that local runs will inject.

To emulate CoreClaw's SOCKS5 proxy path for HTTP workers, start the local proxy:

```bash
node ./bin/coreclaw.js run ./worker --local-proxy
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage
```

`--local-proxy` starts an authenticated SOCKS5 proxy on `127.0.0.1:<port>` and injects matching `PROXY_AUTH` / `PROXY_DOMAIN` values. `--require-proxy-usage` also enables the proxy and fails the run if the worker never opens a SOCKS5 CONNECT request. Use this gate for HTTP request workers so local verification catches code that succeeds only by using direct host networking.

For browser workers, pair `--require-browser` with `--chrome-ws` or `--chrome-http` when using a non-default endpoint:

```bash
node ./bin/coreclaw.js verify ./worker --chrome-ws "127.0.0.1:9222/devtools/browser/<id>" --require-browser --min-results 1
node ./bin/coreclaw.js verify ./worker --chrome-http "127.0.0.1:9515" --require-browser --min-results 1
```

The first form matches Playwright, Puppeteer, and explicit CDP endpoint workers. The second form matches Selenium Remote WebDriver workers.

For CoreClaw-style host-only CDP variables, including DrissionPage workers that build `ws://{ChromeWs}/ws?apiKey={PROXY_AUTH}`:

```bash
node ./bin/coreclaw.js verify ./worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
```

The shim returns basic `Browser.getVersion` metadata even without an upstream browser, and forwards all other CDP traffic to a discovered or explicit upstream endpoint when one exists.

For CAPTCHA-aware browser workers:

```bash
node ./bin/coreclaw.js verify ./worker --captcha-solver --require-captcha-solver --min-results 1
```

This local shim proves that your code sends `Captchas.automaticSolver` with the expected CDP shape. It intentionally does not bypass real website challenges; run the same worker on CoreClaw to validate the hosted solver against real targets.

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
node ./bin/coreclaw.js pack ./my-go-worker --output ./dist/my-go-worker.zip --go go
```

The ZIP has the worker entry file at archive root and excludes `.coreclaw`, `node_modules`, virtualenvs, build outputs, caches, and git metadata.

For Go workers, `pack` builds the Linux amd64 upload executable in a temporary staging directory and adds `main` to the ZIP with executable permissions. The source directory is not modified.

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
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --require-browser --timeout-ms 90s --idle-timeout-ms 30s --min-results 1
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-google-maps-scraper/.coreclaw/runs/<run-id> --min-results 1

# Go, browser worker with a local Chrome CDP endpoint
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --chrome-ws 127.0.0.1:9222/devtools/browser/<id> --require-browser --timeout-ms 90s --idle-timeout-ms 30s
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
