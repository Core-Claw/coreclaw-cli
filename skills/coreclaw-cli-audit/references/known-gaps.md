# Known Gaps and Historical Fixes

Last Updated: 2026-06-17

## Resolved Issues

### 2026-06-17: Editor-type mismatches only warned, not errored

**Issue**: Platform rejects workers with code 4000 "Invalid custom parameters" when editor type doesn't match property type (e.g., textarea+array, input+integer), but CLI only produced `warn` severity.

**Documentation**: input-schema.md — editor type guide tables show which types each editor supports.

**Fix**: 
- Upgraded `input_editor_type_mismatch` from `warn` to `error`
- Added STRING_ONLY_EDITORS check for input/textarea/datepicker
- Added ARRAY_ONLY_EDITORS check ensuring array type uses compatible editors
- Error message now includes "code 4000" and remediation suggestion

**Tests**: 5 new test cases (textarea+array, input+integer, array+input, stringList ok, stable codes)

**Commit**: b87e766

**Status**: ✅ Resolved

### 2026-06-17: requestList/stringList default shape only warned

**Issue**: Invalid default items for requestList (missing url) and stringList (missing string) were only warnings, but platform rejects these.

**Fix**: Upgraded `input_default_list_item_invalid` from `warn` to `error` for requestList and stringList.

**Tests**: 2 new test cases

**Commit**: b87e766

**Status**: ✅ Resolved

### 2026-06-17: output_schema missing column type not detected

**Issue**: When `output_schema.json` column definition omits the required `type` field, the error message said "is not supported" rather than "is required".

**Fix**: Added explicit `column.type === undefined || null` check before the supported-type check.

**Tests**: 3 new test cases (missing type, unsupported type, all valid types)

**Commit**: b87e766

**Status**: ✅ Resolved

---

## Pending Issues

### Low Priority: requestListSource default validation severity

**Current**: `warn` for invalid requestListSource defaults
**Consideration**: requestListSource defaults have complex param_list structure; keeping as `warn` for now since platform may be more lenient with these.

### Low Priority: output_schema.json missing from project

**Current**: `warn` when output_schema.json is absent
**Consideration**: Docs list it as required but code intentionally allows legacy workers without it. Keeping as `warn` for backward compatibility.

---

## Pattern Notes

### Common Gap Types

1. **Missing Validation**: Rule exists in docs but not implemented
2. **Wrong Severity**: Rule implemented as warn() but should be error()
3. **Missing Test**: Rule implemented but no test coverage
4. **Incomplete Error Message**: Rule implemented but error message not helpful
5. **Edge Case Missing**: Rule implemented but doesn't handle all cases

### Severity Guidelines

- **error**: Platform will reject the worker (schema validation failure, missing required fields, code 4000)
- **warn**: Best practice violation but worker might still work (deprecated fields, optional improvements)
- **info**: Informational only (case mismatches, optional recommendations)

### Testing Strategy

When fixing a gap:
1. Add validation logic in schema.js or project.js
2. Add test case with both valid and invalid inputs
3. Run `npm test` to verify no regressions
4. Test with real workers in E:\worker if applicable
5. Update contract-checklist.md to mark rule as [x]
6. Update this file with resolution notes
7. Commit and push
