# CoreClaw CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local CoreClaw CLI that emulates the documented cloud worker runtime closely enough that a worker that passes locally is upload-ready.

**Architecture:** The CLI is a Node.js executable. `coreclaw run` starts a local gRPC server on `127.0.0.1:20086`, injects CoreClaw runtime environment variables, installs dependencies when requested, executes Python/Node/Go workers, and persists captured input, logs, table headers, output rows, and status under `.coreclaw/runs/<run-id>/`.

**Tech Stack:** Node.js ESM, `@grpc/grpc-js`, official CoreClaw generated protobuf JS files, built-in argument parsing, PowerShell `Compress-Archive` on Windows, built-in `node:test`.

---

### Task 1: CLI Skeleton

**Files:**
- Create: `package.json`
- Create: `bin/coreclaw.js`
- Create: `src/cli.js`
- Create: `src/utils/errors.js`

**Steps:**
1. Define package metadata and executable bin.
2. Wire commands: `init`, `validate`, `run`, `pack`, `doctor`.
3. Add a typed `CliError` for clean user-facing failures.
4. Verify `node bin/coreclaw.js --help`.

### Task 2: Runtime Contract Extraction

**Files:**
- Create: `proto/sdk.proto`
- Create: `src/runtime/grpc-server.js`
- Create: `src/runtime/run-store.js`

**Steps:**
1. Encode the documented CoreClaw SDK gRPC protocol: `Parameter/GetInputJSONString`, `Result/SetTableHeader`, `Result/PushData`, `Log/Debug|Info|Warn|Error`.
2. Persist every SDK call to `.coreclaw/runs/<run-id>/`.
3. Return success responses matching platform SDK expectations.
4. Add unit tests with a temporary client if time allows.

### Task 3: Worker Validation

**Files:**
- Create: `src/validation/project.js`
- Create: `src/validation/schema.js`
- Create: `src/commands/validate.js`

**Steps:**
1. Detect language by root entry file: `main.py`, `main.js`, `main.go`.
2. Enforce documented required files for Python, Node.js, and Go workers.
3. Validate `input_schema.json`: root `properties` array, required `b`, unique names, `b` points to an array property, supported types/editors.
4. Validate `output_schema.json`: array, unique `name`, supported types.
5. Cross-check output schema against runtime table headers after a local run.

### Task 4: Local Run

**Files:**
- Create: `src/commands/run.js`
- Create: `src/runtime/input.js`
- Create: `src/runtime/executor.js`
- Create: `src/runtime/env.js`

**Steps:**
1. Build input from `--input` JSON file, `--json` inline JSON, or schema defaults.
2. Optionally expand the `b` split key with `--split`, mirroring the single-item task shape used by existing workers.
3. Inject `PROXY_AUTH`, `PROXY_DOMAIN`, and `ChromeWs`, with clear local fallback values and warnings.
4. Execute the worker in the project root and stream stdout/stderr.
5. Write `summary.json`, `logs.ndjson`, `results.ndjson`, `table_headers.json`, `input.json`, and `env.json`.

### Task 5: Init and Pack

**Files:**
- Create: `src/commands/init.js`
- Create: `src/commands/pack.js`
- Create: template worker files under `templates/`

**Steps:**
1. Generate upload-ready Python/Node/Go worker projects with SDK files included.
2. Package upload ZIPs with entry file at archive root.
3. Exclude `.coreclaw`, `node_modules`, virtualenvs, build outputs, caches, and git metadata.
4. Run validation before packaging unless `--no-validate`.

### Task 6: Documentation and Verification

**Files:**
- Create: `README.md`
- Create: `examples/node-hello/*`
- Create: `examples/python-hello/*`
- Create: tests under `test/`

**Steps:**
1. Document official-doc-derived runtime behavior and known limits.
2. Verify Node and Python examples with `coreclaw run`.
3. Verify `coreclaw pack` produces a ZIP accepted by local structural checks.
4. Run `npm test`.
