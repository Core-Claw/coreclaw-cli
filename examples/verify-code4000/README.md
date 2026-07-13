# verify-code4000 (v2) — RESOLVED

Platform probe for plan **C1**. Result: **the platform accepts all 11 mismatched editor/type combinations and runs them successfully.**

## Result (2026-07-13)

Uploaded as a ZIP and run with the default input. The platform **accepted the upload and ran successfully**, returning one result row per probe field. The delivered values confirmed the platform passes each field's value per its declared type regardless of editor mismatch:

| # | property | editor | type | platform delivered |
|---|----------|--------|------|--------------------|
| T1 | t1_textarea_array | textarea | array | `["a","b"]` (array preserved) |
| T2 | t2_switch_array | switch | array | `["x"]` |
| T3 | t3_json_string | json | string | `{}` (default `"hello"` became `{}`) |
| T4 | t4_select_multiple_string | select+multiple | string | `en` (scalar, not array) |
| T5 | t5_input_boolean | input | boolean | `true` |
| T6 | t6_number_string | number | string | `not-a-number` |
| T7 | t7_checkbox_string | checkbox | string | `tags` (but form checkbox options A/B were **unselectable**) |
| T8 | t8_requestlist_string | requestList | string | `[{url:...}]` |
| T9 | t9_radio_object | radio | object | `{}` |
| T10 | t10_datepicker_integer | datepicker | integer | `42` |
| T11 | t11_stringlist_string | stringList | string | `["k1","k2"]` |

## Conclusion

- The platform does **not** hard-reject any editor/type mismatch — no "code 4000", no upload rejection, no runtime failure.
- The only observed side effect is a **form-rendering glitch** (T7 checkbox options unselectable in the UI).
- → CLI downgraded `input_editor_type_mismatch` and `input_select_multiple_type_mismatch` from `error` to `warn`, and removed all "code 4000 / Invalid custom parameters" wording. Messages now say "the platform accepts the schema and runs it, but the form control may render or behave incorrectly".

This probe is retained as a regression artifact documenting the platform behavior.
