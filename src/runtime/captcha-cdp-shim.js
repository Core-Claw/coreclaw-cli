import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_RESULT = {
  status: true,
  message: 'CoreClaw local CAPTCHA solver shim',
};

export async function startCaptchaCdpShim({
  upstreamUrl,
  result = DEFAULT_RESULT,
  store,
} = {}) {
  const stats = {
    automaticSolverCalls: 0,
    calls: [],
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

  wss.on('connection', (client) => {
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
      if (!handled && upstream) {
        forwardWhenOpen(upstream, message);
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
    chromeWs: `${domain}/devtools/browser/coreclaw-captcha-shim`,
    cdpEndpoint: `ws://${domain}/devtools/browser/coreclaw-captcha-shim`,
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
  stats.calls.push({
    time: new Date().toISOString(),
    params: payload.params ?? {},
  });
  store?.recordLog('INFO', `Local CAPTCHA solver shim handled Captchas.automaticSolver (${JSON.stringify(payload.params ?? {})})`, 'coreclaw-captcha');
  safeSend(client, JSON.stringify({
    id: payload.id,
    result,
  }));
  return true;
}

function safeSend(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(message);
  }
}

function safeClose(socket) {
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

function forwardWhenOpen(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(message);
    return;
  }
  socket.once('open', () => safeSend(socket, message));
}

function localAddress(server) {
  const address = server.address();
  return `127.0.0.1:${address.port}`;
}
