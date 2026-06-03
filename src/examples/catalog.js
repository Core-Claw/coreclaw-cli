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
];

export function examplesReport() {
  return {
    count: EXAMPLE_WORKERS.length,
    examples: EXAMPLE_WORKERS,
  };
}
