# Contributing

CoreClaw CLI is the local verification tool for CoreClaw workers. Changes should improve the confidence that a worker passing locally will also pass after upload.

## Local Verification

Run the full local gate before pushing:

```bash
npm ci
npm run verify
npm run verify:release
```

`npm run verify` runs the unit suite and then runs `coreclaw verify` against the Node example worker, including a cloud-output comparison against `examples/node-hello-cloud-output.json`.

`npm run verify:release` is the local release gate. It runs `npm run verify`, checks whitespace with `git diff --check`, and verifies the npm package contents with `npm pack --dry-run --json`. Use it before publishing or opening a release PR.

For real workers, use the upload preflight command:

```bash
node ./bin/coreclaw.js verify E:/worker/worker-yfinance \
  --input %TEMP%/coreclaw-yfinance-smoke-input.json \
  --python "py -3" \
  --timeout-ms 60s \
  --idle-timeout-ms 20s \
  --min-results 1
```

Then inspect the captured run:

```bash
node ./bin/coreclaw.js inspect-run E:/worker/worker-yfinance/.coreclaw/runs/<run-id> --min-results 1
```

When a cloud run export is available, compare it against the local run artifact:

```bash
node ./bin/coreclaw.js compare E:/worker/cloud-output.json E:/worker/worker-name/.coreclaw/runs/<run-id> \
  --output ./tmp/cloud-local-compare.json \
  --min-shared 1
```

The cloud path may be a JSON array export, a saved `/api/v1/run/result/list` response, or a downloaded CSV export. Do not compare the `/api/v1/run/result/export` wrapper directly when it only contains `data.download_url`; download that file first.

For workers whose cloud and local modes intentionally emit different platform-only rows, keep a `.coreclaw/profiles/*.json` compare profile with `key_fields`, `ignore_keys`, `min_shared`, `max_diff`, `max_only_cloud`, `max_only_local`, and `require_unique_keys`. The same profile can carry verify run defaults such as `local_proxy`, `require_status_ok`, and browser/CDP shim flags.

## Runtime Compatibility Rules

- Do not make `output_schema.json` mandatory. CoreClaw currently accepts older workers without it, so the CLI treats it as a warning.
- Keep SDK runtime dependency checks strict. CoreClaw installs from `requirements.txt`, `package.json`, or `go.mod` after upload, so missing `grpcio`/`protobuf`, `@grpc/grpc-js`/`google-protobuf`, or `google.golang.org/grpc`/`google.golang.org/protobuf` should fail before packaging.
- Keep `verify` upload-like by default. It should stage only files that would enter the upload ZIP, install dependencies there, and write run artifacts back to the original project.
- Keep local proxy defaults direct. `PROXY_AUTH` and `PROXY_DOMAIN` must stay unset unless the user passes `--cloud-proxy` or explicit proxy options.
- Preserve per-run temporary state isolation. Node workers must not read stale host `/tmp` state during local verification.
- Browser workers should use CoreClaw's documented `ChromeWs` or `LightpandaDomain` endpoint styles. Local Chrome CDP discovery and local CDP shims must keep working on Windows and Linux CI.
- Go upload parity must be checked from the upload package, not only from `go run .`. The platform expects a Linux amd64 root executable named `main`; `inspect-package --language go --strict` must report root `main` mode `100755`.
- A successful process exit is not enough for smoke tests. Use `--min-results` or `inspect-run --min-results`.
- Cloud parity claims need evidence. Use `coreclaw compare` when a platform output JSON, CSV, or result/list response is available.

## Real Worker Smoke Matrix

Use representative workers when changing runtime behavior:

| Worker | Language | Purpose |
| --- | --- | --- |
| `worker-dedup-datasets` | Node.js | SDK results and `/tmp` isolation |
| `worker-yfinance` | Python | Direct network mode without cloud proxy |
| `worker-google-maps-scraper` | Go | Browser/CDP runtime with local Chrome |
| `worker-username-finder` | Node.js | Cloud/local output comparison and long network fan-out |
| `worker-definition-docs-contract-test` | Python | Docs contract coverage plus cloud-output compare profiles |
| `worker-definition-node-puppeteer-contract-test` | Node.js | Node SDK, CommonJS packaging, and Puppeteer ChromeWs contract |
| `worker-definition-go-contract-test` | Go | Go source/project contract versus uploaded root `main` runtime contract |
| `worker-lightpanda-doc-test` | Python | LightpandaDomain endpoint normalization and CDP connection contract |

Network-heavy workers can differ from cloud output when the local machine cannot access the same upstream data or proxy/browser infrastructure. Record those differences instead of treating row-count drift as a CLI runtime failure.

Example commands from the current Windows validation workspace:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-windows-worker-matrix.ps1

node .\bin\coreclaw.js audit E:\worker --audit-profile examples\coreclaw-audit-profile.json --soft --output .coreclaw\reports\audit-soft-latest.json --markdown .coreclaw\reports\audit-soft-latest.md

node .\bin\coreclaw.js verify E:\worker\worker-definition-docs-contract-test --input E:\worker\worker-definition-docs-contract-test\.coreclaw\smoke-input.json --python "py -3" --no-pack --min-results 45 --compare-output E:\worker\worker-definition-docs-contract-test\.coreclaw\platform-compare-profile-final.json --cloud-output E:\downloads\coreclaw_v1.0.1_20260602.json --compare-profile E:\worker\worker-definition-docs-contract-test\.coreclaw\profiles\platform-all-vs-local-ignore-keys.json

node .\bin\coreclaw.js verify E:\worker\worker-definition-node-puppeteer-contract-test --input E:\worker\worker-definition-node-puppeteer-contract-test\.coreclaw\smoke-input.json --browser-cdp-shim --min-results 8 --output E:\worker\worker-definition-node-puppeteer-contract-test\.coreclaw\verify\latest-node-puppeteer-cli.zip

node .\bin\coreclaw.js verify E:\worker\worker-definition-go-contract-test --input E:\worker\worker-definition-go-contract-test\.coreclaw\smoke-input.json --go go --strict --no-install --no-require-status-ok --min-results 7 --output E:\worker\worker-definition-go-contract-test\.coreclaw\verify\latest-coreclaw-cli-go.zip
node .\bin\coreclaw.js inspect-package E:\worker\worker-definition-go-contract-test\.coreclaw\verify\latest-coreclaw-cli-go.zip --language go --strict

node .\bin\coreclaw.js verify E:\worker\worker-lightpanda-doc-test --input E:\worker\worker-lightpanda-doc-test\.coreclaw\smoke-input.json --python "py -3" --no-install --require-table-header --require-output-schema-match --min-results 1 --output E:\worker\worker-lightpanda-doc-test\.coreclaw\verify\latest-lightpanda-cli.zip
```

The PowerShell matrix script runs the commands below it in order and writes `.coreclaw/reports/windows-worker-matrix-latest.json` plus `.coreclaw/reports/windows-worker-matrix-latest.md`. Use the individual commands when diagnosing one worker; use the matrix script before handing upload candidates to the platform.

After uploading the candidate ZIPs, feed each platform result export back into the source workspace. The verifier accepts platform JSON arrays, saved `/api/v1/run/result/list` responses, and downloaded CSV exports:

```powershell
node .\tools\verify-platform-output.js worker-definition-docs-contract-test E:\downloads\coreclaw_v1.0.1_20260602.json --output .coreclaw\reports\platform-docs-contract-latest.json
node .\tools\verify-platform-output.js worker-definition-node-puppeteer-contract-test E:\downloads\node-puppeteer-platform-output.json --output .coreclaw\reports\platform-node-puppeteer-latest.json
node .\tools\verify-platform-output.js worker-definition-go-contract-test E:\downloads\go-contract-platform-output.json --output .coreclaw\reports\platform-go-contract-latest.json
node .\tools\verify-platform-output.js worker-lightpanda-doc-test E:\downloads\lightpanda-platform-output.json --output .coreclaw\reports\platform-lightpanda-latest.json
```

This platform-output verifier checks the worker-specific required `status=ok` rows, duplicate keys, minimum row counts, and unexpected failing statuses. It does not replace full cloud/local comparison for docs-contract; keep using `coreclaw compare` when both platform and local outputs should match row-for-row.

Use the browser CDP shim for the Node/Puppeteer contract worker. The local smoke input intentionally has `runPuppeteerProbe=false`, but the worker still validates that `PROXY_AUTH` and `ChromeWs` can form the documented endpoint URL; without `--browser-cdp-shim`, the result-status gate correctly fails on `puppeteer-endpoint-shape`. Do not use `--no-install` for this worker unless `node_modules` is deliberately staged another way; the upload-like staging directory must install `@grpc/grpc-js`, `google-protobuf`, and `puppeteer-core` from `package.json`.

The Go contract worker intentionally emits one `status=fail` row in local mode to document the mismatch between source project files and the uploaded root `main` runtime shape. Use `--no-require-status-ok` for that worker when the goal is to verify packaging/runtime mechanics, and keep the failing row as documentation evidence until the official Go upload docs are clarified.
