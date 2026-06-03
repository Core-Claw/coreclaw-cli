# node-lightpanda-cdp

This CoreClaw Worker demonstrates the Lightpanda CDP endpoint contract for Node.js. It reads `LightpandaDomain` and `PROXY_AUTH`, normalizes a bare Lightpanda domain to `ws://<domain>/devtools/browser/new`, sends Basic `Authorization`, calls `Browser.getVersion`, and writes the result through the CoreClaw SDK.

This example validates connection shape and authentication. It does not prove real page rendering, because rendering quality and compatibility require CoreClaw-hosted Lightpanda infrastructure or another real CDP upstream.

## Local Contract Test

```bash
coreclaw verify . --lightpanda-shim --require-lightpanda-shim --min-results 1 --require-table-header --require-output-schema-match
```

`--lightpanda-shim` injects a local `LightpandaDomain` and `PROXY_AUTH`. `--require-lightpanda-shim` fails if the Worker does not connect to `/devtools/browser/new` or omits Basic auth.

## Upload Package

```bash
coreclaw pack .
```

The upload ZIP includes `main.js`, `package.json`, SDK files, `README.md`, `input_schema.json`, and `output_schema.json` at the archive root.
