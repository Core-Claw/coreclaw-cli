# Contributing

CoreClaw CLI is the local verification tool for CoreClaw workers. Changes should improve the confidence that a worker passing locally will also pass after upload.

## Local Verification

Run the full local gate before pushing:

```bash
npm ci
npm run verify
```

`npm run verify` runs the unit suite, validates the Node example worker, executes it through the local CoreClaw gRPC runtime, checks that it emits at least one row, and creates an upload ZIP.

For real workers, use a result-count gate:

```bash
node ./bin/coreclaw.js run E:/worker/worker-yfinance \
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

## Runtime Compatibility Rules

- Do not make `output_schema.json` mandatory. CoreClaw currently accepts older workers without it, so the CLI treats it as a warning.
- Keep local proxy defaults direct. `PROXY_AUTH` and `PROXY_DOMAIN` must stay unset unless the user passes `--cloud-proxy` or explicit proxy options.
- Preserve per-run temporary state isolation. Node workers must not read stale host `/tmp` state during local verification.
- Browser workers should use CoreClaw's documented `ChromeWs` style. Local Chrome CDP discovery must keep working on Windows and Linux CI.
- A successful process exit is not enough for smoke tests. Use `--min-results` or `inspect-run --min-results`.

## Real Worker Smoke Matrix

Use representative workers when changing runtime behavior:

| Worker | Language | Purpose |
| --- | --- | --- |
| `worker-dedup-datasets` | Node.js | SDK results and `/tmp` isolation |
| `worker-yfinance` | Python | Direct network mode without cloud proxy |
| `worker-google-maps-scraper` | Go | Browser/CDP runtime with local Chrome |
| `worker-username-finder` | Node.js | Cloud/local output comparison and long network fan-out |

Network-heavy workers can differ from cloud output when the local machine cannot access the same upstream data or proxy/browser infrastructure. Record those differences instead of treating row-count drift as a CLI runtime failure.
