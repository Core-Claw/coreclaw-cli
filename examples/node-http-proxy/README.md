# node-http-proxy

This CoreClaw Worker demonstrates the HTTP proxy contract for Node.js. It reads `PROXY_AUTH` and `PROXY_DOMAIN`, opens a SOCKS5 connection, sends an HTTP request through that connection, and writes a result row through the CoreClaw SDK.

The example intentionally uses Node built-ins instead of a third-party HTTP client so it can run immediately from the published CLI package. Production Workers can use packages such as `axios` plus a SOCKS agent, but those runtime dependencies must be declared in `package.json`.

## Local Contract Test

```bash
coreclaw verify . --local-proxy --require-proxy-usage --min-results 1 --require-table-header --require-output-schema-match
```

`--local-proxy` injects local `PROXY_AUTH` and `PROXY_DOMAIN` values. `--require-proxy-usage` fails the run if the Worker never opens a SOCKS5 CONNECT request.

## Upload Package

```bash
coreclaw pack .
```

The upload ZIP includes `main.js`, `package.json`, SDK files, `README.md`, `input_schema.json`, and `output_schema.json` at the archive root.
