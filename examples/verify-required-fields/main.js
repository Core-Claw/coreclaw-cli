const coresdk = require('./sdk')

async function main() {
  const input = await coresdk.parameter.getInputJSONObject()

  await coresdk.result.setTableHeader([
    { label: 'Field', key: 'field', format: 'text' },
    { label: 'Value', key: 'value', format: 'text' },
    { label: 'Status', key: 'status', format: 'text' },
  ])

  const fields = [
    'p_missing_title',
    'p_missing_description',
    'p_missing_editor',
    'p_missing_required',
    'p_missing_type',
    'p_naked',
    'p_valid',
  ]
  for (const field of fields) {
    const value = input[field]
    await coresdk.result.pushData({
      field,
      value: value === undefined ? '(undefined)' : String(value),
      status: 'probed',
    })
  }
}

main().catch(async (error) => {
  try { await coresdk.log.error(error.stack || error.message) } catch {}
  process.exitCode = 1
})
