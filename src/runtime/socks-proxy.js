import net from 'node:net';
import { CliError } from '../utils/errors.js';

const SOCKS_VERSION = 0x05;
const AUTH_METHOD_NONE = 0x00;
const AUTH_METHOD_PASSWORD = 0x02;
const AUTH_METHOD_REJECT = 0xff;
const AUTH_VERSION = 0x01;
const COMMAND_CONNECT = 0x01;
const ADDRESS_IPV4 = 0x01;
const ADDRESS_DOMAIN = 0x03;
const ADDRESS_IPV6 = 0x04;

export async function startSocksProxy({ host = '127.0.0.1', port = 0, auth = 'coreclaw-local:coreclaw-local', store = null } = {}) {
  const credentials = parseProxyAuth(auth);
  const stats = {
    connections: 0,
    authenticated: 0,
    connectRequests: 0,
    bytesUp: 0,
    bytesDown: 0,
    lastTarget: null,
  };
  const sockets = new Set();
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    handleClient(client, credentials, stats, store).catch((error) => {
      store?.recordLog('WARN', `Local SOCKS5 proxy rejected connection: ${error.message}`, 'proxy');
      client.destroy();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    host: address.address,
    port: address.port,
    auth,
    domain: `${address.address}:${address.port}`,
    stats,
    async stop() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function assertSocksProxyUsed(proxy, options = {}) {
  if (!options.requireProxyUsage) {
    return;
  }
  if (!proxy) {
    throw new CliError('--require-proxy-usage requires the local CoreClaw SOCKS5 proxy to be enabled.');
  }
  if (proxy.stats.connectRequests === 0) {
    throw new CliError('Worker did not use the local CoreClaw SOCKS5 proxy. CoreClaw cloud HTTP workers must route outbound traffic through PROXY_AUTH/PROXY_DOMAIN.');
  }
}

function parseProxyAuth(auth) {
  const text = String(auth ?? '');
  const separator = text.indexOf(':');
  if (separator <= 0 || separator === text.length - 1) {
    throw new CliError('Proxy auth must use username:password format.');
  }
  return {
    username: text.slice(0, separator),
    password: text.slice(separator + 1),
  };
}

async function handleClient(client, credentials, stats, store) {
  stats.connections += 1;
  client.setNoDelay(true);
  const reader = new SocketReader(client);
  const greetingHeader = await reader.readBytes(2);
  if (greetingHeader[0] !== SOCKS_VERSION) {
    throw new Error('invalid SOCKS greeting');
  }

  const methodCount = greetingHeader[1];
  const methods = await reader.readBytes(methodCount);
  if (!methods.includes(AUTH_METHOD_PASSWORD)) {
    client.write(Buffer.from([SOCKS_VERSION, AUTH_METHOD_REJECT]));
    throw new Error('client did not offer username/password authentication');
  }
  client.write(Buffer.from([SOCKS_VERSION, AUTH_METHOD_PASSWORD]));

  const authVersion = await reader.readBytes(1);
  const usernameLength = (await reader.readBytes(1))[0];
  const username = (await reader.readBytes(usernameLength)).toString('utf8');
  const passwordLength = (await reader.readBytes(1))[0];
  const password = (await reader.readBytes(passwordLength)).toString('utf8');
  if (authVersion[0] !== AUTH_VERSION || username !== credentials.username || password !== credentials.password) {
    client.write(Buffer.from([AUTH_VERSION, 0x01]));
    throw new Error('invalid proxy credentials');
  }
  stats.authenticated += 1;
  client.write(Buffer.from([AUTH_VERSION, 0x00]));

  const target = await readConnectRequest(reader);
  stats.connectRequests += 1;
  stats.lastTarget = `${target.host}:${target.port}`;
  store?.recordLog('INFO', `Local SOCKS5 proxy connecting to ${stats.lastTarget}`, 'proxy');

  const upstream = net.createConnection({ host: target.host, port: target.port });
  await new Promise((resolve, reject) => {
    upstream.once('connect', resolve);
    upstream.once('error', reject);
  }).catch((error) => {
    client.write(connectResponse(0x05));
    throw error;
  });

  client.write(connectResponse(0x00));
  const buffered = reader.drain();
  reader.detach();
  if (buffered.length > 0) {
    upstream.write(buffered);
  }
  client.on('data', (chunk) => {
    stats.bytesUp += chunk.length;
  });
  upstream.on('data', (chunk) => {
    stats.bytesDown += chunk.length;
  });
  client.pipe(upstream);
  upstream.pipe(client);
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
}

async function readConnectRequest(reader) {
  const header = await reader.readBytes(4);
  if (header[0] !== SOCKS_VERSION || header[1] !== COMMAND_CONNECT) {
    throw new Error('only SOCKS5 CONNECT requests are supported');
  }

  const addressType = header[3];
  let host;
  if (addressType === ADDRESS_IPV4) {
    host = Array.from(await reader.readBytes(4)).join('.');
  } else if (addressType === ADDRESS_DOMAIN) {
    const length = (await reader.readBytes(1))[0];
    host = (await reader.readBytes(length)).toString('utf8');
  } else if (addressType === ADDRESS_IPV6) {
    const address = await reader.readBytes(16);
    const parts = [];
    for (let index = 0; index < 16; index += 2) {
      parts.push(address.readUInt16BE(index).toString(16));
    }
    host = parts.join(':');
  } else {
    throw new Error(`unsupported SOCKS address type ${addressType}`);
  }

  const port = (await reader.readBytes(2)).readUInt16BE(0);
  return { host, port };
}

function connectResponse(code) {
  return Buffer.from([SOCKS_VERSION, code, 0x00, ADDRESS_IPV4, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiter = null;
    this.error = null;
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    };
    this.onError = (error) => {
      this.error = error;
      this.flush();
    };
    this.onClose = () => {
      this.error = new Error('socket closed');
      this.flush();
    };
    socket.on('data', this.onData);
    socket.once('error', this.onError);
    socket.once('close', this.onClose);
  }

  readBytes(length) {
    if (this.buffer.length >= length) {
      return Promise.resolve(this.take(length));
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    return new Promise((resolve, reject) => {
      this.waiter = { length, resolve, reject };
    });
  }

  drain() {
    const buffered = this.buffer;
    this.buffer = Buffer.alloc(0);
    return buffered;
  }

  detach() {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.waiter = null;
  }

  flush() {
    if (!this.waiter) {
      return;
    }
    if (this.buffer.length >= this.waiter.length) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.resolve(this.take(waiter.length));
      return;
    }
    if (this.error) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter.reject(this.error);
    }
  }

  take(length) {
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }
}
