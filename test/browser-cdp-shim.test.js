import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { startBrowserCdpShim } from '../src/runtime/browser-cdp-shim.js';

test('browser CDP shim accepts CoreClaw host-style and DrissionPage paths', async () => {
  const upstream = await startUpstreamCdpFixture();
  const shim = await startBrowserCdpShim({ upstreamUrl: upstream.url });
  try {
    const direct = await connect(shim.cdpEndpoint);
    const directResponse = await sendCommand(direct, { id: 1, method: 'Browser.getVersion' });
    direct.close();

    const drission = await connect(`ws://${shim.chromeWs}/ws?apiKey=coreclaw-local:coreclaw-local`);
    const drissionResponse = await sendCommand(drission, { id: 2, method: 'Browser.getVersion' });
    drission.close();

    assert.equal(directResponse.result.product, 'upstream-fixture');
    assert.equal(drissionResponse.result.product, 'upstream-fixture');
    assert.deepEqual(shim.stats.paths, [
      '/devtools/browser/coreclaw-browser-shim',
      '/ws?apiKey=coreclaw-local:coreclaw-local',
    ]);
  } finally {
    await shim.stop();
    await upstream.stop();
  }
});

test('browser CDP shim answers basic CDP metadata without an upstream browser', async () => {
  const shim = await startBrowserCdpShim();
  try {
    const socket = await connect(`ws://${shim.chromeWs}/ws?apiKey=coreclaw-local:coreclaw-local`);
    const response = await sendCommand(socket, { id: 1, method: 'Browser.getVersion' });
    socket.close();

    assert.equal(response.result.product, 'CoreClaw local browser CDP shim');
  } finally {
    await shim.stop();
  }
});

test('browser CDP shim exposes /json/version metadata', async () => {
  const shim = await startBrowserCdpShim();
  try {
    const response = await fetch(`http://${shim.chromeHttp}/json/version`);
    const metadata = await response.json();

    assert.equal(response.ok, true);
    assert.equal(metadata.webSocketDebuggerUrl, shim.cdpEndpoint);
  } finally {
    await shim.stop();
  }
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function sendCommand(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.once('message', (message) => resolve(JSON.parse(message.toString())));
    socket.once('error', reject);
    socket.send(JSON.stringify(payload));
  });
}

async function startUpstreamCdpFixture() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  wss.on('connection', (socket) => {
    socket.on('message', (message) => {
      const request = JSON.parse(message.toString());
      socket.send(JSON.stringify({
        id: request.id,
        result: {
          product: 'upstream-fixture',
        },
      }));
    });
  });

  await new Promise((resolve) => wss.once('listening', resolve));
  const address = wss.address();
  return {
    url: `ws://127.0.0.1:${address.port}`,
    async stop() {
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
