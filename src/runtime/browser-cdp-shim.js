import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const DEFAULT_BROWSER_ID = 'coreclaw-browser-shim';

export async function startBrowserCdpShim({
  upstreamUrl,
  store,
  browserId = DEFAULT_BROWSER_ID,
  browserLabel = 'CoreClaw local browser CDP shim',
} = {}) {
  const stats = {
    connections: 0,
    paths: [],
    authorizationHeaders: [],
    upstreamConnectionFailures: 0,
  };
  const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      const host = request.headers.host ?? localAddress(server);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({
        Browser: browserLabel,
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://${host}/devtools/browser/${browserId}`,
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
    stats.authorizationHeaders.push(request.headers.authorization ?? null);
    connections.add(client);

    let upstream = null;
    if (upstreamUrl) {
      upstream = new WebSocket(upstreamUrl);
      connections.add(upstream);
      upstream.on('message', (message) => safeSend(client, message));
      upstream.on('close', () => safeClose(client));
      upstream.on('error', (error) => {
        stats.upstreamConnectionFailures += 1;
        store?.recordLog('WARN', `Upstream CDP connection failed: ${error.message}`, 'coreclaw-browser');
      });
    }

    client.on('message', (message) => {
      if (upstream) {
        forwardWhenOpen(upstream, message);
        return;
      }
      if (handleLocalCdpMessage({ message: message.toString(), client, browserLabel })) {
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
  const cdpEndpoint = `ws://${domain}/devtools/browser/${browserId}`;

  return {
    domain,
    chromeWs: domain,
    chromeHttp: domain,
    cdpEndpoint,
    browserWsEndpoint: cdpEndpoint,
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

export function handleLocalCdpMessage({ message, client, browserLabel = 'CoreClaw local browser CDP shim' }) {
  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    return false;
  }

  if (payload?.method !== 'Browser.getVersion') {
    return false;
  }

  safeSend(client, JSON.stringify({
    id: payload.id,
    result: {
      protocolVersion: '1.3',
      product: browserLabel,
      revision: 'coreclaw-local',
      userAgent: 'CoreClawLocalBrowserShim/1.0',
      jsVersion: '0.0',
    },
  }));
  return true;
}

export function safeSend(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(message);
  }
}

export function safeClose(socket) {
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

export function forwardWhenOpen(socket, message) {
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
