const coresdk = require('./sdk')

async function main() {
  const input = await coresdk.parameter.getInputJSONObject()
  const url = input.url || (Array.isArray(input.startUrls) && input.startUrls[0] ? input.startUrls[0].url : '')

  await coresdk.result.setTableHeader([
    { label: 'URL', key: 'url', format: 'text' },
    { label: 'Status', key: 'status', format: 'text' },
    { label: 'Title', key: 'title', format: 'text' },
  ])
  await coresdk.log.info(`Processing ${url}`)
  await coresdk.result.pushData({ url, status: 'success', title: 'Example Domain' })
}

main().catch(async (error) => {
  try { await coresdk.log.error(error.stack || error.message) } catch {}
  process.exitCode = 1
})
