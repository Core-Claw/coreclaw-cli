# Concurrency Rules

Last Updated: 2026-07-11

Source: `C:/Users/user/Desktop/urls/最新脚本并发拆分规则说明.html` (2026-07 version, includes `limits`)

This is the CLI's extracted summary of the platform's task-splitting rules. The authoritative source is the HTML above; the CLI mirrors these rules in `src/runtime/input.js` (`expandSplitInput` / `expandConcurrencyInput`) and validates the schema in `src/validation/schema.js` (`validateConcurrencySchema`).

## Decision Order

1. If `input_schema.json` has non-empty `concurrency.fields`, use the new concurrency rules (split by `fields`).
2. If `concurrency.fields` is absent or empty and legacy `b` is non-empty, split by `b`.
3. If both are absent, the runtime treats the whole submitted custom object as a single task.
4. If both `concurrency.fields` and `b` exist, `concurrency.fields` wins and `b` is ignored.

## Root Fields

- `concurrency` is optional and must be an object when present.
- `concurrency.fields` is an optional string array of candidate split field names.
- `concurrency.remove_fields` is an optional string array. Every entry must also appear in `fields`.
- `concurrency.limits` is an optional object array of precharge (billing-count) cap rules. It does **not** change how many tasks are generated or what each task's custom contains — it only caps the precharged count per item.
- `b` is optional legacy compatibility. It is used only when `concurrency.fields` is absent or empty. Whitespace is trimmed.
- `properties` is the required schema field list.

## Schema Validation Expectations

- Each non-empty `concurrency.fields` item must match a `properties[*].name`.
- Each `concurrency.fields` property must have `type: "array"`.
- Each non-empty `concurrency.remove_fields` item must be a member of `concurrency.fields`.
- Legacy `b`, when it is the active split mechanism, must match a `properties[*].name` whose type is `array`.
- Unknown root-key warnings must treat `concurrency` as documented, not unknown.
- `stringList` defaults may use primitive strings or `{ "string": "value" }` objects.

## Active Field Selection

```text
preferred = fields - remove_fields
if preferred is non-empty and any preferred field has meaningful custom values:
    activeFields = preferred
else:
    activeFields = fields
```

When preferred fields are active, every `remove_fields` key is **deleted** from generated task custom objects. It is not retained as `[""]`.

When the fallback all-fields path is active, `remove_fields` is not applied; those fields may participate in splitting.

## Meaningful Items

The runtime filters empty concurrency items before deciding whether a field has values:

- `null`
- blank strings, including whitespace-only strings (`""`, `"   "`)
- empty objects `{}`
- objects whose values are all empty by these same rules (e.g. `{"place_id": ""}`, `{"a": null, "b": ""}`)

After filtering, an empty array means that field has no values.

## Split Result Shape

- For each selected primitive item (`string`, `number`, `boolean`), the generated task keeps the original split field name with a one-item array, for example `"keywords": ["pizza"]`.
- For each selected object item, the generated task merges object keys into the parent task custom object and removes the split field key itself.
- Other concurrency fields that are not selected for the current task are retained as `[""]`, unless they are disabled by active `remove_fields`.
- Multiple active fields produce the **union** of per-field split tasks, not a Cartesian product.
- With only one `concurrency.fields` entry, behavior is equivalent to legacy single-field splitting except the original field key is kept as a one-item array for primitive items.

## Element Type Matrix

- Object items are supported and merged into the task custom object.
- String, number, and boolean items are supported and wrapped as one-item arrays under the split field name.
- `null` is treated as empty.
- Nested arrays are invalid with `item at index N in [X] must be an object or primitive value`.
- A single split field must not mix object and primitive items; use `field [X] must not mix object and primitive items`.
- An object item must not contain a key equal to the concurrency field name; otherwise `item at index N in [X] must not override concurrency field`.
- Empty arrays in legacy `b` mode are errors: `concurrency field [X] is empty`.
- Empty arrays in new `concurrency.fields` mode mean that field is skipped; if every field is empty, error with `concurrency fields have no non-empty fields`.

## limits (precharge count caps)

`limits` lives under `concurrency` as an optional array. It caps how many collection units a single item precharges — it does **not** change task count or task custom content.

Each limit object:

| field | type | required | meaning |
| ----- | ---- | -------- | ------- |
| `field` | string | yes | The concurrency field being capped. Must be a member of `concurrency.fields` (e.g. `google_maps_urls`, `place_ids`). This is **not** a billing-quantity field like `max_results` or `limit_records`. |
| `regex` | string | no | Optional value-match regex. Matches the current item's **values** recursively (keys are not matched). Omitted → the rule matches every item of `field` unconditionally. |
| `max` | number | yes | Max precharge count per item. Must be > 0. |

Precharge count algorithm (per matched concurrency field):

```text
for each non-empty item of the field:
    baseAmount = count of billing fields inside the item
    if baseAmount <= 0:
        baseAmount = first billing-field count from the outer custom
    if baseAmount <= 0:
        baseAmount = 1
    matchedMax = smallest max among matched limits
    itemAmount = matchedMax > 0 ? min(baseAmount, matchedMax) : baseAmount
customDataAmount = sum of itemAmount
```

When `regex` is omitted, the rule hits every item of that field unconditionally. When `regex` is set, the runtime recursively extracts all value strings of the current item and matches them (keys are not matched). If multiple limits match the same item, the **smallest** `max` wins.

## Runtime Error Checklist

- Invalid schema JSON: `input_schema is not a valid json`.
- Custom input is not a single object: `custom parameters must contain a single JSON object`.
- New fields config has no valid field names: `concurrency fields must have at least one field`.
- New fields mode has no populated values: `concurrency fields have no non-empty fields`.
- Legacy `b` points to a missing custom field: `missing concurrency field [X]`.
- Split field exists but is not an array: `field [X] must be an array`.
- Legacy `b` array is empty: `concurrency field [X] is empty`.
- Nested array or unsupported item: `item at index N in [X] must be an object or primitive value`.
- Mixed object and primitive items: `field [X] must not mix object and primitive items`.
- Object item overrides the concurrency field name: `item at index N in [X] must not override concurrency field`.
- Total concurrency count exceeds the configured limit: `concurrency_num (N) exceeds limit (M)`.
- `limits` rule missing `field`: `limits.field is required`.
- `limits.field` not in `concurrency.fields`: `limits.field X is not in concurrency.fields`.
- `limits.max` missing/zero/negative: `limits.max must be greater than 0`.
- `limits.regex` not a valid regex: `limits.regex invalid`.
