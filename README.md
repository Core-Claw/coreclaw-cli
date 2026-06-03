# CoreClaw CLI

CoreClaw CLI is a local development, verification, and packaging tool for CoreClaw Workers. It is designed to make the local pre-upload workflow match the CoreClaw platform contract as closely as a desktop tool can: validate the Worker project structure, run the Worker through a local SDK runtime, inspect runtime output, compare platform output with local output, and create upload-ready ZIP packages.

Chinese documentation: [README_CN.md](./README_CN.md).

## Why This CLI Exists

CoreClaw Workers are uploaded as lightweight script projects. The platform provides the runtime, installs dependencies, injects environment variables, exposes a local SDK gRPC endpoint at `127.0.0.1:20086`, runs your entry file, captures logs, and stores rows pushed through the SDK.

The official Worker definition describes the required files, SDK modules, `input_schema.json`, `output_schema.json`, browser endpoints, SOCKS5 proxy variables, Lightpanda, and CAPTCHA commands. CoreClaw CLI turns those platform rules into a local preflight gate so a Worker can be checked before upload.

Use CoreClaw CLI to:

- Generate Python, Node.js, and Go Worker templates with SDK files.
- Validate upload-required files and schema files.
- Run a Worker locally with a CoreClaw-compatible SDK gRPC server.
- Validate actual run input against `input_schema.json`.
- Capture logs, table headers, pushed rows, projected exports, and runtime diagnostics.
- Enforce result-count, status, table-header, output-schema, proxy, browser, Lightpanda, and CAPTCHA gates.
- Create upload ZIP packages with correct archive-root layout.
- Build Go Workers into a Linux amd64 executable named `main`.
- Inspect ZIP packages before upload, including nested-directory mistakes and Go executable mode.
- Compare CoreClaw platform JSON/CSV results with a local run.
- Audit many `worker-*` projects in a workspace.

The current development goals, completed work, known solvable gaps, and known cloud-only limitations are tracked in [docs/roadmap.md](./docs/roadmap.md). Exact command syntax is generated from CLI metadata in [docs/commands.md](./docs/commands.md).

## What The CLI Emulates

The local runtime implements the CoreClaw SDK services used by Worker code:

- `Parameter/GetInputJSONString`
- `Result/SetTableHeader`
- `Result/PushData`
- `Log/Debug`
- `Log/Info`
- `Log/Warn`
- `Log/Error`

It also injects the runtime variables and files needed by common Worker patterns:

- `CORECLAW_TMP_DIR`, `TMPDIR`, `TMP`, and `TEMP` for per-run temporary state.
- `PROXY_AUTH` and `PROXY_DOMAIN` for proxy contract tests.
- `ChromeWs`, `ChromeHttp`, `CDP_ENDPOINT`, and `BROWSER_WS_ENDPOINT` for browser automation tests.
- `LightpandaDomain` for Lightpanda endpoint contract tests.
- A local SOCKS5 proxy when `--local-proxy` is enabled.
- A local browser CDP shim when `--browser-cdp-shim`, `--lightpanda-shim`, or `--captcha-solver` is enabled.

Use `coreclaw env` when you want to inspect these variables before starting a Worker:

```bash
node ./bin/coreclaw.js env ./worker --cloud-proxy --lightpanda-domain lightpanda-inner.coreclaw.com
node ./bin/coreclaw.js env ./worker --json-output
```

The CLI does not replace the hosted CoreClaw platform. It does not provide the real remote fingerprint browser pool, does not render pages with the real Lightpanda service, and does not solve real CAPTCHAs. For those features, the CLI validates the documented connection and command contracts locally, then you still run the final proof on CoreClaw.

## Installation

From this repository:

```bash
npm install
node ./bin/coreclaw.js --help
```

During local development you can call the executable by path:

```bash
node E:/worker/coreclaw-cli/bin/coreclaw.js doctor
```

After installing the package globally or linking it into your shell, the executable name is:

```bash
coreclaw --help
```

## Quick Start

Create a Node.js Worker, run it locally, verify it from upload-like staging, and produce a ZIP:

```bash
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker
node ./bin/coreclaw.js validate ./my-worker --strict
node ./bin/coreclaw.js env ./my-worker --cloud-proxy
node ./bin/coreclaw.js run ./my-worker --input ./my-worker/input.example.json --min-results 1
node ./bin/coreclaw.js verify ./my-worker --strict --input ./my-worker/input.example.json --min-results 1
```

Run the built-in example:

```bash
node ./bin/coreclaw.js verify ./examples/node-hello \
  --cloud-output ./examples/node-hello-cloud-output.json \
  --compare-output ./tmp/node-hello-comparison.json \
  --min-shared 1 \
  --max-diff 0 \
  --output ./tmp/node-hello.zip
```

Run the full release verification for this CLI repository:

```bash
npm run verify:release
```

## CoreClaw Worker Contract

A Worker is not only a script. It is a project with a fixed entry file, dependency file, SDK files, input schema, output schema, and documentation. The platform reads those files to prepare the UI, install dependencies, start the script, and collect results.

Projects generated by `coreclaw init` also include `input.example.json`. This file is a local developer convenience generated from `input_schema.json` defaults. Use it with `coreclaw run --input` or `coreclaw verify --input` for the first smoke test, then replace its values with realistic task input. It is not a CoreClaw platform-required file and is excluded from upload ZIP packages.

### Python Source Project

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

### Node.js Source Project

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

Node.js Workers should use CommonJS for the SDK files:

```javascript
const coresdk = require('./sdk')
```

The documented package shape is `main.js` with CommonJS semantics. Runtime dependencies such as `@grpc/grpc-js`, `google-protobuf`, `puppeteer-core`, `axios`, or `socks-proxy-agent` must be declared under `dependencies` or `optionalDependencies`, not only `devDependencies`.

### Go Source Project

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

Go has two different contracts:

- The source project contains `main.go`, `go.mod`, `go.sum`, `GoSdk/`, schemas, and docs.
- The uploaded ZIP must contain a compiled Linux amd64 executable named `main` at the ZIP root.

CoreClaw CLI builds that upload binary with:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go
```

On Windows, ordinary ZIP tools can lose the executable bit from a Go binary. `coreclaw pack` and `coreclaw verify` preserve the root `main` mode as `100755` in the ZIP and `coreclaw inspect-package` checks it before upload.

## Upload Package Contract

CoreClaw ZIP uploads must put the runtime entry at the archive root:

- Python: `main.py` at ZIP root.
- Node.js: `main.js` at ZIP root.
- Go: compiled executable `main` at ZIP root.

Do not upload a ZIP that contains an extra wrapper directory such as `worker/main.js`. The platform expects the entry file at the archive root.

CoreClaw CLI excludes local-only artifacts from packages:

- `.coreclaw/`
- `node_modules/`
- `input.example.json`
- Python virtualenvs
- build directories
- caches
- git metadata
- temporary files

Use this gate for a ZIP created by any tool:

```bash
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --project ./worker
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go --strict
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --max-package-size 25MB
```

Package inspection also reports ZIP size and the largest compressed/uncompressed entries. Add `--project ./worker` to compare an existing ZIP with the project's upload manifest; this catches missing runtime files and unexpected files that were added by another ZIP tool. By default the CLI uses a local advisory threshold of `50MB` to catch accidental bundled dependencies, old archives, caches, or generated assets. This threshold is not a documented CoreClaw platform hard limit. Adjust it with `--max-package-size`, or set `--max-package-size 0` to disable the advisory warning.

## Input Schema

`input_schema.json` defines the launch form shown on CoreClaw. The CLI validates it statically and also validates the actual runtime input before starting a local run.

The root object uses:

- `description`: optional Worker summary shown to users.
- `b`: required task-splitting key. It must match the `name` of an array property.
- `properties`: required array of input field definitions.

Example:

```json
{
  "description": "Fetch pages and return basic metadata.",
  "b": "urls",
  "properties": [
    {
      "title": "URLs",
      "name": "urls",
      "type": "array",
      "editor": "requestList",
      "default": [
        { "url": "https://example.com" }
      ],
      "required": true
    },
    {
      "title": "Timeout (ms)",
      "name": "timeoutMs",
      "type": "integer",
      "editor": "number",
      "minimum": 1000,
      "maximum": 120000,
      "default": 60000
    }
  ]
}
```

Supported property types:

- `string`
- `integer`
- `boolean`
- `array`
- `object`

Supported editors include:

- `input`
- `textarea`
- `number`
- `select`
- `radio`
- `checkbox`
- `switch`
- `datepicker`
- `requestList`
- `requestListSource`
- `stringList`

Important schema rules:

- Every `name` must be unique.
- `name` should be an ASCII identifier used by your code.
- `b` must point to an array property.
- `requestList` items must contain a non-empty `url`.
- `stringList` items must contain a non-empty `string`.
- `requestListSource` may define custom item parameters with `param_list`.
- `select`, `radio`, and `checkbox` values must be declared in `options`.
- Numeric inputs can declare `minimum` and `maximum`.
- Required fields must be present and non-empty at run time.

Run input can come from schema defaults, an input file, inline JSON, or a split item:

```bash
node ./bin/coreclaw.js run ./worker --input input.json
node ./bin/coreclaw.js run ./worker --json "{\"timeoutMs\":60000}"
node ./bin/coreclaw.js run ./worker --input-json "{\"timeoutMs\":60000}"
node ./bin/coreclaw.js run ./worker --split 0
```

On Windows and in CI, prefer `--input input.json` for complex payloads because shell quoting can modify inline JSON.

## Output Schema

`output_schema.json` defines the result table shown to users and exported from the platform. It is a JSON array:

```json
[
  {
    "name": "url",
    "type": "string",
    "description": "URL"
  },
  {
    "name": "status",
    "type": "string",
    "description": "Status"
  },
  {
    "name": "html_length",
    "type": "integer",
    "description": "HTML Length"
  }
]
```

Supported output types:

- `string`
- `integer`
- `boolean`
- `array`
- `object`

The `name` values must match the keys your Worker pushes through the SDK. During local runs the CLI writes:

- `results.ndjson`: raw SDK `push_data` rows.
- `export.ndjson`: rows projected through `output_schema.json`.
- `output_schema_issues.json`: field drift, extra fields, missing fields, wrong types, or non-object pushed rows.

Use `--require-output-schema-match` when schema drift should fail the local run or upload preflight.

## SDK Usage

Worker code communicates with CoreClaw through the SDK files included in the project. CoreClaw CLI runs a local compatible gRPC server so these calls work on your machine.

### Read Input

Python:

```python
from sdk import CoreSDK

input_dict = CoreSDK.Parameter.get_input_json_dict()
input_json = CoreSDK.Parameter.get_input_json_str()
```

Node.js:

```javascript
const coresdk = require('./sdk')

const input = await coresdk.parameter.getInputJSONObject()
const inputJson = await coresdk.parameter.getInputJSONString()
```

Go:

```go
inputJSON, err := coresdk.Parameter.GetInputJSONString(ctx)
```

### Log Progress

Python:

```python
CoreSDK.Log.debug("debug details")
CoreSDK.Log.info("normal progress")
CoreSDK.Log.warn("recoverable warning")
CoreSDK.Log.error("error details")
```

Node.js:

```javascript
await coresdk.log.debug('debug details')
await coresdk.log.info('normal progress')
await coresdk.log.warn('recoverable warning')
await coresdk.log.error('error details')
```

Go:

```go
coresdk.Log.Debug(ctx, "debug details")
coresdk.Log.Info(ctx, "normal progress")
coresdk.Log.Warn(ctx, "recoverable warning")
coresdk.Log.Error(ctx, "error details")
```

### Define Table Headers

```javascript
await coresdk.result.setTableHeader([
  { label: 'URL', key: 'url', format: 'text' },
  { label: 'Status', key: 'status', format: 'text' },
])
```

`set_table_header` is the runtime table contract. The CLI warns when a Worker never calls it. Add `--require-table-header` when it must be a hard gate.

### Push Result Rows

```javascript
await coresdk.result.pushData({
  url: 'https://example.com',
  status: 'ok',
})
```

Rows should be JSON objects whose keys match `output_schema.json` and the runtime table header keys.

## Command Reference

### `help`

Shows top-level help or command-specific help.

```bash
node ./bin/coreclaw.js --help
node ./bin/coreclaw.js help verify
node ./bin/coreclaw.js run --help
```

Use command-specific help when you know the workflow but need the exact flags or examples. Unknown command names also include a close-match suggestion when possible.

The same command metadata is published as [docs/commands.md](./docs/commands.md) for offline reading and release checks.

### `doctor`

Checks local tool availability and browser endpoint discovery.

```bash
node ./bin/coreclaw.js doctor
node ./bin/coreclaw.js doctor --python "py -3" --go go --strict
```

Use it before debugging Workers locally. It reports configured Python, Node.js, Go, and local Chrome CDP availability.

### `init`

Creates a new upload-ready Worker.

```bash
node ./bin/coreclaw.js init ./my-node-worker --language node --name my-node-worker
node ./bin/coreclaw.js init ./my-python-worker --language python
node ./bin/coreclaw.js init ./my-go-worker --language go
node ./bin/coreclaw.js init ./my-worker --language node --no-input-example
```

Options:

- `--language python|node|go`: Worker language.
- `--name <name>`: package/module name used where relevant.
- `--force`: overwrite an existing target directory.
- `--no-input-example`: skip the local `input.example.json` file.

Generated Workers include entry files, dependency files, SDK files, `README.md`, `input_schema.json`, `output_schema.json`, and by default a local `input.example.json` built from schema defaults.

### `validate`

Runs static upload-readiness checks.

```bash
node ./bin/coreclaw.js validate ./worker
node ./bin/coreclaw.js validate ./worker --strict
node ./bin/coreclaw.js validate ./worker --json-output
```

Validation covers:

- Required root files for Python, Node.js, and Go.
- Exactly one language entry file.
- SDK files.
- Dependency declarations.
- Node.js `main.js` and CommonJS package contract.
- Node.js third-party imports missing from runtime dependencies.
- Python third-party imports missing from `requirements.txt`.
- Go SDK dependencies and required `go.sum` checksums.
- `input_schema.json` structure, field names, editors, types, required fields, options, numeric bounds, and `b` split key.
- `output_schema.json` column names and supported types.
- HTTP Workers that appear to bypass `PROXY_AUTH` / `PROXY_DOMAIN`.
- Browser Workers that do not read `ChromeWs`, `ChromeHttp`, `LightpandaDomain`, `CDP_ENDPOINT`, or `BROWSER_WS_ENDPOINT`.

By default, compatibility warnings do not fail validation. Use `--strict` for new Workers or pre-upload checks where warnings should fail.

### `env`

Prints the CoreClaw runtime environment variables that `run` would inject, without starting the SDK runtime, Worker process, local proxy, or CDP shims.

```bash
node ./bin/coreclaw.js env ./worker
node ./bin/coreclaw.js env ./worker --cloud-proxy --lightpanda-domain lightpanda-inner.coreclaw.com
node ./bin/coreclaw.js env ./worker --proxy-auth user:pass --proxy-domain proxy.example:6000
node ./bin/coreclaw.js env ./worker --json-output
```

Use it when browser or proxy code is failing before the Worker reaches meaningful SDK logs, or when you want to confirm the exact names and normalized endpoint shapes before writing automation code. Sensitive values such as `PROXY_AUTH` are masked in output.

### `run`

Runs a Worker locally against the CoreClaw SDK runtime emulator.

```bash
node ./bin/coreclaw.js run ./worker --input input.json --min-results 1
node ./bin/coreclaw.js run ./worker --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./worker --split 0
node ./bin/coreclaw.js run ./worker --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./worker --strict --min-results 1
node ./bin/coreclaw.js run ./worker --input input.json --json-output
```

Important runtime gates:

```bash
node ./bin/coreclaw.js run ./worker --require-status-ok
node ./bin/coreclaw.js run ./worker --require-status-ok --result-status-fields status,check_status --result-fail-values fail,error
node ./bin/coreclaw.js run ./worker --require-table-header
node ./bin/coreclaw.js run ./worker --require-output-schema-match
node ./bin/coreclaw.js run ./worker --min-results 1
```

`--require-status-ok` fails when result rows contain failure-like status values. It checks `status` by default. Use `--result-status-fields` and `--result-fail-values` for Worker-specific fields and values.

`--strict` enables strict static validation plus default runtime gates for table header, output schema, and status rows unless explicitly overridden.

Run artifacts are written to:

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  upload_manifest.json
  logs.ndjson
  results.ndjson
  export.ndjson
  output_schema_issues.json
  table_headers.json
  captcha_solver_calls.json
  tmp/
  summary.json
```

Some files are present only when the related feature is used.

### `verify`

Runs upload preflight. This is the main command to use before uploading a Worker to CoreClaw.

```bash
node ./bin/coreclaw.js verify ./worker --strict --input input.json --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --no-pack
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
node ./bin/coreclaw.js verify ./worker --input input.json --json-output
```

`verify` performs these steps:

1. Static project validation.
2. Copy uploadable files into a clean staging directory.
3. Install dependencies in staging.
4. Execute the staged Worker through the local CoreClaw SDK runtime.
5. Enforce result-count and status gates.
6. Optionally compare with CoreClaw cloud output.
7. Create an upload ZIP unless `--no-pack` is used.
8. Inspect the generated package.

For Python, staged verify creates a temporary virtual environment so globally installed packages cannot hide missing `requirements.txt` entries.

For Node.js, staged verify installs runtime dependencies with `npm ci --omit=dev` or `npm install --omit=dev`, so dev-only packages cannot hide upload failures.

For Go, staged verify builds the Linux amd64 `main` executable and then runs from an upload-like runtime staging directory that contains the compiled binary and schema files.

`verify` defaults `--require-status-ok` on. Use `--no-require-status-ok` only when a Worker uses `status` for non-error domain labels.

Strict upload preflight:

```bash
node ./bin/coreclaw.js verify ./worker \
  --strict \
  --input input.json \
  --min-results 1 \
  --require-table-header \
  --require-output-schema-match
```

### `pack`

Creates an upload ZIP.

```bash
node ./bin/coreclaw.js pack ./worker --output ./dist/worker.zip
node ./bin/coreclaw.js pack ./worker --output ./dist/worker.zip --max-package-size 25MB --strict
node ./bin/coreclaw.js pack ./worker --print-files
node ./bin/coreclaw.js pack ./go-worker --output ./dist/go-worker.zip --go go --strict
```

`pack` validates the project, stages uploadable files, builds Go upload binaries when needed, writes a ZIP with root entry files, and runs package inspection. Use `--print-files` to preview the exact files that would be packaged without writing a ZIP. Package inspection reports the largest ZIP entries so oversized packages are actionable. Use `--max-package-size` to warn on unusually large upload packages, and use `--strict` when missing recommended metadata, package size warnings, or compatibility warnings should fail.

### `inspect-package`

Validates an existing upload ZIP, prints the largest compressed/uncompressed entries, and can compare the ZIP with a source project's expected upload manifest.

```bash
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language python
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --strict
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --project ./worker
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --max-package-size 25MB
```

It checks:

- Required root entry file.
- Required SDK and dependency files where applicable.
- Package size against a configurable local advisory threshold.
- Nested directory mistakes.
- Recommended metadata files.
- Go root executable named `main`.
- Go executable mode `100755`.

### `inspect-run`

Validates a captured local run directory.

```bash
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --min-results 1
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --require-status-ok
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --require-output-schema-match
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --json-output
```

Use this when you already have run artifacts and want to reapply result-count, status, or output-schema gates without rerunning the Worker.

### `compare`

Compares CoreClaw platform output with local output.

```bash
node ./bin/coreclaw.js compare \
  ./cloud-output.json \
  ./worker/.coreclaw/runs/<run-id> \
  --output ./tmp/cloud-comparison.json \
  --min-shared 1 \
  --max-diff 0 \
  --require-unique-keys \
  --require-status-ok \
  --output-schema ./worker/output_schema.json
```

Cloud output can be:

- A JSON array of result rows.
- A CoreClaw result-list API wrapper with rows under `data.list`, `data.rows`, `data.items`, `data.results`, `data.records`, or similar result containers.
- A CSV export file.

If the API response only contains `data.download_url`, download the export first and pass the downloaded JSON or CSV file to `compare`.

Useful options:

- `--key-fields url,check_name`: choose comparison key fields.
- `--ignore-fields completed_at,__coreclaw_data_id__`: ignore volatile fields.
- `--ignore-keys key1,key2`: ignore known platform-only or local-only rows.
- `--ignore-keys-file file`: load ignored keys from JSON or text.
- `--compare-profile profile.json`: reuse compare settings.
- `--min-shared <n>`: require at least N matching keys.
- `--max-diff <n>`: limit value differences.
- `--max-only-cloud <n>` / `--max-only-local <n>`: limit one-sided rows.
- `--require-output-schema-match`: validate rows against `output_schema.json`.
- `--require-status-ok`: fail on status failure rows.

`verify` can run the same comparison as part of upload preflight:

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output ./cloud-output.csv \
  --compare-output ./tmp/cloud-comparison.json \
  --min-shared 1 \
  --max-diff 0
```

Use `--no-compare` when you want `--cloud-output` recorded in command history but do not want to compare in that run.

### `audit`

Audits many Worker projects under a root directory.

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft

node ./bin/coreclaw.js audit E:/worker \
  --audit-profile ./examples/coreclaw-audit-profile.json \
  --fail-on-warn
```

By default, `audit` discovers `worker-*` directories. Use `--all` only when you intentionally want to validate any directory with a Worker entry file.

Useful options:

- `--recursive`: scan recursively.
- `--all`: include non-`worker-*` directories that look like Workers.
- `--soft`: write reports without failing the process.
- `--fail-on-warn`: treat warnings as failures.
- `--ignore-issue-codes code1,code2`: keep known issues visible but exclude them from pass/fail counts.
- `--audit-profile profile.json`: reuse audit settings.

The JSON report includes issue codes, evidence, docs-backed remediation text, ignored issues, and summary counts. The Markdown report is suitable for workspace reviews.

## Platform Feature Workflows

### HTTP SOCKS5 Proxy

CoreClaw HTTP request Workers must use the platform proxy because the runtime network is isolated. Read:

- `PROXY_AUTH`: `username:password`
- `PROXY_DOMAIN`: proxy host and port

Node.js example:

```javascript
const axios = require('axios')
const { SocksProxyAgent } = require('socks-proxy-agent')

const proxyAuth = process.env.PROXY_AUTH
const proxyDomain = process.env.PROXY_DOMAIN
const proxyUrl = proxyAuth && proxyDomain ? `socks5://${proxyAuth}@${proxyDomain}` : null

const axiosConfig = { timeout: 30000 }
if (proxyUrl) {
  const agent = new SocksProxyAgent(proxyUrl)
  axiosConfig.httpAgent = agent
  axiosConfig.httpsAgent = agent
  axiosConfig.proxy = false
}

const response = await axios.get('https://ipinfo.io/ip', axiosConfig)
```

Local proof:

```bash
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage --min-results 1
```

`--local-proxy` starts a local authenticated SOCKS5 proxy and injects matching env variables. `--require-proxy-usage` fails if the Worker never opens a SOCKS5 connection.

Use `--cloud-proxy` only to inject placeholder cloud-style variables without starting a real proxy:

```bash
node ./bin/coreclaw.js run ./worker --cloud-proxy
```

### Browser Automation

CoreClaw browser Workers should connect to platform-hosted browsers instead of launching a local browser in production code.

Common injected variables:

- `ChromeWs`: host-style CDP WebSocket endpoint for Playwright, Puppeteer, and DrissionPage.
- `ChromeHttp`: host-style HTTP endpoint for Selenium Remote WebDriver.
- `CDP_ENDPOINT`: full `ws://...` endpoint for tools that expect a complete URL.
- `BROWSER_WS_ENDPOINT`: full browser WebSocket endpoint alias.

Local Chrome discovery:

```bash
node ./bin/coreclaw.js doctor
node ./bin/coreclaw.js verify ./browser-worker --require-browser --min-results 1
```

If Chrome remote debugging is running on `127.0.0.1:9222`, the CLI discovers `/json/version` and injects the browser WebSocket path.

Explicit endpoint:

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --chrome-ws "127.0.0.1:9222/devtools/browser/<id>" \
  --require-browser \
  --min-results 1
```

Browser CDP contract shim:

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --browser-cdp-shim \
  --require-browser-cdp-shim \
  --min-results 1
```

The shim accepts `ws://<ChromeWs>/devtools/browser/<id>` and DrissionPage-style `ws://<ChromeWs>/ws?apiKey=<PROXY_AUTH>`. It is useful when you need to prove that Worker code reads and connects to CoreClaw's environment variables.

### Lightpanda

Lightpanda is a CoreClaw-hosted browser endpoint exposed through CDP. It is not an automation framework. You still use Playwright or another CDP client, but connect to `LightpandaDomain` instead of starting a browser locally.

Worker code should:

1. Read `LightpandaDomain`.
2. Normalize a bare domain to `ws://<domain>/devtools/browser/new`.
3. Read `PROXY_AUTH`.
4. Send Basic `Authorization` built from `PROXY_AUTH`.
5. Connect with Playwright `connect_over_cdp`.

Local contract proof:

```bash
node ./bin/coreclaw.js verify ./lightpanda-worker \
  --lightpanda-shim \
  --require-lightpanda-shim \
  --min-results 1
```

Use a real explicit endpoint when available:

```bash
node ./bin/coreclaw.js verify ./lightpanda-worker \
  --lightpanda-domain "lightpanda-inner.coreclaw.com" \
  --min-results 1
```

The shim validates the endpoint shape and Basic auth usage. Real navigation and rendering still require CoreClaw or a real upstream CDP endpoint.

### CAPTCHA Handling

CoreClaw exposes a custom CDP command:

```text
Captchas.automaticSolver
```

Parameters:

- `timeout`: positive number of seconds.
- `solverType`: one of the documented solver types.

Documented solver types:

- `cloudflare`
- `datadome`
- `google-v2`
- `google-v3`
- `oocl_slide`
- `perimeterx`
- `shein_same_object_click`
- `temu_auto`
- `tiktok_slide_simple`
- `tiktok_slide_auto`

Always branch on the command response. `status=false` or a message such as `target page don't have verify code` is not a success.

Local contract proof:

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --captcha-solver \
  --require-captcha-solver \
  --min-results 1
```

The local shim returns `{ "status": true }` for `Captchas.automaticSolver`, records calls in `captcha_solver_calls.json`, and fails when required calls are missing or params are invalid.

## Production-Ready Worker Workflow

Use this sequence for new Workers:

1. Generate or prepare the Worker project.
2. Write `input_schema.json` so the UI form matches the intended run parameters.
3. Write `output_schema.json` so output fields match `push_data` rows.
4. Read input through the SDK.
5. Log meaningful progress with the SDK.
6. Set runtime table headers.
7. Push one JSON object per result row.
8. Route HTTP requests through `PROXY_AUTH` / `PROXY_DOMAIN`.
9. Connect browser Workers through `ChromeWs`, `ChromeHttp`, `LightpandaDomain`, or full CDP endpoint env vars.
10. Run `coreclaw validate --strict`.
11. Run `coreclaw verify --strict --input input.json --min-results 1`.
12. Upload the ZIP produced by `verify`, or package with `coreclaw pack`.
13. Run the Worker on CoreClaw.
14. Export CoreClaw output as JSON or CSV.
15. Run `coreclaw compare` or `coreclaw verify --cloud-output`.

Recommended strict pre-upload command:

```bash
node ./bin/coreclaw.js verify ./worker \
  --strict \
  --input input.json \
  --min-results 1 \
  --max-package-size 50MB \
  --require-table-header \
  --require-output-schema-match
```

Add feature gates based on Worker type:

```bash
# HTTP request Worker
node ./bin/coreclaw.js verify ./worker --strict --input input.json --local-proxy --require-proxy-usage --min-results 1

# Browser Worker
node ./bin/coreclaw.js verify ./worker --strict --input input.json --require-browser --min-results 1

# Host-style ChromeWs / DrissionPage contract
node ./bin/coreclaw.js verify ./worker --strict --input input.json --browser-cdp-shim --require-browser-cdp-shim --min-results 1

# Lightpanda contract
node ./bin/coreclaw.js verify ./worker --strict --input input.json --lightpanda-shim --require-lightpanda-shim --min-results 1

# CAPTCHA CDP command contract
node ./bin/coreclaw.js verify ./worker --strict --input input.json --captcha-solver --require-captcha-solver --min-results 1
```

## Compare Profiles

A compare profile lets you keep cloud/local parity rules in a JSON file.

Example:

```json
{
  "key_fields": ["url", "check_name"],
  "ignore_fields": ["completed_at", "__coreclaw_data_id__"],
  "min_shared": 1,
  "max_diff": 0,
  "require_unique_keys": true,
  "require_status_ok": true,
  "result_status_fields": ["status"],
  "result_fail_values": ["fail", "failed", "failure", "error"]
}
```

Run:

```bash
node ./bin/coreclaw.js compare ./cloud-output.json ./worker/.coreclaw/runs/<run-id> --compare-profile ./compare-profile.json
```

`verify --compare-profile` can also read run defaults from the profile for recurring preflight checks, including proxy, browser, Lightpanda, CAPTCHA, and result-status settings.

## Exit Codes And Scripting

CoreClaw CLI is built for CI and repeatable local scripts:

- Unknown long options fail before the Worker starts.
- Options are validated per command.
- Boolean flags support `--flag`, `--no-flag`, and `--flag=true|false`.
- Most commands return exit code `0` on pass and non-zero on validation, runtime, package, or comparison failure.
- `validate`, `env`, `run`, `verify`, and `inspect-run` support `--json-output` for machine-readable stdout.
- In `--json-output` mode, progress and Worker logs are written to stderr while stdout remains one JSON document.
- Compare and audit reports can also be written to files with `--output`.

## Troubleshooting

### "The Worker runs locally but fails after upload"

Run upload preflight instead of source-directory run:

```bash
node ./bin/coreclaw.js verify ./worker --strict --input input.json --min-results 1
```

`verify` catches missing dependency declarations, ignored files, missing SDK files, output drift, missing runtime table headers, and package-root mistakes.

### "Go upload fails without Worker logs"

Inspect the package:

```bash
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go --strict
```

The ZIP root must contain executable `main` with mode `100755`. Do not upload only `main.go`.

### "HTTP requests work on my machine but not on CoreClaw"

Use the platform SOCKS5 variables:

```bash
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage --min-results 1
```

Validation also warns when HTTP libraries are detected but `PROXY_AUTH` and `PROXY_DOMAIN` are not read.

### "Browser Worker starts a local browser"

Production Worker code should connect to injected browser endpoints. Use local browser launch only behind an explicit local-development branch. Validate with:

```bash
node ./bin/coreclaw.js validate ./worker --strict
node ./bin/coreclaw.js verify ./worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
```

### "Cloud JSON contains only download_url"

Download the file first, then compare the downloaded JSON or CSV. `compare` reads result rows, not metadata-only API responses.

### "Inline JSON breaks on Windows"

Use an input file:

```bash
node ./bin/coreclaw.js verify ./worker --input input.json --min-results 1
```

## Repository Verification

For contributors to this CLI repository:

```bash
npm test
npm run verify
npm run verify:release
```

`npm run verify:release` runs the test suite, verifies the Node example with cloud-output comparison, checks whitespace with `git diff --check`, and runs `npm pack --dry-run --json`.

Workspace-level matrix tools are available for CoreClaw CLI maintainers:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-windows-worker-matrix.ps1
node .\tools\verify-platform-output.js worker-definition-node-puppeteer-contract-test E:\downloads\node-output.json
```

These tools are repository verification helpers. They are not required for ordinary Worker authors.

## License

MIT
