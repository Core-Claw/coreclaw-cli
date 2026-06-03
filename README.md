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
- Run input validation for required fields, declared value types, numeric bounds, selector options, and list editor item shapes in `input_schema.json` before the worker starts
- Platform environment variables:
  - `ChromeWs`
  - `LightpandaDomain`
  - `CDP_ENDPOINT` / `BROWSER_WS_ENDPOINT`
  - `PROXY_AUTH` / `PROXY_DOMAIN` when cloud proxy mode is requested
- Per-run temporary state isolation for local runs:
  - `CORECLAW_TMP_DIR`
  - `TMPDIR` / `TMP` / `TEMP`
- Run lifecycle artifacts under `.coreclaw/runs/<run-id>/`
- Output table projection and result/schema drift reporting for `output_schema.json`
- Optional strict runtime table-header gate for workers that must call `set_table_header`
- Optional result-status gate for workers whose output rows contain business-level failure states
- Upload ZIP structure validation and packaging
- Go upload packaging:
  - clean upload staging
  - `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go`
  - executable `main` at the ZIP root

It does not emulate CoreClaw's real remote fingerprint browser pool. For browser workers, start a local Chrome with remote debugging on `127.0.0.1:9222`, or pass a real remote CDP/WebDriver endpoint with `--chrome-ws` / `--chrome-http`, then use `--require-browser` to fail fast if the endpoint is not reachable. For HTTP workers, use `--local-proxy --require-proxy-usage` to expose a local SOCKS5 proxy through `PROXY_AUTH` / `PROXY_DOMAIN` and fail the run if the worker bypasses it.

It also does not emulate real Lightpanda page rendering locally. Use `--lightpanda-shim` to expose a local CDP shim through `LightpandaDomain`, and `--require-lightpanda-shim` to fail a smoke run if the worker does not connect to `/devtools/browser/new` or forgets the documented Basic `Authorization` header built from `PROXY_AUTH`. This verifies the Lightpanda endpoint contract before upload; real navigation/rendering must still be validated on CoreClaw or against a real upstream CDP endpoint.

It also does not solve real CAPTCHAs locally. Use `--captcha-solver` to expose a local CDP shim for CoreClaw's custom `Captchas.automaticSolver` command, and `--require-captcha-solver` to fail a smoke run if the worker never calls that command or calls it with params outside the documented `timeout` / `solverType` contract. This verifies the integration contract before upload; real CAPTCHA bypass still happens only in CoreClaw's hosted fingerprint browser.

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

This runs the unit suite and then executes `coreclaw verify` against the Node example, including a cloud-output comparison against `examples/node-hello-cloud-output.json`. The test suite also smoke-tests generated Node and Python templates end to end: `init` creates a worker, `verify` runs it from upload-like staging with strict result/table-header/output-schema gates, and the produced ZIP passes package inspection.

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
node ./bin/coreclaw.js validate ./examples/node-hello --strict
```

Validation checks:

- Exactly one entry file: `main.py`, `main.js`, or `main.go`
- Required dependency, SDK, and input schema files
- `README.md` presence as an upload-ready worker documentation warning
- Node `package.json` `main` / `type` values against the documented `main.js` + CommonJS contract
- Node source `require()` / `import` third-party package names against `package.json` runtime dependencies
- Python source `import` / `from` third-party package names against `requirements.txt`, excluding SDK files, local modules, and test-only sources
- SDK runtime dependencies declared in the platform dependency file:
  - Python: `grpcio`, `protobuf` in `requirements.txt`
  - Node.js: `@grpc/grpc-js`, `google-protobuf` in `package.json`
  - Go: `google.golang.org/grpc`, `google.golang.org/protobuf` in `go.mod`, with matching checksums in `go.sum`
- HTTP request workers that use clients such as `requests`, `httpx`, `axios`, `fetch`, `undici`, or Go `net/http` read both `PROXY_AUTH` and `PROXY_DOMAIN`
- `input_schema.json` root fields, unique property names, supported types/editors, documented editor/type pairings, numeric `minimum` / `maximum` bounds, selector `options`, `requestListSource.param_list`, and default value shapes
- `input_schema.b` points to an array property
- `output_schema.json` column names and supported types when present

CoreClaw installs dependencies from `requirements.txt`, `package.json`, or `go.mod` after upload. The CLI therefore rejects workers that rely on locally installed SDK packages but do not declare those packages for the cloud installer. For Node.js workers, validation also warns when source files import third-party packages that are missing from `dependencies` or `optionalDependencies`, because a local `node_modules` directory can otherwise hide upload-time failures. For Python workers, validation warns when runtime source imports common third-party modules that are missing from `requirements.txt`, with package-name normalization for mappings such as `bs4` -> `beautifulsoup4`, `cv2` -> `opencv-python`, and `grpc` -> `grpcio`. For Go workers, `go.sum` must already contain checksums for SDK dependencies because `verify` and `pack` build with `-mod=readonly`; run `go mod tidy` or `go mod download` before preflight if checksums are missing.

CoreClaw runs HTTP request workers inside an isolated network sandbox. If source files appear to make direct HTTP requests, validation warns unless the project reads both `PROXY_AUTH` and `PROXY_DOMAIN` so it can build the documented SOCKS5 proxy URL. Browser automation workers that connect through `ChromeWs` or `LightpandaDomain` are not treated as direct HTTP proxy workers by this static check.

For browser automation source files, validation also warns when Playwright, Puppeteer, Selenium, DrissionPage, or CDP-style code does not read CoreClaw's remote browser environment. Upload-ready browser workers should read `PROXY_AUTH` plus one of `ChromeWs`, `ChromeHttp`, `LightpandaDomain`, `CDP_ENDPOINT`, or `BROWSER_WS_ENDPOINT`; launching a local browser should be kept behind a local-development branch. This catches workers that pass locally by starting a browser on the developer machine but cannot connect to CoreClaw's hosted browser backend after upload.

Use `--strict` when validation should behave like a new-worker upload readiness gate: warnings such as missing `README.md`, missing `output_schema.json`, legacy schema types, or Node package metadata drift become failures. Default validation stays compatible with older workers so existing projects can still be inspected and run locally.

At run time, the CLI also validates the actual input assembled from defaults, `--input`, or `--json`. If a field marked `"required": true` is missing or empty, if a declared input field has the wrong JSON type, if a numeric value is outside `minimum` / `maximum`, if a `select`/`radio`/`checkbox` value is outside `options`, or if list editor items do not match the documented shape, the command fails before creating run artifacts or starting the worker, matching CoreClaw's form-level launch behavior.

For list editors, `requestList` items must include a non-empty `url`, `stringList` items must include a non-empty `string`, and `requestListSource` items may use custom fields declared in `param_list`. Static validation checks the `param_list` structure, duplicate param names, supported param types/editors, numeric bounds, selector options, and editor/type pairings. Run-time validation then checks required `param_list` fields, JSON types, numeric bounds, and selector options per list item.

CoreClaw's docs describe `output_schema.json` for upload-ready projects, but the current platform still accepts older workers without it. The CLI treats a missing `output_schema.json` as a warning, not a blocker. Local `export.ndjson` keeps the full raw result rows when no output schema exists.

When `output_schema.json` exists, local runs project `export.ndjson` through the declared columns and record result/schema drift in `output_schema_issues.json`. They also warn when runtime `set_table_header` keys or formats drift from `output_schema.json`. Add `--require-output-schema-match` to `run` or `verify` when you want upload-preflight behavior to fail if pushed rows are missing declared fields, include undeclared fields, have the wrong declared field type, or are not JSON objects.

CoreClaw's SDK docs describe `set_table_header` as the runtime table-definition step before returning results. The CLI warns when a worker never calls it, but keeps old `output_schema.json`-only workers compatible by default. Add `--require-table-header` to `run` or `verify` when you want that SDK contract to be a hard upload preflight gate.

### Audit Many Workers

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft

node ./bin/coreclaw.js audit E:/worker \
  --ignore-issue-codes missing_output_schema_legacy,input_legacy_type_alias,output_legacy_type_alias \
  --fail-on-warn

node ./bin/coreclaw.js audit E:/worker \
  --audit-profile ./examples/coreclaw-audit-profile.json
```

Audit discovers `worker-*` directories below a root, runs the same project/schema checks as `validate`, and writes reusable JSON/Markdown reports. Use `--all` only when you intentionally want to validate any directory that contains `main.py`, `main.js`, or `main.go`, such as examples with nonstandard names. It treats missing `output_schema.json` and legacy `type: "number"` as warnings because current CoreClaw keeps compatibility with older workers.

Add `--fail-on-warn` when audit should be a strict upload-readiness gate. Use `--ignore-issue-codes code1,code2` to keep known compatibility issues visible in `ignored_issues` while excluding them from pass/warn/error counts. This lets CI fail on new warnings while continuing to tolerate documented legacy codes such as `missing_output_schema_legacy`.

Use `--audit-profile <file>` to keep recurring audit gates in a reusable JSON file. The profile accepts snake_case or camelCase fields: `fail_on_warn`, `ignore_issue_codes`, `all`, `recursive`, `soft`, `output`, and `markdown`. Relative `output` and `markdown` paths are resolved from the profile file directory. Command-line options override profile values, while `ignore_issue_codes` is merged so one-off tolerated codes can be added without editing the profile.

The example audit profile deliberately does not ignore `http_proxy_env_not_used`. That warning points to a platform network-sandbox risk: a worker can succeed on a developer machine with direct outbound network but fail after upload unless it uses CoreClaw's documented SOCKS5 proxy variables.

### Run Locally

```bash
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./examples/node-hello --input input.json
node ./bin/coreclaw.js run ./examples/node-hello --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./examples/node-hello --min-results 1
node ./bin/coreclaw.js run ./examples/node-hello --require-status-ok
node ./bin/coreclaw.js run ./examples/node-hello --strict
node ./bin/coreclaw.js run ./examples/node-hello --require-table-header
node ./bin/coreclaw.js run ./examples/node-hello --require-output-schema-match
node ./bin/coreclaw.js run ./worker --local-proxy --require-proxy-usage
node ./bin/coreclaw.js run ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js run ./lightpanda-worker --lightpanda-shim --require-lightpanda-shim --min-results 1
node ./bin/coreclaw.js run ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
```

The run starts a local CoreClaw SDK gRPC server on `127.0.0.1:20086`, then executes the worker.

Use `--timeout-ms` to cap the whole worker process and `--idle-timeout-ms` to stop a worker that has stopped producing output but still has open Node/Python/Go handles. Durations accept milliseconds, `s`, or `m`.

If the input schema marks a field as required, local runs require a non-empty value for that field. Declared fields must also match their schema type, for example `integer` must be an integer, `boolean` must be a boolean, and `array` must be a JSON array. Numeric fields must stay inside `minimum` / `maximum` when those bounds are declared. Selector inputs must use values declared in `options`; `requestList`, `requestListSource`, and `stringList` values are validated against their documented item shapes. Use `--input input.json` or `--json '{"field":"value"}'` when the schema does not provide a default. On Windows and in repeatable scripts, prefer `--input input.json` for non-trivial payloads because PowerShell quoting can change inline JSON before it reaches Node.js.

Use `--min-results` for real worker smoke tests. Some existing workers can exit with code `0` after logging an upstream or browser error, so result count is the reliable success gate.

Use `--require-status-ok` when result rows include a `status` field and values such as `fail`, `failed`, `failure`, or `error` should make the local run fail even if the worker process exits with code `0`. Tune worker-specific schemas with `--result-status-fields status,check_status` and `--result-fail-values fail,error,manual`. This gate is opt-in because some workers use non-error status values such as `manual`, `skipped`, or domain-specific labels.

Use `--require-table-header` when upload preflight should require the worker to call the SDK runtime table-header API. This is stricter than the default compatibility mode and catches workers that only rely on a static `output_schema.json`.

Use `--require-output-schema-match` when validating workers for upload. It keeps legacy workers compatible by default, but makes schema drift a hard failure when explicitly requested.

Use `run --strict` when direct local debugging should use the same default runtime gates as strict upload preflight. It fails on static validation warnings unless `--skip-validate` is passed, and defaults on `--require-table-header`, `--require-output-schema-match`, and `--require-status-ok`; explicit command-line values still win. Use `verify --strict` before upload because it also stages the uploadable files and inspects the final ZIP package.

Each run gets an isolated temporary directory at `.coreclaw/runs/<run-id>/tmp`. For Node.js workers, the CLI also preloads a small local hook that maps absolute `/tmp/...` file operations into that run directory, which prevents stale host-machine `/tmp` state from changing repeat runs.

If Chrome remote debugging is reachable at `http://127.0.0.1:9222/json/version`, the CLI automatically discovers the browser WebSocket path and injects:

- `ChromeWs=127.0.0.1:9222/devtools/browser/<id>`
- `ChromeHttp=127.0.0.1:9222`
- `CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`
- `BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`

Use `--no-discover-chrome` to disable this discovery. Without a detected browser, `ChromeWs` and `ChromeHttp` fall back to `127.0.0.1:9222` so the environment still looks like CoreClaw's documented host-style browser variables. `ChromeHttp` is used by Selenium Remote WebDriver workers, while `ChromeWs` is used by Playwright, Puppeteer, and DrissionPage CDP workers.

Use `--require-browser` for browser worker smoke tests. It turns browser availability into a preflight gate: local Chrome discovery passes immediately, host-style CDP endpoints are checked through `/json/version`, and Selenium-style endpoints are checked through `/status`. If no endpoint is reachable, the run fails before creating run artifacts instead of letting a browser worker fail later with a less specific connection error.

Use `--browser-cdp-shim` when testing browser workers that should connect through CoreClaw's host-style `ChromeWs` variable. The CLI starts a local CDP WebSocket shim, injects `ChromeWs=<host:port>`, `ChromeHttp=<host:port>`, and a full `CDP_ENDPOINT`, and accepts both `ws://<ChromeWs>/devtools/browser/<id>` and DrissionPage's documented `ws://<ChromeWs>/ws?apiKey=<PROXY_AUTH>` path. Add `--require-browser-cdp-shim` to fail the run if the worker never connects to that shim.

Use `--lightpanda-shim` when testing workers that read CoreClaw's documented `LightpandaDomain` variable. The CLI starts the local CDP WebSocket shim, injects `LightpandaDomain=<host:port>` plus `PROXY_AUTH`, and accepts the documented normalized endpoint `ws://<LightpandaDomain>/devtools/browser/new`. Add `--require-lightpanda-shim` to fail the run if the worker never connects to that path or connects without a Basic `Authorization` header. The shim returns basic `Browser.getVersion` metadata and forwards other CDP traffic to a discovered or explicit upstream CDP endpoint when one exists.

Use `--captcha-solver` when testing workers that call CoreClaw's documented custom CDP method `Captchas.automaticSolver`. The CLI starts the same local CDP WebSocket shape, injects it through `ChromeWs`, `CDP_ENDPOINT`, and `BROWSER_WS_ENDPOINT`, and returns `{ "status": true }` for `Captchas.automaticSolver`. Other CDP messages are forwarded to the discovered or explicit upstream CDP endpoint when one exists. Add `--require-captcha-solver` to fail the run if no solver call was observed, `timeout` is not a positive number, or `solverType` is not one of CoreClaw's documented values. Observed solver calls are written to `captcha_solver_calls.json`.

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
  captcha_solver_calls.json # present when --require-captcha-solver observes solver calls
  table_headers.json
  tmp/                # per-run temporary state
  summary.json
```

`summary.json` records both `project_dir` and `worker_dir`. In regular `run` commands these paths are the same. In staged `verify` commands, `project_dir` is the original worker directory where artifacts are stored, while `worker_dir` is the temporary upload-like execution directory.

### Upload Preflight

```bash
node ./bin/coreclaw.js verify ./examples/node-hello --min-results 1
node ./bin/coreclaw.js verify ./worker --strict --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --cloud-output ./cloud-output.json --min-shared 1 --max-diff 0
node ./bin/coreclaw.js verify ./worker --cloud-output ./cloud-output.json --no-compare
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
node ./bin/coreclaw.js verify ./worker --no-pack
node ./bin/coreclaw.js verify ./my-go-worker --go go --min-results 1
node ./bin/coreclaw.js verify ./worker --no-require-status-ok --min-results 1
node ./bin/coreclaw.js verify ./worker --require-table-header --require-output-schema-match --min-results 1
node ./bin/coreclaw.js verify ./worker --require-output-schema-match --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --require-browser --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
node ./bin/coreclaw.js verify ./lightpanda-worker --lightpanda-shim --require-lightpanda-shim --min-results 1
node ./bin/coreclaw.js verify ./browser-worker --captcha-solver --require-captcha-solver --min-results 1
node ./bin/coreclaw.js inspect-package ./dist/my-worker.zip --language node
node ./bin/coreclaw.js inspect-package ./dist/my-go-worker.zip --language go
```

`verify` is the upload-before-you-upload gate. It runs static validation, copies the uploadable worker files to `.coreclaw/staging/<stage-id>/`, installs dependencies there, executes the staged worker in the local CoreClaw runtime, enforces a result-count gate, fails on result rows with failure status values, optionally requires a runtime table-header call, optionally enforces result/output_schema matching, optionally compares the local run with a CoreClaw cloud JSON export, and creates an upload ZIP unless `--no-pack` is passed. For Node.js workers, staged dependency installation uses `npm ci --omit=dev` or `npm install --omit=dev`, so dev-only packages cannot make local preflight pass when the platform runtime would be missing them. For Python workers, staged dependency installation runs inside a temporary virtual environment created from the configured `--python`, so globally installed packages cannot hide missing `requirements.txt` entries. This catches workers that only pass because the source directory contains ignored files such as `.coreclaw`, `node_modules`, virtualenvs, `dist`, or other files that will not be uploaded.

`verify` defaults on `--require-status-ok` because a worker can push diagnostic rows such as `status=fail` while still exiting with code `0`. Use `--no-require-status-ok` only for workers whose `status` field has domain-specific non-error semantics, or tune the gate with `--result-status-fields` and `--result-fail-values`.

Add `--strict` for new-worker upload preflight. Strict verify fails on static validation warnings and additionally defaults on `--require-table-header` and `--require-output-schema-match`; explicit command-line values still win, so you can temporarily relax one runtime gate while keeping the rest of strict mode.

Boolean flags support `--flag`, `--no-flag`, and explicit `--flag=true|false`. Unknown long options fail before any worker starts, and options are checked against the selected command, so command typos such as `--input-jsno` or passing `--cloud-output` to `run` cannot silently fall back to schema defaults. Prefer `--no-install`, `--no-pack`, `--no-staging`, or `--no-compare` in scripts when disabling preflight steps. For Windows CI or PowerShell commands, prefer `--input input.json` over inline `--json` / `--input-json` when the payload contains nested objects or arrays.

For Go workers, `verify` now treats source files and runtime files as separate platform contracts. It first validates and builds the upload artifact from a clean staged source tree with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go`. It then executes a second upload-like runtime staging directory that contains the compiled entry binary plus schema files, not the original Go source tree. This matches the observed CoreClaw platform behavior where the Go runtime can expose `main` while `main.go`, `go.mod`, and `GoSdk/` are not visible from the worker process. Use `run` for source-directory debugging with `go run .`; use `verify` as the upload-before-you-upload gate. Use `--go <binary>` when you need a pinned Go toolchain or `go` is not on `PATH`.

By default, run artifacts are still written under the original project `.coreclaw/runs/<run-id>/`, packages are written under `.coreclaw/verify/<verify-id>/`, and cloud comparison reports are written to `.coreclaw/runs/<run-id>/cloud-comparison.json`. Staged preflight runs also write `upload_manifest.json` into the run directory so you can audit exactly which files were copied into the upload-like execution directory. Use `--compare-output <file>` to write the comparison report somewhere else. Use `--no-staging` or `--no-install` only when debugging the source directory directly.

### Inspect a Run

```bash
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --min-results 1
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-status-ok
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-status-ok --result-status-fields check_status --result-fail-values fail,error,manual
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --require-output-schema-match
```

`inspect-run` checks that `summary.json`, `results.ndjson`, `export.ndjson`, and `output_schema_issues.json` agree with each other. It can also apply the same result-status gate to already captured run artifacts. Use it after running real workers so a clean process exit is not mistaken for a successful data-producing run.

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
  --chrome-http "127.0.0.1:9222" \
  --lightpanda-domain "lightpanda-inner.coreclaw.com"
```

Default local runs use direct outbound network:

- `PROXY_AUTH` is unset
- `PROXY_DOMAIN` is unset
- `ChromeWs` is auto-discovered from local Chrome CDP when available; otherwise `127.0.0.1:9222`
- `ChromeHttp` follows `ChromeWs` host/port by default, or can be set explicitly for Selenium workers
- `LightpandaDomain` is unset unless explicitly passed with `--lightpanda-domain` or enabled with `--lightpanda-shim`

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

For Lightpanda workers that normalize `LightpandaDomain` to `ws://<domain>/devtools/browser/new` and send Basic auth from `PROXY_AUTH`:

```bash
node ./bin/coreclaw.js verify ./worker --lightpanda-shim --require-lightpanda-shim --min-results 1
```

Use `--lightpanda-domain <domain-or-endpoint>` when you want to run against an explicit real endpoint instead of the local shim. Bare domains are preserved in `LightpandaDomain` so the worker can apply the documented normalization rule; the local run still injects `PROXY_AUTH` when `LightpandaDomain` is present.

For CAPTCHA-aware browser workers:

```bash
node ./bin/coreclaw.js verify ./worker --captcha-solver --require-captcha-solver --min-results 1
```

This local shim proves that your code sends `Captchas.automaticSolver` with the expected CDP shape. With `--require-captcha-solver`, it also validates that `timeout` is a positive number and `solverType` is one of CoreClaw's documented values: `cloudflare`, `datadome`, `google-v2`, `google-v3`, `oocl_slide`, `perimeterx`, `shein_same_object_click`, `temu_auto`, `tiktok_slide_simple`, or `tiktok_slide_auto`. It intentionally does not bypass real website challenges; run the same worker on CoreClaw to validate the hosted solver against real targets.

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
node ./bin/coreclaw.js pack ./examples/node-hello --output ./dist/node-hello.zip --strict
node ./bin/coreclaw.js pack ./my-go-worker --output ./dist/my-go-worker.zip --go go
```

The ZIP has the worker entry file at archive root and excludes `.coreclaw`, `node_modules`, virtualenvs, build outputs, caches, and git metadata. After creating the ZIP, `pack` immediately runs the same package inspection gate used by `inspect-package`, so root-entry mistakes and Go executable-mode problems fail before the file is uploaded. `verify` uses `pack` for its final upload artifact, so this package gate is also part of upload preflight. Add `--strict` to fail on static validation warnings and package recommended-root warnings before writing an upload candidate.

For Go workers, `pack` builds the Linux amd64 upload executable in a temporary staging directory with `-mod=readonly` and adds `main` to the ZIP with executable permissions. The source directory is not modified, and missing `go.sum` checksums fail before upload instead of being silently generated by a local build.

Use `inspect-package` when you need to validate an existing ZIP before upload, especially if it was created outside `coreclaw pack`. It checks that Python, Node.js, or Go entry files are at the archive root and reports the common mistake where the ZIP contains a nested worker directory wrapper such as `worker/main.js` instead of root `main.js`. For Go uploads, it also checks that the archive has a root `main` executable and that its Unix mode is `100755`, which catches Windows-created archives that would otherwise fail on the platform before worker logs appear. Add `--strict` when missing recommended root metadata such as `README.md` or `output_schema.json` should fail the package check.

## Cloud Comparison Workflow

For a cloud run exported as JSON or CSV, compare it with a local run's captured results as a standalone step:

```bash
node ./bin/coreclaw.js compare \
  E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  E:/worker/worker-username-finder/.coreclaw/runs/<run-id> \
  --output ./tmp/username-finder-comparison.json \
  --compare-profile E:/worker/worker-username-finder/.coreclaw/profiles/cloud-parity.json \
  --min-shared 1
```

The cloud path may be a JSON array export, a saved `/api/v1/run/result/list` response such as `data.list[]`, or a downloaded CSV export. If you pass the `/api/v1/run/result/export` response that only contains `data.download_url`, download that file first and compare the downloaded JSON/CSV. CSV fields are kept as strings; prefer JSON when `--require-output-schema-match` needs to distinguish numbers or booleans from strings.

This compares row counts, shared keys, cloud-only rows, local-only rows, and value differences. Difference reports include `changed_fields` for each changed row and `value_diff_fields_top_20` so you can quickly separate timestamp/noise fields from real contract drift. Use `--ignore-fields completed_at,updated_at` to remove known noisy fields from value-diff comparisons; status and output_schema gates still inspect the original rows. Use `--ignore-keys key1,key2` or `--ignore-keys-file <file>` when a known run profile intentionally emits different row identities, such as platform-only browser probe rows versus local skipped group rows; ignored keys are removed only from duplicate/shared/only/value-diff comparisons, while status and output_schema gates still inspect the original rows. The ignore-keys file may be a JSON array, a JSON object with `ignore_keys` or `ignoreKeys`, or a plain text file with one key per line and `#` comments. It also reports duplicate comparison keys on both sides; add `--require-unique-keys` to fail if the chosen key would otherwise hide rows behind a last-row-wins comparison. It also reports result-status issues on both the CoreClaw cloud output and the local output; add `--require-status-ok` to fail if either side contains failure status values. Pass `--output-schema <file>` to validate both cloud and local rows against a worker `output_schema.json`; add `--require-output-schema-match` to make that a hard gate. The local path can be a run directory, `export.ndjson`, or `results.ndjson`. Use `--key-fields username,site,urlUser` when the default key is not specific enough, and CI gates such as `--min-shared`, `--max-diff`, `--max-only-local`, and `--max-only-cloud` when cloud parity should be strict. For network-heavy workers, expect output differences unless the local machine uses equivalent CoreClaw proxy/browser infrastructure.

Use `--compare-profile <file>` to keep recurring cloud-parity gates in a reusable JSON file. The profile accepts snake_case or camelCase fields such as `key_fields`, `ignore_fields`, `ignore_keys`, `min_shared`, `max_diff`, `max_only_cloud`, `max_only_local`, `require_unique_keys`, `require_status_ok`, `output_schema`, and `require_output_schema_match`. Relative profile paths such as `output_schema`, `ignore_keys_file`, and `output` are resolved from the profile file directory, not the current shell directory. Command-line options override profile values, while `ignore_fields` and `ignore_keys` are merged so temporary one-off ignores can be added without editing the profile.

When the same profile is passed to `verify`, it can also carry a small set of upload-preflight run defaults: `local_proxy`, `cloud_proxy`, `proxy_auth`, `proxy_domain`, `browser_cdp_shim`, `require_browser_cdp_shim`, `lightpanda_shim`, `require_lightpanda_shim`, `captcha_solver`, `require_captcha_solver`, `require_proxy_usage`, `require_browser`, `require_status_ok`, `require_result_status_ok`, `result_status_fields`, `result_fail_values`, `lightpanda_domain`, `chrome_ws`, and `chrome_http`. This keeps a worker-specific cloud-parity profile self-contained, for example a docs-contract profile can set `local_proxy: true` so proxy rows are reproduced locally without repeating `--local-proxy` on every verify command, or set `require_status_ok: false` when local-only rows intentionally report platform-injected values as missing while the cloud output is the authoritative pass/fail source. Explicit command-line options still override profile defaults.

The same comparison can be folded into upload preflight:

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  --compare-output ./tmp/username-finder-comparison.json \
  --compare-profile E:/worker/worker-username-finder/.coreclaw/profiles/cloud-parity.json \
  --key-fields username,site,urlUser \
  --min-shared 1 \
  --max-diff 0
```

When `verify` receives `--cloud-output`, schema selection is explicit-first: `--output-schema` wins, then profile `output_schema`, then the worker's own `output_schema.json` when no compare profile is used.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the local verification gate, runtime compatibility rules, and the real-worker smoke matrix used before releasing CLI changes.

## Verified Locally

On this Windows machine:

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js validate ./examples/python-hello
node ./bin/coreclaw.js doctor --python "py -3" --strict
node ./bin/coreclaw.js run ./examples/python-hello --python "py -3"
```

The Python example uses `--python "py -3"` because this machine's default `python` points to a Hermes virtual environment without `pip`. The same option is used for dependency installation during `verify`, so prefer `--python` over `--command` for Python workers. Add `doctor --strict` to fail preflight scripts when Node, npm, Python, pip, or Go is missing.

Real worker smoke runs verified during development:

```bash
# Node.js, no browser dependency
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-dedup-datasets --input %TEMP%/coreclaw-dedup-smoke-input.json --timeout-ms 30s --idle-timeout-ms 10s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-dedup-datasets/.coreclaw/runs/<run-id> --min-results 2

# Python, explicit interpreter because this machine's default python is a Hermes venv
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-yfinance --input %TEMP%/coreclaw-yfinance-smoke-input.json --python "py -3" --timeout-ms 60s --idle-timeout-ms 20s --min-results 1

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
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\browser-automation\lightpanda.md`
