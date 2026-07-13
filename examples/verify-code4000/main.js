const coresdk = require('./sdk')

async function main() {
  const input = await coresdk.parameter.getInputJSONObject()

  await coresdk.result.setTableHeader([
    { label: 'Field', key: 'field', format: 'text' },
    { label: 'Value', key: 'value', format: 'text' },
    { label: 'Status', key: 'status', format: 'text' },
  ])

  // Echo every probe field back so we can see how the platform delivered each value.
  const fields = [
    't1_textarea_array',
    't2_switch_array',
    't3_json_string',
    't4_select_multiple_string',
    't5_input_boolean',
    't6_number_string',
    't7_checkbox_string',
    't8_requestlist_string',
    't9_radio_object',
    't10_datepicker_integer',
    't11_stringlist_string',
  ]
  for (const field of fields) {
    const value = input[field]
    await coresdk.result.pushData({
      field,
      value: value === undefined ? '(undefined)' : (typeof value === 'object' ? JSON.stringify(value) : String(value)),
      status: 'probed',
    })
  }
}

main().catch(async (error) => {
  try { await coresdk.log.error(error.stack || error.message) } catch {}
  process.exitCode = 1
})
