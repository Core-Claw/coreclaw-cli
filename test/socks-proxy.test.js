import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { assertSocksProxyUsed, startSocksProxy } from '../src/runtime/socks-proxy.js';
import { CliError } from '../src/utils/errors.js';

test('local SOCKS5 proxy authenticates and forwards CONNECT traffic', async () => {
  const echoServer = net.createServer((socket) => {
    socket.once('data', (chunk) => {
      socket.write(Buffer.from(`echo:${chunk.toString('utf8')}`));
    });
  });
  echoServer.listen(0, '127.0.0.1');
  await once(echoServer, 'listening');

  const target = echoServer.address();
  const proxy = await startSocksProxy({ auth: 'user:pass' });
  const socket = net.createConnection({ host: proxy.host, port: proxy.port });
  await once(socket, 'connect');

  socket.write(Buffer.from([0x05, 0x01, 0x02]));
  assert.deepEqual(await readOnce(socket), Buffer.from([0x05, 0x02]));

  socket.write(Buffer.concat([
    Buffer.from([0x01, 0x04]),
    Buffer.from('user'),
    Buffer.from([0x04]),
    Buffer.from('pass'),
  ]));
  assert.deepEqual(await readOnce(socket), Buffer.from([0x01, 0x00]));

  const host = Buffer.from('127.0.0.1');
  socket.write(Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    host,
    portBytes(target.port),
  ]));
  assert.equal((await readOnce(socket))[1], 0x00);

  socket.write(Buffer.from('hello'));
  assert.equal((await readOnce(socket)).toString('utf8'), 'echo:hello');
  assert.equal(proxy.stats.connectRequests, 1);
  assert.equal(proxy.stats.lastTarget, `127.0.0.1:${target.port}`);

  socket.destroy();
  await proxy.stop();
  await new Promise((resolve) => echoServer.close(resolve));
});

test('assertSocksProxyUsed enforces proxy traffic when requested', () => {
  assert.throws(
    () => assertSocksProxyUsed({ stats: { connectRequests: 0 } }, { requireProxyUsage: true }),
    CliError,
  );
  assert.doesNotThrow(
    () => assertSocksProxyUsed({ stats: { connectRequests: 1 } }, { requireProxyUsage: true }),
  );
});

function readOnce(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for socket data'));
    }, 2000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };
    const onData = (chunk) => {
      cleanup();
      resolve(chunk);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once('data', onData);
    socket.once('error', onError);
  });
}

function portBytes(port) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(port, 0);
  return bytes;
}
