# Contributing

CoreClaw CLI is the local verification tool for CoreClaw workers. Changes should improve the confidence that a worker passing locally will also pass after upload.

## Local Verification

Run the full local gate before pushing:

```bash
npm ci
npm run verify
```

`npm run verify` runs the unit suite and then runs `coreclaw verify` against the Node example worker, including a cloud-output comparison against `examples/node-hello-cloud-output.json`.

For real workers, use the upload preflight command:

```bash
node ./bin/coreclaw.js verify E:/worker/worker-yfinance \
  --input %TEMP%/coreclaw-yfinance-smoke-input.json \
  --command "py -3 main.py" \
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

## Runtime Compatibility Rules

- Do not make `output_schema.json` mandatory. CoreClaw currently accepts older workers without it, so the CLI treats it as a warning.
- Keep SDK runtime dependency checks strict. CoreClaw installs from `requirements.txt`, `package.json`, or `go.mod` after upload, so missing `grpcio`/`protobuf`, `@grpc/grpc-js`/`google-protobuf`, or `google.golang.org/grpc`/`google.golang.org/protobuf` should fail before packaging.
- Keep local proxy defaults direct. `PROXY_AUTH` and `PROXY_DOMAIN` must stay unset unless the user passes `--cloud-proxy` or explicit proxy options.
- Preserve per-run temporary state isolation. Node workers must not read stale host `/tmp` state during local verification.
- Browser workers should use CoreClaw's documented `ChromeWs` style. Local Chrome CDP discovery must keep working on Windows and Linux CI.
- A successful process exit is not enough for smoke tests. Use `--min-results` or `inspect-run --min-results`.
- Cloud parity claims need evidence. Use `coreclaw compare` when a platform output JSON is available.

## Real Worker Smoke Matrix

Use representative workers when changing runtime behavior:

| Worker | Language | Purpose |
| --- | --- | --- |
| `worker-dedup-datasets` | Node.js | SDK results and `/tmp` isolation |
| `worker-yfinance` | Python | Direct network mode without cloud proxy |
| `worker-google-maps-scraper` | Go | Browser/CDP runtime with local Chrome |
| `worker-username-finder` | Node.js | Cloud/local output comparison and long network fan-out |

Network-heavy workers can differ from cloud output when the local machine cannot access the same upstream data or proxy/browser infrastructure. Record those differences instead of treating row-count drift as a CLI runtime failure.
