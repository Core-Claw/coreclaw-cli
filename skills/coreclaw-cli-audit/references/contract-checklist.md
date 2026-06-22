# Contract Checklist

Last Updated: 2026-06-17

## Priority 1: input-schema.md

Source: `E:\docs\docs-coreclaw\scraper-webui-docs\src\content\docs\developer-guide\worker-definition\input-schema.md`

### Root Fields

- [x] R001: `b` field required as task splitting key — validated with error if missing
- [x] R002: `b` must match a property name — validated with error
- [x] R003: `b` property type must be `array` — validated with error
- [x] R004: `properties` must be array — validated with error
- [x] R005: Unknown root keys produce warning — validated with warn
- [x] R006: `description` is optional — correctly not enforced

### Property Fields

- [x] R010: Each property must be an object — validated with error
- [x] R011: `name` required and must be string — validated with error
- [x] R012: `name` must be unique — validated with error on duplicates
- [x] R013: `name` must use ASCII letters/numbers/underscore/dash/dot — validated with error
- [x] R014: `type` must be one of supported types (string/integer/number/boolean/array/object) — validated with error
- [x] R015: `editor` must be documented — validated with warn for unknown editors
- [x] R016: `editor` must match expected type — validated with **error** (platform rejects with code 4000)

### Editor-Type Compatibility (Critical — platform rejects mismatches)

- [x] R020: `number` editor requires integer/number type — error
- [x] R021: `switch` editor requires boolean type — error
- [x] R022: `checkbox` editor requires array type — error
- [x] R023: `requestList` editor requires array type — error
- [x] R024: `requestListSource` editor requires array type — error
- [x] R025: `stringList` editor requires array type — error
- [x] R026: `input` editor requires string type — error (string-only check)
- [x] R027: `textarea` editor requires string type — error (string-only check)
- [x] R028: `datepicker` editor requires string type — error (string-only check)
- [x] R029: Array type requires array-compatible editor — error

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

Source: `E:\docs\docs-coreclaw\scraper-webui-docs\src\content\docs\developer-guide\worker-definition\output-schema.md`

- [x] R070: Must be JSON array — validated with error
- [x] R071: Each column must be object — validated with error
- [x] R072: `name` required and must be string — validated with error
- [x] R073: `name` must be unique — validated with error on duplicates
- [x] R074: `type` required — **validated with error** (added in this audit round)
- [x] R075: `type` must be supported value — validated with error
- [x] R076: `description` optional — correctly not enforced

## Priority 3: project-structure.md

Source: `E:\docs\docs-coreclaw\scraper-webui-docs\src\content\docs\developer-guide\worker-definition\project-structure.md`

### Required Files

- [x] R080: Python requires main.py, requirements.txt, input_schema.json, sdk.py, sdk_pb2.py, sdk_pb2_grpc.py — validated
- [x] R081: Node.js requires main.js, package.json, input_schema.json, sdk.js, sdk_pb.js, sdk_grpc_pb.js — validated
- [x] R082: Go requires main.go, go.mod, go.sum, input_schema.json, GoSdk/*.go — validated
- [x] R083: README.md recommended — warn if missing
- [x] R084: output_schema.json recommended — warn if missing (legacy compat)

### Entry File

- [x] R085: Entry file must be main.{py,js,go} — validated via language detection

## Priority 4: sdk-modules.md

Source: `E:\docs\docs-coreclaw\scraper-webui-docs\src\content\docs\developer-guide\worker-definition\sdk-modules.md`

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

## Audit History

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
