const { WebSocket } = require('ws')
const coresdk = require('./sdk')

async function main() {
  const input = await coresdk.parameter.getInputJSONObject()
  const timeoutMs = integerInput(input.timeoutMs, 10000)
  const endpoint = lightpandaEndpoint(requiredEnv('LightpandaDomain'))
  const proxyAuth = requiredEnv('PROXY_AUTH')

  await coresdk.result.setTableHeader([
    { label: 'Check', key: 'check_name', format: 'text' },
    { label: 'Status', key: 'status', format: 'text' },
    { label: 'Endpoint', key: 'endpoint', format: 'text' },
    { label: 'Product', key: 'product', format: 'text' },
    { label: 'Error', key: 'error', format: 'text' },
  ])

  await coresdk.log.info(`Connecting to Lightpanda CDP endpoint: ${endpoint}`)
  const row = await checkLightpanda({ endpoint, proxyAuth, timeoutMs })
  await coresdk.result.pushData(row)
}

async function checkLightpanda({ endpoint, proxyAuth, timeoutMs }) {
  try {
    const response = await sendCdpCommand({
      endpoint,
      proxyAuth,
      timeoutMs,
      payload: { id: 1, method: 'Browser.getVersion' },
    })
    return {
      check_name: 'lightpanda-cdp',
      status: response?.result?.product ? 'success' : 'fail',
      endpoint,
      product: response?.result?.product ?? '',
      error: response?.result?.product ? '' : 'Browser.getVersion did not return product metadata',
    }
  } catch (error) {
    return {
      check_name: 'lightpanda-cdp',
      status: 'fail',
      endpoint,
      product: '',
      error: error.message,
    }
  }
}

function sendCdpCommand({ endpoint, proxyAuth, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, {
      headers: {
        Authorization: basicAuthHeader(proxyAuth),
      },
    })
    const timer = setTimeout(() => {
      cleanup()
      socket.close()
      reject(new Error('Timed out waiting for Lightpanda CDP response'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
    }
    const onOpen = () => {
      socket.send(JSON.stringify(payload))
    }
    const onMessage = (event) => {
      cleanup()
      socket.close()
      try {
        resolve(JSON.parse(event.data))
      } catch (error) {
        reject(error)
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('Lightpanda CDP socket closed before response'))
    }

    socket.addEventListener('open', onOpen)
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
  })
}

function lightpandaEndpoint(value) {
  const endpoint = String(value ?? '').trim().replace(/\/+$/, '')
  if (!endpoint) {
    throw new Error('LightpandaDomain is not set')
  }
  if (/^(ws|wss|http|https):\/\//i.test(endpoint)) {
    return endpoint
  }
  return `ws://${endpoint}/devtools/browser/new`
}

function basicAuthHeader(auth) {
  return `Basic ${Buffer.from(auth, 'utf8').toString('base64')}`
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

function integerInput(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

main().catch(async (error) => {
  try { await coresdk.log.error(error.stack || error.message) } catch {}
  process.exitCode = 1
})
