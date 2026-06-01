import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { startCaptchaCdpShim } from '../src/runtime/captcha-cdp-shim.js';

test('captcha CDP shim handles Captchas.automaticSolver', async () => {
  const shim = await startCaptchaCdpShim();
  try {
    const socket = await connect(shim.cdpEndpoint);
    const response = await sendCommand(socket, {
      id: 1,
      method: 'Captchas.automaticSolver',
      params: {
        timeout: 120,
        solverType: 'tiktok_slide_simple',
      },
    });

    assert.deepEqual(response, {
      id: 1,
      result: {
        status: true,
        message: 'CoreClaw local CAPTCHA solver shim',
      },
    });
    assert.equal(shim.stats.automaticSolverCalls, 1);
    assert.deepEqual(shim.stats.calls[0].params, {
      timeout: 120,
      solverType: 'tiktok_slide_simple',
    });
    assert.deepEqual(shim.stats.calls[0].issues, []);
    assert.deepEqual(shim.stats.invalidCalls, []);
    socket.close();
  } finally {
    await shim.stop();
  }
});

test('captcha CDP shim records invalid automaticSolver params', async () => {
  const shim = await startCaptchaCdpShim();
  try {
    const socket = await connect(shim.cdpEndpoint);
    const response = await sendCommand(socket, {
      id: 2,
      method: 'Captchas.automaticSolver',
      params: {
        timeout: '120',
        solverType: 'unknown_solver',
      },
    });

    assert.equal(response.result.status, true);
    assert.equal(shim.stats.automaticSolverCalls, 1);
    assert.deepEqual(shim.stats.calls[0].issues, [
      'timeout must be a positive number',
      'solverType "unknown_solver" is not documented by CoreClaw',
    ]);
    assert.equal(shim.stats.invalidCalls.length, 1);
    socket.close();
  } finally {
    await shim.stop();
  }
});

test('captcha CDP shim forwards non-captcha CDP commands upstream', async () => {
  const upstream = await startUpstreamCdpFixture();
  const shim = await startCaptchaCdpShim({ upstreamUrl: upstream.url });
  try {
    const socket = await connect(`ws://${shim.chromeWs}/ws?apiKey=coreclaw-local:coreclaw-local`);
    const response = await sendCommand(socket, {
      id: 7,
      method: 'Browser.getVersion',
    });

    assert.equal(response.id, 7);
    assert.equal(response.result.product, 'upstream-fixture');
    assert.deepEqual(shim.stats.paths, ['/ws?apiKey=coreclaw-local:coreclaw-local']);
    socket.close();
  } finally {
    await shim.stop();
    await upstream.stop();
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
