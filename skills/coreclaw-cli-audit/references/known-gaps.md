# Known Gaps and Historical Fixes

Last Updated: 2026-06-30

## Resolved Issues

### 2026-06-30: New concurrency fields contract not supported

**Issue**: CLI validation treated legacy `b` as required and local `--split` only supported single-field `b` splitting. The platform now prefers `concurrency.fields` with optional `remove_fields`, while keeping `b` only as legacy fallback.

**Documentation**: `C:/Users/user/Desktop/concurrency_rules.html`

**Fix**:
- Added schema validation for `concurrency`, `fields`, and `remove_fields`
- Removed the missing-`b` error when `concurrency.fields` is used or no split key is configured
- Updated local split expansion for preferred fields, `remove_fields` deletion, empty item filtering, primitive wrapping, object merging, and union splitting
- Kept legacy `b` fallback with trim support and empty-array errors
- Updated Apify migration schema drafts to emit both `concurrency.fields` and legacy `b`
- Added `references/concurrency-rules.md` and R190-R202 in the contract checklist

**Tests**: Added focused schema/runtime split tests and migration draft assertions.

**Status**: ✅ Resolved

### 2026-06-22: SOCKS proxy implicit dependency not detected

**Issue**: Python workers using `requests` with `socks5://` proxy URLs fail in cloud with "Missing dependencies for SOCKS support" because `PySocks` is not declared. CLI had no detection for this cross-module implicit dependency.

**Documentation**: proxy-support.md — all examples use socks5:// protocol.

**Fix**:
- Added `validateSocksProxyDependencies()` for Python: detects requests + socks5:// without PySocks → error
- Added `validateNodeSocksProxyDependencies()` for Node.js: detects socks-proxy-agent usage → error
- Added R130, R131 to contract checklist

**Tests**: 3 new test cases (Python socks missing, Python socks declared, Node socks-agent missing)

**Status**: ✅ Resolved

### 2026-06-22: HTTP workers without proxy only warned

**Issue**: Official docs (builds-and-runs.md) state "Network is sandboxed — HTTP request scripts must use the built-in SOCKS5 proxy". Without proxy, all outbound requests fail in cloud. CLI only warned.

**Fix**: Upgraded `http_proxy_env_not_used` from `warn` to `error`. Updated message to emphasize cloud failure.

**Tests**: Updated existing proxy test assertions

**Status**: ✅ Resolved

### 2026-06-22: Browser framework dependencies not checked

**Issue**: Workers using Playwright/Selenium/Puppeteer/DrissionPage without declaring the framework package would fail at import time in cloud. CLI only checked browser endpoint env vars.

**Fix**: Added `validateBrowserFrameworkDependencies()` with Python and Node.js framework pattern matching. Supports -core variants. Added R140, R141 to contract checklist.

**Status**: ✅ Resolved

### 2026-06-22: Protobuf version not pinned warning missing

**Issue**: Python-example.md states "protobuf version must match the one used to generate sdk_pb2.py". Unpinned versions can cause deserialization errors.

**Fix**: Added `validateProtobufVersionMatch()` — warns when protobuf is not pinned with ==. Added R160.

**Tests**: 2 new test cases

**Status**: ✅ Resolved

### 2026-06-22: Hardcoded User-Agent not detected

**Issue**: browser-fingerprinting.md says platform manages fingerprints. Hardcoded User-Agent may trigger anti-bot detection.

**Fix**: Added `validateHardcodedUserAgent()` — warns on User-Agent strings. Added R170.

**Tests**: 1 new test case

**Status**: ✅ Resolved

### 2026-06-22: Static push_data key analysis missing

**Issue**: output-schema.md requires push_data keys to match output_schema.json. CLI only checked at runtime.

**Fix**: Added `validateStaticPushDataKeys()` — bidirectional comparison of set_table_header keys with output_schema.json names. Added R180, R181.

**Status**: ✅ Resolved


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
