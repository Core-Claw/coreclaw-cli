export const EXAMPLE_WORKERS = [
  {
    name: 'node-hello',
    language: 'node',
    path: 'examples/node-hello',
    purpose: 'Minimal Node.js Worker with SDK input, logs, table headers, and result output.',
    contract: 'Node.js SDK and upload package baseline',
    verify: 'coreclaw verify ./examples/node-hello --min-results 1 --require-table-header --require-output-schema-match',
  },
  {
    name: 'python-hello',
    language: 'python',
    path: 'examples/python-hello',
    purpose: 'Minimal Python Worker with SDK input, logs, table headers, and result output.',
    contract: 'Python SDK, requirements.txt, and upload package baseline',
    verify: 'coreclaw verify ./examples/python-hello --min-results 1 --require-table-header --require-output-schema-match',
  },
  {
    name: 'node-http-proxy',
    language: 'node',
    path: 'examples/node-http-proxy',
    purpose: 'Node.js Worker that sends an HTTP request through the injected SOCKS5 proxy.',
    contract: 'PROXY_AUTH and PROXY_DOMAIN usage',
    verify: 'coreclaw verify ./examples/node-http-proxy --local-proxy --require-proxy-usage --min-results 1 --require-table-header --require-output-schema-match',
  },
  {
    name: 'node-lightpanda-cdp',
    language: 'node',
    path: 'examples/node-lightpanda-cdp',
    purpose: 'Node.js Worker that connects to Lightpanda CDP with Basic auth and calls Browser.getVersion.',
    contract: 'LightpandaDomain normalization and PROXY_AUTH Basic auth',
    verify: 'coreclaw verify ./examples/node-lightpanda-cdp --lightpanda-shim --require-lightpanda-shim --min-results 1 --require-table-header --require-output-schema-match',
  },
  {
    name: 'verify-code4000',
    language: 'node',
    path: 'examples/verify-code4000',
    purpose: 'Regression artifact: 11 mismatched editor/type combos. Platform verification (2026-07-13) confirmed all are accepted and run; only form-rendering glitches occur. CLI now warns (not errors) on editor/type mismatch.',
    contract: 'Plan C1 — resolved: editor/type mismatch is warn, "code 4000" wording removed',
    verify: 'Upload examples/verify-code4000 as a ZIP and confirm the platform accepts and runs (regression check).',
  },
  {
    name: 'verify-required-fields',
    language: 'node',
    path: 'examples/verify-required-fields',
    purpose: 'Regression artifact: 7 properties each omitting a different documented-required field. Platform verification (2026-07-13) confirmed all are accepted and run, even missing type and naked name-only.',
    contract: 'Plan C2 — resolved: missing title/editor/description/required stays warn (platform does not enforce)',
    verify: 'Upload examples/verify-required-fields as a ZIP and confirm the platform accepts and runs (regression check).',
  },
];

export function examplesReport() {
  return {
    count: EXAMPLE_WORKERS.length,
    examples: EXAMPLE_WORKERS,
  };
}
