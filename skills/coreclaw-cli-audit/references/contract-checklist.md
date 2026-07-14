# Contract Checklist

Last Updated: 2026-07-11

## Priority 1: input-schema.md

Source: `D:/Coreclaw_Work/github/scraper-webui-docs/src/content/docs/developer-guide/worker-definition/input-schema.md`

### Root Fields

- [x] R001: `concurrency.fields` is the preferred task splitting config; `b` is optional legacy compatibility — validated without missing-`b` error
- [x] R002: Active legacy `b` must match a property name — validated with error when no `concurrency.fields`
- [x] R003: Active legacy `b` property type should be `array` — validated with **warn** (platform-verified 2026-07-14: platform accepts non-array `b`/concurrency field; runs as single task. Missing property stays error.)
- [x] R004: `properties` must be array — validated with error
- [x] R005: Unknown root keys produce warning; `concurrency` is documented and not warned — validated with warn
- [x] R006: `description` is optional — correctly not enforced
- [x] R007: `concurrency` must be an object when present — validated with error
- [x] R008: `concurrency.fields` and `concurrency.remove_fields` must be arrays when present — validated with error
- [x] R009: `concurrency.remove_fields` entries must be a subset of `fields` — validated with error
- [x] R009a: `concurrency.fields` entry pointing to a non-array property — **warn** (platform-verified 2026-07-14: `input_schema_concurrency_field_not_array` downgraded error→warn; non-array field cannot split, runs as single task)

### Property Fields

- [x] R010: Each property must be an object — validated with error
- [x] R011: `name` required and must be string — validated with error
- [x] R012: `name` must be unique — validated with error on duplicates
- [x] R013: `name` must use ASCII letters/numbers/underscore/dash/dot — validated with error
- [x] R014: `type` must be one of supported types (string/integer/number/boolean/array/object) — validated with error
- [x] R014a: `title` documented required (string) — validated with **warn** (platform verification 2026-07-13: accepted; `examples/verify-required-fields` v2 — even missing type/naked-only-name accepted)
- [x] R014b: `editor` documented required (string) — validated with **warn** (platform verification 2026-07-13: accepted)
- [x] R014c: `description` documented required (string) — validated with **warn** (platform verification 2026-07-13: accepted)
- [x] R014d: `required` documented required (boolean) — validated with **warn** (platform verification 2026-07-13: accepted)
- [x] R015: `editor` must be documented — validated with warn for unknown editors
- [x] R016: `editor` should match expected type — validated with **warn** (platform verification 2026-07-13: `examples/verify-code4000` v2 — all 11 mismatched combos accepted and ran; form controls may render incorrectly, e.g. checkbox options unselectable)

### Editor-Type Compatibility (platform accepts mismatches — form may misbehave)

- [x] R020: `number` editor expects integer/number type — warn
- [x] R021: `switch` editor expects boolean type — warn
- [x] R022: `checkbox` editor expects array type — warn
- [x] R023: `requestList` editor expects array type — warn
- [x] R024: `requestListSource` editor expects array type — warn
- [x] R025: `stringList` editor expects array type — warn
- [x] R026: `input` editor expects string type — warn (string-only check)
- [x] R027: `textarea` editor expects string type — warn (string-only check)
- [x] R028: `datepicker` editor expects string type — warn (string-only check)
- [x] R029: Array type expects array-compatible editor — warn

### Selector Options

- [x] R030: `select`/`radio`/`checkbox` editors should have non-empty options array — warn
- [x] R031: Options must be objects with `label` and `value` — warn

### Default Values

- [x] R040: requestList defaults must be {url: string} objects — **error** (upgraded from warn)
- [x] R041: stringList defaults must be {string: string} objects — **error** (upgraded from warn)
- [x] R042: requestListSource defaults validated against param_list — warn
- [x] R043: Defaults must match declared type — validated
- [x] R044: Defaults must respect numeric bounds — validated

### Numeric Bounds

- [x] R050: minimum/maximum must be finite numbers — warn
- [x] R051: minimum must be <= maximum — warn
- [x] R052: Default values must be within bounds — warn

### Naming Conventions

- [x] R060: `max_results` naming convention — warn (docs say use `max_results`)

## Priority 2: output-schema.md

Source: `D:/Coreclaw_Work/github/scraper-webui-docs/src/content/docs/developer-guide/worker-definition/output-schema.md`

- [x] R070: Must be JSON array — validated with error
- [x] R071: Each column must be object — validated with error
- [x] R072: `name` required and must be string — validated with error
- [x] R073: `name` must be unique — validated with error on duplicates
- [x] R074: `type` required — **validated with error** (added in this audit round)
- [x] R075: `type` must be supported value — validated with error
- [x] R076: `description` optional — correctly not enforced

## Priority 3: project-structure.md

Source: `D:/Coreclaw_Work/github/scraper-webui-docs/src/content/docs/developer-guide/worker-definition/project-structure.md`

### Required Files

- [x] R080: Python requires main.py, requirements.txt, input_schema.json, sdk.py, sdk_pb2.py, sdk_pb2_grpc.py — validated
- [x] R081: Node.js requires main.js, package.json, input_schema.json, sdk.js, sdk_pb.js, sdk_grpc_pb.js — validated
- [x] R082: Go requires main.go, go.mod, go.sum, input_schema.json, GoSdk/*.go — validated
- [x] R083: README.md recommended — warn if missing
- [x] R084: output_schema.json required — **error** if missing (upgraded from warn; builds-and-runs.md L35 lists it in platform ZIP validation, project-structure.md lists it in every language required-files tree)

### Entry File

- [x] R085: Entry file must be main.{py,js,go} — validated via language detection

## Priority 4: sdk-modules.md

Source: `D:/Coreclaw_Work/github/scraper-webui-docs/src/content/docs/developer-guide/worker-definition/sdk-modules.md`

- [x] R090: Node.js runtime deps: @grpc/grpc-js, google-protobuf — validated
- [x] R091: Python runtime deps: grpcio, protobuf — validated
- [x] R092: Go runtime deps: grpc, protobuf — validated

## Priority 6: platform-features/

### proxy-support.md

- [x] R100: Workers using HTTP clients should read PROXY_DOMAIN — warn
- [x] R101: Workers using HTTP clients should read PROXY_AUTH — warn

### browser-fingerprinting.md

- [x] R110: Workers using browser automation should use ChromeWs endpoint — warn
- [x] R111: Workers should not hardcode proxy credentials — validated

### captcha-handling.md

- [x] R120: CDP-based CAPTCHA handling via Captchas.automaticSolver — documentation reference

## Priority 7: Cross-module dependency detection

### proxy-support.md (implicit dependencies)

- [x] R130: Python workers using requests + socks5:// must declare PySocks — **error**
- [x] R131: Node.js workers using socks-proxy-agent must declare it in package.json — **error**

### browser-automation/ (framework dependencies)

- [x] R140: Python workers using Playwright/Selenium/DrissionPage must declare framework in requirements.txt — **error**
- [x] R141: Node.js workers using Playwright/Puppeteer/Selenium must declare framework in package.json — **error**

### builds-and-runs.md (network sandbox)

- [x] R150: HTTP workers not reading PROXY_AUTH/PROXY_DOMAIN — **error** (upgraded from warn; cloud network is sandboxed)

### sdk-modules.md (version pinning)

- [x] R160: Python workers should pin protobuf version in requirements.txt — **warn**

### browser-fingerprinting.md (best practices)

- [x] R170: Hardcoded User-Agent strings detected — **warn**

### output-schema.md (static header analysis)

- [x] R180: set_table_header key not in output_schema.json — **warn** (static)
- [x] R181: output_schema.json column not in set_table_header — **warn** (static)

## Priority 9: 2026-07-11 docs sweep (browser endpoints, SDK, proxy, camoufox)

Sources: builds-and-runs.md, browser-automation/{camoufox,overview}.md, sdk-modules.md, output-schema.md, proxy-support.md

- [x] R210: Browser endpoint scan recognizes `CamoufoxDomain` — **warn** when browser worker reads no documented endpoint (builds-and-runs.md L72-74)
- [x] R211: Camoufox workers (read CamoufoxDomain, python) must pin `playwright==1.49.1` — **error** (camoufox.md L18)
- [x] R212: `upsert_data`/`upsertData`/`UpsertData` unique key must exist in output_schema.json — **error** (output-schema.md L101-129)
- [x] R213: `set_table_header` must precede first `push_data` — **warn** (sdk-modules.md L241)
- [x] R214: Node axios + SOCKS agent must set `proxy: false` — **warn** (proxy-support.md L192)
- [x] R215: Hardcoded proxy credentials in a SOCKS URL — **error** (proxy-support.md L190, camoufox.md L32)
- [x] R216: `missing_output_schema` upgraded to **error** (was warn; builds-and-runs.md L35 + project-structure.md required-files trees)

## Priority 10: API v2 contract (cloud client vs exported-api-docs/openapi.json)

Source: `D:/Coreclaw_Work/github/exported-api-docs/openapi.json` (37 operations, all `/api/v2/*`). The CLI cloud client (`src/cloud/client.js`) covers all 37 operationIds. Auth is HTTP Bearer (`Authorization: Bearer <token>`) with `?token=` query fallback; public endpoints (store, proxy/region, input-schema, internal) send no auth.

- [x] R300: `getAccount` → GET /api/v2/users/account
- [x] R301: `listStore` → GET /api/v2/store (public)
- [x] R302: `listProxyRegions` → GET /api/v2/proxy/region (public)
- [x] R303: `listWorkers` → GET /api/v2/workers
- [x] R304: `getWorker` → GET /api/v2/workers/{workerId}
- [x] R305: `getWorkerInputSchema` → GET /api/v2/workers/{workerId}/input-schema (public)
- [x] R306: `getWorkerInternal` → GET /api/v2/workers/{workerId}/internal (public)
- [x] R307: `runWorker` → POST /api/v2/workers/{workerId}/runs (input at top level, not wrapped in parameters.custom)
- [x] R308: `createWorkerVersion` → POST /api/v2/workers/{workerId}/versions (multipart/form-data: scraper_file + title + description + categories)
- [x] R309: `updateWorkerVersion` → PUT /api/v2/workers/{workerId}/versions/{version} (multipart)
- [x] R310: `listWorkerRuns` → GET /api/v2/worker-runs (offset/limit pagination, lowercase status enum)
- [x] R311: `getWorkerRun` → GET /api/v2/worker-runs/{runId}
- [x] R312: `getWorkerRunLog` → GET /api/v2/worker-runs/{runId}/log
- [x] R313: `listWorkerRunResults` → GET /api/v2/worker-runs/{runId}/result (offset/limit)
- [x] R314: `exportWorkerRunResults` → GET /api/v2/worker-runs/{runId}/result/export (format enum + filter_keys)
- [x] R315: `abortWorkerRun` → POST /api/v2/worker-runs/{runId}/abort (no body)
- [x] R316: `rerunWorkerRun` → POST /api/v2/worker-runs/{runId}/rerun (callback_url, is_async, limit, offset)
- [x] R317: `getLastWorkerRun` → GET /api/v2/worker-runs/last
- [x] R318: `getLastWorkerRunLog` → GET /api/v2/worker-runs/last/log
- [x] R319: `listLastWorkerRunResults` → GET /api/v2/worker-runs/last/result
- [x] R320: `exportLastWorkerRunResults` → GET /api/v2/worker-runs/last/export
- [x] R321: `abortLastWorkerRun` → POST /api/v2/worker-runs/last/abort
- [x] R322: `rerunLastWorkerRun` → POST /api/v2/worker-runs/last/rerun
- [x] R323: `getWorkerLastRun` → GET /api/v2/workers/{workerId}/runs/last
- [x] R324: `getWorkerLastRunLog` → GET /api/v2/workers/{workerId}/runs/last/log
- [x] R325: `listWorkerLastRunResults` → GET /api/v2/workers/{workerId}/runs/last/result
- [x] R326: `exportWorkerLastRunResults` → GET /api/v2/workers/{workerId}/runs/last/export
- [x] R327: `abortWorkerLastRun` → POST /api/v2/workers/{workerId}/runs/last/abort
- [x] R328: `rerunWorkerLastRun` → POST /api/v2/workers/{workerId}/runs/last/rerun
- [x] R329: `listWorkerTasks` → GET /api/v2/worker-tasks
- [x] R330: `createWorkerTask` → POST /api/v2/worker-tasks (worker_id, title, input required; schedule fields)
- [x] R331: `getWorkerTask` → GET /api/v2/worker-tasks/{workerTaskId}
- [x] R332: `updateWorkerTask` → PUT /api/v2/worker-tasks/{workerTaskId} (no input/version — use R335)
- [x] R333: `deleteWorkerTask` → DELETE /api/v2/worker-tasks/{workerTaskId}
- [x] R334: `getWorkerTaskInput` → GET /api/v2/worker-tasks/{workerTaskId}/input
- [x] R335: `updateWorkerTaskInput` → PUT /api/v2/worker-tasks/{workerTaskId}/input (input required, optional version)
- [x] R336: `runWorkerTask` → POST /api/v2/worker-tasks/{workerTaskId}/runs (no input — reuses task's stored input)
- [x] R337: Response envelope `{code, message, data, request_id}`; code===0 = success; error envelope has `details[]`; business codes start at 10000 (no 4000)

## Priority 8: concurrency-rules.html

Source: `C:/Users/user/Desktop/urls/最新脚本并发拆分规则说明.html` (2026-07 version, includes limits)

- [x] R190: New runtime split uses `concurrency.fields` before legacy `b` — validated in `expandSplitInput`
- [x] R191: Legacy `b` is trimmed and remains compatible when `concurrency.fields` is absent — tested
- [x] R192: `remove_fields` disables and deletes fields only when preferred fields have values — tested
- [x] R193: If preferred fields are empty after filtering, runtime falls back to all `fields` — tested
- [x] R194: Blank strings, `null`, empty objects, and all-empty objects are filtered before split decisions — tested
- [x] R195: Multiple populated fields produce a union of per-field tasks — tested
- [x] R196: Primitive split items are wrapped under the original field as `[item]` — tested for legacy and new modes
- [x] R197: Object split items merge into task custom and remove the split field key — legacy behavior preserved
- [x] R198: Nested array split items error — tested
- [x] R199: Mixed object and primitive split items error — tested
- [x] R200: New `concurrency.fields` mode errors when all fields have no non-empty items — tested
- [x] R201: Apify migration schema drafts include `concurrency.fields` while retaining legacy `b` — tested
- [x] R202: `stringList` defaults accept primitive strings used in concurrency examples — tested

## Audit History

### 2026-06-30: Concurrency rules audit

**Changes committed**: current change set

1. Added support for `concurrency.fields` and `concurrency.remove_fields` as the preferred split contract.
2. Kept legacy `b` compatibility and removed the old missing-`b` error for new schemas.
3. Updated local `--split` expansion to match new runtime semantics: preferred fields, `remove_fields` deletion, empty item filtering, primitive wrapping, union splitting, nested-array and mixed-type errors.
4. Updated Apify migration drafts to emit both `concurrency.fields` and `b`.
5. Added `references/concurrency-rules.md` with the HTML rule set.

**Results**: `npm test` passed on 2026-06-30 with 347 passing tests, 1 skipped test, and 0 failures.

### 2026-06-17: Sixth audit round

**Changes committed**: 2765cea

1. Fixed `alreadyReported` guard in editor-type mismatch checks to scope per-property instead of globally
2. Previously: if property[1] had textarea+array, property[2] input+integer would be silently suppressed
3. Now: each property gets independent editor-type mismatch detection
4. Added test verifying 3 properties with different mismatches all produce individual errors

**Results**: 326 tests pass, 0 fail
**Key finding**: Cross-property error suppression bug ? the alreadyReported guard was checking all issues globally instead of per-property

### 2026-06-17: Fifth audit round

**Changes committed**: e490f81

1. Upgraded `node_package_main_not_main_js` from `warn` to `error` ? platform requires main.js as entry
2. Upgraded `node_package_type_not_commonjs` from `warn` to `error` ? SDK uses CommonJS require()
3. Added `input_property_required_invalid` error for non-boolean required values (e.g., required: "yes")
4. Updated project.test.js to expect error severity for package field issues
5. Added 2 new schema tests for required field type validation

**Results**: 325 tests pass, 0 fail
**Key findings**: 
- package.json main/type are now correctly treated as hard requirements
- required: "yes" (string) silently makes a required field optional ? now caught as error

### 2026-06-17: Fourth audit round

**Changes committed**: a4843fb

1. Added `input_select_multiple_type_mismatch` error: select+multiple requires type "array"
2. Exempted select+multiple from ARRAY_ONLY_EDITORS check (select with multiple:true is a valid multi-select)
3. Fixed existing test to use correct type: 'array' for select+multiple property
4. Added 3 new tests: select multiple type mismatch, select multiple with array type, select without multiple

**Results**: 323 tests pass, 0 fail
**Key finding**: select editor with multiple:true and type "string" is invalid ? platform expects array type for multi-select

### 2026-06-17: Third audit round

**Changes committed**: a1def21

1. Upgraded `requestListSource` non-object default items from `warn` to `error`
2. Upgraded `requestListSource` missing required param in default from `warn` to `error`
3. Added 3 new tests for requestListSource default validation
4. Removed duplicate output_schema test blocks from test file
5. Verified CLI catches real worker issues (worker-puppeteer-scraper array+select mismatch)

**Results**: 320 tests pass, 0 fail
**Coverage**: ~99% of documented rules implemented with correct severity
**Remaining warn calls**: All intentionally kept ? unknown root keys, legacy type aliases, optional recommendations, param_list lenient validation, numeric bounds, selector options

### 2026-06-17: Second audit round

**Changes committed**: 848dba7

1. Upgraded `input_default_type_mismatch` from `warn` to `error` (platform rejects type-mismatched defaults with code 4000)
2. Upgraded `input_default_param_type_mismatch` from `warn` to `error` (same reason)
3. Added explicit `column.type` required check for output_schema (output_column_missing_type)
4. Added 7 new test cases: default type mismatch, param type mismatch, Chinese name rejection, output_schema type coverage

**Results**: 320 tests pass, 0 fail
**Coverage**: ~98% of documented rules implemented
**Remaining gaps**: Minor ? requestListSource default shape validation stays at warn, missing output_schema stays at warn (legacy compat)

### 2026-06-17: First full audit

**Changes committed**: b87e766

1. Upgraded editor-type mismatch validation from `warn` to `error` (platform rejects with code 4000)
2. Added STRING_ONLY_EDITORS check (input/textarea/datepicker require string type)
3. Added ARRAY_ONLY_EDITORS check (array type must use array-compatible editor)
4. Upgraded requestList/stringList default shape validation from `warn` to `error`
5. Added explicit `column.type` required check for output_schema
6. Added unknown root key detection for input_schema.json
7. Added 10+ new test cases covering all new rules

**Results**: 313 tests pass, 0 fail
**Coverage**: ~95% of documented rules implemented
