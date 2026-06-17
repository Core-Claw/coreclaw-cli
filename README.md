# CoreClaw CLI

Local development, validation, and packaging tool for [CoreClaw Workers](https://coreclaw.com).

ÖÐÎÄÎÄµµ: [README_CN.md](./README_CN.md)

## Overview

CoreClaw CLI checks Worker projects before upload: validates file structure, schema contracts, SDK dependencies, runtime behavior, and creates upload-ready ZIP packages.

**Core capabilities:**

- Validates `input_schema.json` / `output_schema.json` against platform contract (55 rules, error severity for platform rejections)
- Validates project structure (required files, SDK files, package.json / requirements.txt / go.mod)
- Runs Workers locally and captures logs, table headers, pushed rows
- Compares cloud run results with local output
- Generates upload-ready ZIP packages (Node.js / Python / Go)
- Audits Apify/Crawlee Actor migration effort

## Installation

```bash
git clone https://github.com/Core-Claw/coreclaw-cli.git
cd coreclaw-cli
npm install
node ./bin/coreclaw.js --help
```

## Quick Start

```bash
# Create a Worker project
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker

# Validate
node ./bin/coreclaw.js validate ./my-worker --strict

# Run locally
node ./bin/coreclaw.js run ./my-worker --input ./input.json --min-results 1

# Package for upload
node ./bin/coreclaw.js pack ./my-worker --output ./my-worker.zip
```

## Validation System

CLI provides multi-layer validation to ensure Workers are not rejected by the platform:

### Schema Validation

- `input_schema.json`: field types, editor compatibility, default value types, `required` field type, selector options, `select+multiple` requires array type, `max_results` naming convention
- `output_schema.json`: column name uniqueness, `type` required, supported type enum

### Project Structure Validation

- Required file checks per language (Node.js / Python / Go)
- SDK dependency declarations (`@grpc/grpc-js`, `google-protobuf`, `grpcio`, etc.)
- package.json entry and type checks (`main: main.js`, `type: commonjs`)

### Platform Feature Validation

- Proxy: detects if HTTP clients read `PROXY_AUTH` / `PROXY_DOMAIN`
- Browser: detects if workers use `ChromeWs` / `LightpandaDomain` endpoints
- CAPTCHA: detects CDP command contract usage

### Upload Preflight

```bash
node ./bin/coreclaw.js verify ./worker --strict \
  --input input.json \
  --min-results 1 \
  --require-table-header \
  --require-output-schema-match
```

## Audit Skill

The repo includes an automated audit skill for continuous CLI-vs-docs consistency checking:

```
skills/coreclaw-cli-audit/
©À©¤©¤ SKILL.md                    # Audit workflow (Phase 1-4)
©À©¤©¤ references/
©¦   ©À©¤©¤ contract-checklist.md   # 55 rules, 100% coverage
©¦   ©¸©¤©¤ known-gaps.md           # Historical fix log
©¸©¤©¤ scripts/
    ©¸©¤©¤ diff-contract.cjs       # Automated coverage scanner
```

Run coverage scan:

```bash
node skills/coreclaw-cli-audit/scripts/diff-contract.cjs
```

## Development Skill

`skills/coreclaw-cli/SKILL.md` is the AI agent development guide covering:

- Worker contract specification (file structure, schema rules, SDK modules)
- Command development workflows
- Test and verification commands
- Release checklist

## Command Reference

### Worker Development

| Command | Description |
|---------|-------------|
| `init` | Create Worker project with SDK files and schema |
| `validate` | Validate project structure, dependencies, schema |
| `run` | Run Worker locally |
| `verify` | Upload preflight (staging-level validation) |
| `env` | Print runtime environment variables |

### Packaging & Inspection

| Command | Description |
|---------|-------------|
| `pack` | Create upload-ready ZIP package |
| `inspect-package` | Inspect ZIP package contents |

### Cloud Operations

| Command | Description |
|---------|-------------|
| `account` | Account info |
| `workers` | Search/view Workers |
| `runs` | Run history/detail/result/export |
| `tasks` | Task management |

### Comparison & Diagnostics

| Command | Description |
|---------|-------------|
| `compare` | Compare cloud results with local output |
| `doctor` | Diagnose environment issues |
| `audit` | Batch-validate multiple Workers |

## Full Command Reference

See [docs/commands.md](./docs/commands.md) for detailed usage, options, and examples for every command.

## Platform Contract Reference

CLI validation rules are derived from official documentation:

- [Project Structure](https://docs.coreclaw.com/developer-guide/worker-definition/project-structure/)
- [Input Schema](https://docs.coreclaw.com/developer-guide/worker-definition/input-schema/)
- [Output Schema](https://docs.coreclaw.com/developer-guide/worker-definition/output-schema/)
- [SDK Modules](https://docs.coreclaw.com/developer-guide/worker-definition/sdk-modules/)
- [Proxy Support](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/proxy-support/)
- [Browser Fingerprinting](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/browser-fingerprinting/)
- [CAPTCHA Handling](https://docs.coreclaw.com/developer-guide/worker-definition/platform-features/captcha-handling/)
- [API Integration](https://docs.coreclaw.com/api/integration/)

## Development

```bash
# Run tests
npm test

# Generate command docs
npm run docs

# Release verification
npm run verify:release
```

## CI

GitHub Actions runs tests on Windows + Node 20.x/22.x. Linux CI removed (case-sensitivity validation tests depend on Windows filesystem behavior).

## License

MIT