import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { forwardWhenOpen, handleLocalCdpMessage, safeClose, safeSend } from './browser-cdp-shim.js';

const DEFAULT_RESULT = {
  status: true,
  message: 'CoreClaw local CAPTCHA solver shim',
};

const SUPPORTED_SOLVER_TYPES = new Set([
  'cloudflare',
  'datadome',
  'google-v2',
  'google-v3',
  'oocl_slide',
  'perimeterx',
  'shein_same_object_click',
  'temu_auto',
  'tiktok_slide_simple',
  'tiktok_slide_auto',
]);

export async function startCaptchaCdpShim({
  upstreamUrl,
  result = DEFAULT_RESULT,
  store,
} = {}) {
  const stats = {
    connections: 0,
    paths: [],
    automaticSolverCalls: 0,
    calls: [],
    invalidCalls: [],
  };
  const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      const host = request.headers.host ?? localAddress(server);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({
        Browser: 'CoreClaw local CAPTCHA CDP shim',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://${host}/devtools/browser/coreclaw-captcha-shim`,
      })}\n`);
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not found"}\n');
  });
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Set();

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client, request) => {
    stats.connections += 1;
    stats.paths.push(request.url ?? '/');
    connections.add(client);
    let upstream = null;
    if (upstreamUrl) {
      upstream = new WebSocket(upstreamUrl);
      connections.add(upstream);
      upstream.on('message', (message) => safeSend(client, message));
      upstream.on('close', () => safeClose(client));
      upstream.on('error', (error) => {
        store?.recordLog('WARN', `Upstream CDP connection failed: ${error.message}`, 'coreclaw-captcha');
      });
    }

    client.on('message', (message) => {
      const handled = handleClientMessage({
        message: message.toString(),
        client,
        upstream,
        stats,
        result,
        store,
      });
      if (handled) {
        return;
      }
      if (upstream) {
        forwardWhenOpen(upstream, message);
        return;
      }
      if (handleLocalCdpMessage({ message: message.toString(), client, browserLabel: 'CoreClaw local CAPTCHA CDP shim' })) {
        return;
      }
    });
    client.on('close', () => {
      connections.delete(client);
      safeClose(upstream);
    });
    client.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const domain = localAddress(server);

  return {
    domain,
    chromeWs: domain,
    chromeHttp: domain,
    cdpEndpoint: `ws://${domain}/devtools/browser/coreclaw-captcha-shim`,
    browserWsEndpoint: `ws://${domain}/devtools/browser/coreclaw-captcha-shim`,
    stats,
    async stop() {
      for (const connection of connections) {
        safeClose(connection);
      }
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function handleClientMessage({ message, client, stats, result, store }) {
  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    return false;
  }

  if (payload?.method !== 'Captchas.automaticSolver') {
    return false;
  }

  stats.automaticSolverCalls += 1;
  const issues = validateAutomaticSolverParams(payload.params);
  stats.calls.push({
    time: new Date().toISOString(),
    params: payload.params ?? {},
    issues,
  });
  if (issues.length > 0) {
    stats.invalidCalls.push({
      time: new Date().toISOString(),
      params: payload.params ?? {},
      issues,
    });
    store?.recordLog('WARN', `Local CAPTCHA solver shim saw invalid Captchas.automaticSolver params: ${issues.join('; ')}`, 'coreclaw-captcha');
  } else {
    store?.recordLog('INFO', `Local CAPTCHA solver shim handled Captchas.automaticSolver (${JSON.stringify(payload.params ?? {})})`, 'coreclaw-captcha');
  }
  safeSend(client, JSON.stringify({
    id: payload.id,
    result,
  }));
  return true;
}

function validateAutomaticSolverParams(params) {
  const issues = [];
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return ['params must be an object with timeout and solverType'];
  }

  if (typeof params.timeout !== 'number' || !Number.isFinite(params.timeout) || params.timeout <= 0) {
    issues.push('timeout must be a positive number');
  }

  if (typeof params.solverType !== 'string' || params.solverType.length === 0) {
    issues.push('solverType must be a non-empty string');
  } else if (!SUPPORTED_SOLVER_TYPES.has(params.solverType)) {
    issues.push(`solverType "${params.solverType}" is not documented by CoreClaw`);
  }

  return issues;
}

function localAddress(server) {
  const address = server.address();
  return `127.0.0.1:${address.port}`;
}
