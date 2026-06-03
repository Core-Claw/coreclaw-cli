const net = require('node:net')
const { URL } = require('node:url')
const coresdk = require('./sdk')

const SOCKS_VERSION = 0x05
const AUTH_METHOD_PASSWORD = 0x02
const AUTH_VERSION = 0x01
const COMMAND_CONNECT = 0x01
const ADDRESS_IPV4 = 0x01
const ADDRESS_DOMAIN = 0x03
const ADDRESS_IPV6 = 0x04

async function main() {
  const input = await coresdk.parameter.getInputJSONObject()
  const timeoutMs = integerInput(input.timeoutMs, 10000)
  const targets = normalizeTargets(input)

  await coresdk.result.setTableHeader([
    { label: 'URL', key: 'url', format: 'text' },
    { label: 'Status', key: 'status', format: 'text' },
    { label: 'HTTP Status', key: 'http_status', format: 'integer' },
    { label: 'Proxy Used', key: 'proxy_used', format: 'boolean' },
    { label: 'Error', key: 'error', format: 'text' },
  ])

  for (const target of targets) {
    await coresdk.log.info(`Fetching ${target.href} through CoreClaw proxy`)
    const row = await checkTarget(target, timeoutMs)
    await coresdk.result.pushData(row)
  }
}

async function checkTarget(target, timeoutMs) {
  let socket = null
  try {
    socket = await socks5Connect({
      proxyAuth: requiredEnv('PROXY_AUTH'),
      proxyDomain: requiredEnv('PROXY_DOMAIN'),
      targetHost: target.hostname,
      targetPort: target.port ? Number(target.port) : 80,
      timeoutMs,
    })
    const responseHead = await httpGetOverSocket(socket, target, timeoutMs)
    const httpStatus = parseHttpStatus(responseHead)
    if (!httpStatus) {
      throw new Error('HTTP response status line was not found')
    }
    return {
      url: target.href,
      status: 'success',
      http_status: httpStatus,
      proxy_used: true,
      error: '',
    }
  } catch (error) {
    return {
      url: target.href,
      status: 'fail',
      http_status: 0,
      proxy_used: false,
      error: error.message,
    }
  } finally {
    socket?.destroy()
  }
}

function normalizeTargets(input) {
  const rawTargets = Array.isArray(input.targets) && input.targets.length > 0
    ? input.targets
    : [{ url: input.url || 'http://example.com/' }]
  return rawTargets.map((item) => {
    const rawUrl = typeof item === 'string' ? item : item.url
    const target = new URL(rawUrl)
    if (target.protocol !== 'http:') {
      throw new Error(`Only http:// URLs are supported by this dependency-free example: ${rawUrl}`)
    }
    return target
  })
}

function integerInput(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

async function socks5Connect({ proxyAuth, proxyDomain, targetHost, targetPort, timeoutMs }) {
  const [proxyHost, proxyPortText] = proxyDomain.split(':')
  const proxyPort = Number.parseInt(proxyPortText, 10)
  if (!proxyHost || !Number.isInteger(proxyPort)) {
    throw new Error(`Invalid PROXY_DOMAIN: ${proxyDomain}`)
  }

  const separator = proxyAuth.indexOf(':')
  if (separator <= 0 || separator === proxyAuth.length - 1) {
    throw new Error('PROXY_AUTH must use username:password format')
  }

  const username = Buffer.from(proxyAuth.slice(0, separator))
  const password = Buffer.from(proxyAuth.slice(separator + 1))
  const socket = net.createConnection({ host: proxyHost, port: proxyPort })
  const reader = new SocketReader(socket, timeoutMs)

  try {
    await onceSocket(socket, 'connect', timeoutMs)
    socket.write(Buffer.from([SOCKS_VERSION, 0x01, AUTH_METHOD_PASSWORD]))
    assertBytes(await reader.readBytes(2), [SOCKS_VERSION, AUTH_METHOD_PASSWORD], 'proxy auth method')

    socket.write(Buffer.concat([
      Buffer.from([AUTH_VERSION, username.length]),
      username,
      Buffer.from([password.length]),
      password,
    ]))
    assertBytes(await reader.readBytes(2), [AUTH_VERSION, 0x00], 'proxy authentication')

    socket.write(Buffer.concat([
      Buffer.from([SOCKS_VERSION, COMMAND_CONNECT, 0x00]),
      socksAddress(targetHost),
      portBytes(targetPort),
    ]))
    await readSocksConnectResponse(reader)

    reader.detach()
    return socket
  } catch (error) {
    reader.detach()
    socket.destroy()
    throw error
  }
}

function socksAddress(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return Buffer.from([ADDRESS_IPV4, ...host.split('.').map((part) => Number.parseInt(part, 10))])
  }
  const domain = Buffer.from(host)
  return Buffer.concat([Buffer.from([ADDRESS_DOMAIN, domain.length]), domain])
}

function portBytes(port) {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(port, 0)
  return bytes
}

async function readSocksConnectResponse(reader) {
  const header = await reader.readBytes(4)
  if (header[0] !== SOCKS_VERSION || header[1] !== 0x00) {
    throw new Error(`SOCKS5 CONNECT failed with code ${header[1]}`)
  }

  if (header[3] === ADDRESS_IPV4) {
    await reader.readBytes(4)
  } else if (header[3] === ADDRESS_DOMAIN) {
    const length = (await reader.readBytes(1))[0]
    await reader.readBytes(length)
  } else if (header[3] === ADDRESS_IPV6) {
    await reader.readBytes(16)
  } else {
    throw new Error(`Unsupported SOCKS5 response address type ${header[3]}`)
  }
  await reader.readBytes(2)
}

async function httpGetOverSocket(socket, target, timeoutMs) {
  const requestPath = `${target.pathname || '/'}${target.search || ''}`
  socket.write([
    `GET ${requestPath} HTTP/1.1`,
    `Host: ${target.host}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n'))

  const response = await readUntil(socket, '\r\n\r\n', timeoutMs)
  return response.toString('utf8')
}

function parseHttpStatus(responseHead) {
  const match = responseHead.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/)
  return match ? Number.parseInt(match[1], 10) : 0
}

function assertBytes(actual, expected, label) {
  if (!Buffer.from(expected).equals(actual)) {
    throw new Error(`Unexpected ${label} response`)
  }
}

function onceSocket(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(reject, new Error(`Timed out waiting for socket ${event}`)), timeoutMs)
    const cleanup = (done, value) => {
      clearTimeout(timer)
      socket.off(event, onEvent)
      socket.off('error', onError)
      done(value)
    }
    const onEvent = () => cleanup(resolve)
    const onError = (error) => cleanup(reject, error)
    socket.once(event, onEvent)
    socket.once('error', onError)
  })
}

function readUntil(socket, marker, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const markerBuffer = Buffer.from(marker)
    const timer = setTimeout(() => cleanup(reject, new Error('Timed out waiting for HTTP response')), timeoutMs)
    const cleanup = (done, value) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      done(value)
    }
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.includes(markerBuffer)) {
        cleanup(resolve, buffer)
      }
    }
    const onError = (error) => cleanup(reject, error)
    const onClose = () => cleanup(resolve, buffer)
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

class SocketReader {
  constructor(socket, timeoutMs) {
    this.socket = socket
    this.timeoutMs = timeoutMs
    this.buffer = Buffer.alloc(0)
    this.waiter = null
    this.error = null
    this.onData = (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.flush()
    }
    this.onError = (error) => {
      this.error = error
      this.flush()
    }
    this.onClose = () => {
      this.error = new Error('socket closed')
      this.flush()
    }
    socket.on('data', this.onData)
    socket.once('error', this.onError)
    socket.once('close', this.onClose)
  }

  readBytes(length) {
    if (this.buffer.length >= length) {
      return Promise.resolve(this.take(length))
    }
    if (this.error) {
      return Promise.reject(this.error)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null
        reject(new Error(`Timed out waiting for ${length} byte(s)`))
      }, this.timeoutMs)
      this.waiter = { length, resolve, reject, timer }
    })
  }

  detach() {
    this.socket.off('data', this.onData)
    this.socket.off('error', this.onError)
    this.socket.off('close', this.onClose)
    if (this.waiter?.timer) {
      clearTimeout(this.waiter.timer)
    }
    this.waiter = null
  }

  flush() {
    if (!this.waiter) {
      return
    }
    if (this.buffer.length >= this.waiter.length) {
      const waiter = this.waiter
      this.waiter = null
      clearTimeout(waiter.timer)
      waiter.resolve(this.take(waiter.length))
      return
    }
    if (this.error) {
      const waiter = this.waiter
      this.waiter = null
      clearTimeout(waiter.timer)
      waiter.reject(this.error)
    }
  }

  take(length) {
    const value = this.buffer.subarray(0, length)
    this.buffer = this.buffer.subarray(length)
    return value
  }
}

main().catch(async (error) => {
  try { await coresdk.log.error(error.stack || error.message) } catch {}
  process.exitCode = 1
})
