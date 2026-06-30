# Concurrency Rules

Last Updated: 2026-06-30

Source: `C:/Users/user/Desktop/concurrency_rules.html`

## Decision Order

1. If `input_schema.json` has non-empty `concurrency.fields`, use the new concurrency rules.
2. If `concurrency.fields` is absent or empty and legacy `b` is non-empty, split by `b`.
3. If both are absent, the runtime treats the submitted custom object as a single task.
4. If both `concurrency.fields` and `b` exist, `concurrency.fields` wins and `b` is ignored.

## Root Fields

- `concurrency` is optional and must be an object when present.
- `concurrency.fields` is an optional string array of candidate split field names.
- `concurrency.remove_fields` is an optional string array. Every entry must also appear in `fields`.
- `b` is optional legacy compatibility. It is used only when `concurrency.fields` is absent or empty.
- `properties` is still the required schema field list.

## Schema Validation Expectations

- Each non-empty `concurrency.fields` item must match a `properties[*].name`.
- Each `concurrency.fields` property must have `type: "array"`.
- Each non-empty `concurrency.remove_fields` item must be a member of `concurrency.fields`.
- Legacy `b`, when it is the active split mechanism, must match a `properties[*].name` whose type is `array`.
- Unknown root-key warnings must treat `concurrency` as documented, not unknown.
- `stringList` defaults may use primitive strings or `{ "string": "value" }` objects; examples in the current rules use primitive strings.

## Active Field Selection

```text
preferred = fields - remove_fields
if preferred is non-empty and any preferred field has meaningful custom values:
    activeFields = preferred
else:
    activeFields = fields
```

When preferred fields are active, every `remove_fields` key is deleted from generated task custom objects. It is not retained as `[""]`.

When the fallback all-fields path is active, `remove_fields` is not applied; those fields may participate in splitting.

## Meaningful Items

The runtime filters empty concurrency items before deciding whether a field has values:

- `null`
- blank strings, including whitespace-only strings
- empty objects
- objects whose values are all empty by these same rules

After filtering, an empty array means that field has no values.

## Split Result Shape

- For each selected primitive item (`string`, `number`, `boolean`), the generated task keeps the original split field name with a one-item array, for example `"keywords": ["pizza"]`.
- For each selected object item, the generated task merges object keys into the parent task custom object and removes the split field key itself.
- Other concurrency fields that are not selected for the current task are retained as `[""]`, unless they are disabled by active `remove_fields`.
- Multiple active fields produce the union of per-field split tasks, not a Cartesian product.
- With only one `concurrency.fields` entry, behavior is equivalent to legacy single-field splitting except the original field key is kept as a one-item array for primitive items.

## Element Type Matrix

- Object items are supported and merged into the task custom object.
- String, number, and boolean items are supported and wrapped as one-item arrays under the split field name.
- `null` is treated as empty.
- Nested arrays are invalid with `item at index N in [X] must be an object or primitive value`.
- A single split field must not mix object and primitive items; use `field [X] must not mix object and primitive items`.
- Empty arrays in legacy `b` mode are errors: `concurrency field [X] is empty`.
- Empty arrays in new `concurrency.fields` mode mean that field is skipped; if every field is empty, error with `concurrency fields have no non-empty fields`.

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
- Total concurrency count exceeds the configured limit: `concurrency_num (N) exceeds limit (M)`.
