# CoreClaw CLI Command Reference

Generated from CLI command metadata for CoreClaw CLI 0.1.0.

Use this page when you need exact command syntax. For workflow guidance, start with the main README.

## Commands

### Worker development

- `init` - Create an upload-ready Worker with SDK files and schemas
- `validate` - Check Worker root files, dependencies, SDK files, and schemas
- `run` - Run a Worker locally with the CoreClaw SDK runtime emulator

### Upload preflight

- `verify` - Run upload preflight from a clean upload-like staging directory
- `pack` - Create a CoreClaw upload ZIP with the entry file at archive root

### Inspection and parity

- `inspect-run` - Validate a local .coreclaw/runs/<run-id> artifact directory
- `inspect-package` - Validate upload ZIP layout and show the largest packaged entries
- `compare` - Compare CoreClaw cloud JSON/CSV output with local run output

### Workspace and tools

- `audit` - Validate many worker-* projects and write JSON/Markdown reports
- `doctor` - Check local tools and browser endpoint discovery
- `help` - Show general help or command-specific help

## Worker development

### `init`

Create an upload-ready Worker with SDK files and schemas

Usage:

```bash
coreclaw init [target] --language <python|node|go> [--name worker-name] [--force] [--no-input-example]
```

Examples:

```bash
coreclaw init ./my-worker --language node --name my-worker
coreclaw init ./my-go-worker --language go
coreclaw init ./my-worker --language python --no-input-example
```

### `validate`

Check Worker root files, dependencies, SDK files, and schemas

Usage:

```bash
coreclaw validate [project] [--strict] [--json-output]
```

Examples:

```bash
coreclaw validate ./worker
coreclaw validate ./worker --strict
coreclaw validate ./worker --json-output
```

### `run`

Run a Worker locally with the CoreClaw SDK runtime emulator

Usage:

```bash
coreclaw run [project] [--input input.json | --json '{"url":"..."}' | --input-json '{"url":"..."}'] [--split 0] [--min-results 1]
coreclaw run [project] [--strict] [--require-table-header] [--require-output-schema-match] [--require-status-ok]
coreclaw run [project] [--local-proxy --require-proxy-usage] [--require-browser]
coreclaw run [project] [--browser-cdp-shim | --lightpanda-shim | --captcha-solver] [--json-output]
```

Examples:

```bash
coreclaw run ./worker --input input.json --min-results 1
coreclaw run ./worker --strict --require-output-schema-match
coreclaw run ./worker --local-proxy --require-proxy-usage --min-results 1
coreclaw run ./worker --input input.json --json-output
```

## Upload preflight

### `verify`

Run upload preflight from a clean upload-like staging directory

Usage:

```bash
coreclaw verify [project] [--input input.json] [--strict] [--min-results 1] [--no-pack]
coreclaw verify [project] [--no-staging] [--no-install] [--go go]
coreclaw verify [project] [--max-package-size 50MB]
coreclaw verify [project] --cloud-output cloud.json|cloud.csv [--compare-profile profile.json] [--compare-output report.json]
coreclaw verify [project] [--local-proxy --require-proxy-usage] [--browser-cdp-shim --require-browser-cdp-shim] [--json-output]
```

Examples:

```bash
coreclaw verify ./worker --strict --input input.json --min-results 1
coreclaw verify ./worker --cloud-output ./cloud.csv --min-shared 1 --max-diff 0
coreclaw verify ./go-worker --go go --strict --min-results 1
coreclaw verify ./worker --input input.json --json-output
```

### `pack`

Create a CoreClaw upload ZIP with the entry file at archive root

Usage:

```bash
coreclaw pack [project] --output worker.zip [--strict] [--go go] [--max-package-size 50MB] [--no-validate]
coreclaw pack [project] --print-files [--strict] [--go go]
```

Examples:

```bash
coreclaw pack ./worker --output ./dist/worker.zip
coreclaw pack ./worker --output ./dist/worker.zip --max-package-size 25MB --strict
coreclaw pack ./worker --print-files
coreclaw pack ./go-worker --output ./dist/go-worker.zip --go go --strict
```

## Inspection and parity

### `inspect-run`

Validate a local .coreclaw/runs/<run-id> artifact directory

Usage:

```bash
coreclaw inspect-run .coreclaw/runs/<run-id> [--min-results 1] [--require-output-schema-match] [--require-status-ok] [--json-output]
```

Examples:

```bash
coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --min-results 1
coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --require-status-ok
coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --json-output
```

### `inspect-package`

Validate upload ZIP layout and show the largest packaged entries

Usage:

```bash
coreclaw inspect-package worker.zip [--language python|node|go] [--max-package-size 50MB] [--strict]
```

Examples:

```bash
coreclaw inspect-package ./dist/worker.zip --language node
coreclaw inspect-package ./dist/worker.zip --language node --max-package-size 25MB
coreclaw inspect-package ./dist/go-worker.zip --language go --strict
```

### `compare`

Compare CoreClaw cloud JSON/CSV output with local run output

Usage:

```bash
coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--compare-profile profile.json] [--min-shared 1] [--max-diff 0]
coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--ignore-fields completed_at] [--ignore-keys key1,key2] [--require-status-ok]
```

Examples:

```bash
coreclaw compare ./cloud-output.json ./worker/.coreclaw/runs/<run-id> --min-shared 1 --max-diff 0
coreclaw compare ./cloud-output.csv ./worker/.coreclaw/runs/<run-id> --output ./tmp/compare.json
```

## Workspace and tools

### `audit`

Validate many worker-* projects and write JSON/Markdown reports

Usage:

```bash
coreclaw audit [root] --output audit.json --markdown audit.md [--audit-profile profile.json] [--all] [--fail-on-warn]
```

Examples:

```bash
coreclaw audit E:/worker --output ./tmp/audit.json --markdown ./tmp/audit.md --soft
coreclaw audit E:/worker --audit-profile ./examples/coreclaw-audit-profile.json --fail-on-warn
```

### `doctor`

Check local tools and browser endpoint discovery

Usage:

```bash
coreclaw doctor [--python "py -3"] [--node node] [--go go] [--strict]
```

Examples:

```bash
coreclaw doctor
coreclaw doctor --python "py -3" --go go --strict
```

### `help`

Show general help or command-specific help

Usage:

```bash
coreclaw help [command]
coreclaw <command> --help
```

Examples:

```bash
coreclaw help verify
coreclaw run --help
```
