export const CLI_VERSION = '0.1.0';

export const COMMAND_GROUPS = [
  {
    title: 'Worker development',
    commands: ['init', 'validate', 'run'],
  },
  {
    title: 'Upload preflight',
    commands: ['verify', 'pack'],
  },
  {
    title: 'Inspection and parity',
    commands: ['inspect-run', 'inspect-package', 'compare'],
  },
  {
    title: 'Workspace and tools',
    commands: ['audit', 'doctor', 'help'],
  },
];

export const COMMANDS = {
  init: {
    summary: 'Create an upload-ready Worker with SDK files and schemas',
    usage: [
      'coreclaw init [target] --language <python|node|go> [--name worker-name] [--force] [--no-input-example]',
    ],
    examples: [
      'coreclaw init ./my-worker --language node --name my-worker',
      'coreclaw init ./my-go-worker --language go',
      'coreclaw init ./my-worker --language python --no-input-example',
    ],
  },
  validate: {
    summary: 'Check Worker root files, dependencies, SDK files, and schemas',
    usage: [
      'coreclaw validate [project] [--strict] [--json-output]',
    ],
    examples: [
      'coreclaw validate ./worker',
      'coreclaw validate ./worker --strict',
      'coreclaw validate ./worker --json-output',
    ],
  },
  run: {
    summary: 'Run a Worker locally with the CoreClaw SDK runtime emulator',
    usage: [
      'coreclaw run [project] [--input input.json | --json \'{"url":"..."}\' | --input-json \'{"url":"..."}\'] [--split 0] [--min-results 1]',
      'coreclaw run [project] [--strict] [--require-table-header] [--require-output-schema-match] [--require-status-ok]',
      'coreclaw run [project] [--local-proxy --require-proxy-usage] [--require-browser]',
      'coreclaw run [project] [--browser-cdp-shim | --lightpanda-shim | --captcha-solver] [--json-output]',
    ],
    examples: [
      'coreclaw run ./worker --input input.json --min-results 1',
      'coreclaw run ./worker --strict --require-output-schema-match',
      'coreclaw run ./worker --local-proxy --require-proxy-usage --min-results 1',
      'coreclaw run ./worker --input input.json --json-output',
    ],
  },
  verify: {
    summary: 'Run upload preflight from a clean upload-like staging directory',
    usage: [
      'coreclaw verify [project] [--input input.json] [--strict] [--min-results 1] [--no-pack]',
      'coreclaw verify [project] [--no-staging] [--no-install] [--go go]',
      'coreclaw verify [project] [--max-package-size 50MB]',
      'coreclaw verify [project] --cloud-output cloud.json|cloud.csv [--compare-profile profile.json] [--compare-output report.json]',
      'coreclaw verify [project] [--local-proxy --require-proxy-usage] [--browser-cdp-shim --require-browser-cdp-shim] [--json-output]',
    ],
    examples: [
      'coreclaw verify ./worker --strict --input input.json --min-results 1',
      'coreclaw verify ./worker --cloud-output ./cloud.csv --min-shared 1 --max-diff 0',
      'coreclaw verify ./go-worker --go go --strict --min-results 1',
      'coreclaw verify ./worker --input input.json --json-output',
    ],
  },
  pack: {
    summary: 'Create a CoreClaw upload ZIP with the entry file at archive root',
    usage: [
      'coreclaw pack [project] --output worker.zip [--strict] [--go go] [--max-package-size 50MB] [--no-validate]',
      'coreclaw pack [project] --print-files [--strict] [--go go]',
    ],
    examples: [
      'coreclaw pack ./worker --output ./dist/worker.zip',
      'coreclaw pack ./worker --output ./dist/worker.zip --max-package-size 25MB --strict',
      'coreclaw pack ./worker --print-files',
      'coreclaw pack ./go-worker --output ./dist/go-worker.zip --go go --strict',
    ],
  },
  audit: {
    summary: 'Validate many worker-* projects and write JSON/Markdown reports',
    usage: [
      'coreclaw audit [root] --output audit.json --markdown audit.md [--audit-profile profile.json] [--all] [--fail-on-warn]',
    ],
    examples: [
      'coreclaw audit E:/worker --output ./tmp/audit.json --markdown ./tmp/audit.md --soft',
      'coreclaw audit E:/worker --audit-profile ./examples/coreclaw-audit-profile.json --fail-on-warn',
    ],
  },
  'inspect-run': {
    summary: 'Validate a local .coreclaw/runs/<run-id> artifact directory',
    usage: [
      'coreclaw inspect-run .coreclaw/runs/<run-id> [--min-results 1] [--require-output-schema-match] [--require-status-ok] [--json-output]',
    ],
    examples: [
      'coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --min-results 1',
      'coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --require-status-ok',
      'coreclaw inspect-run ./worker/.coreclaw/runs/<run-id> --json-output',
    ],
  },
  'inspect-package': {
    summary: 'Validate upload ZIP root entries, package size, nested packaging mistakes, and Go executable mode',
    usage: [
      'coreclaw inspect-package worker.zip [--language python|node|go] [--max-package-size 50MB] [--strict]',
    ],
    examples: [
      'coreclaw inspect-package ./dist/worker.zip --language node',
      'coreclaw inspect-package ./dist/worker.zip --language node --max-package-size 25MB',
      'coreclaw inspect-package ./dist/go-worker.zip --language go --strict',
    ],
  },
  compare: {
    summary: 'Compare CoreClaw cloud JSON/CSV output with local run output',
    usage: [
      'coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--compare-profile profile.json] [--min-shared 1] [--max-diff 0]',
      'coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--ignore-fields completed_at] [--ignore-keys key1,key2] [--require-status-ok]',
    ],
    examples: [
      'coreclaw compare ./cloud-output.json ./worker/.coreclaw/runs/<run-id> --min-shared 1 --max-diff 0',
      'coreclaw compare ./cloud-output.csv ./worker/.coreclaw/runs/<run-id> --output ./tmp/compare.json',
    ],
  },
  doctor: {
    summary: 'Check local tools and browser endpoint discovery',
    usage: [
      'coreclaw doctor [--python "py -3"] [--node node] [--go go] [--strict]',
    ],
    examples: [
      'coreclaw doctor',
      'coreclaw doctor --python "py -3" --go go --strict',
    ],
  },
  help: {
    summary: 'Show general help or command-specific help',
    usage: [
      'coreclaw help [command]',
      'coreclaw <command> --help',
    ],
    examples: [
      'coreclaw help verify',
      'coreclaw run --help',
    ],
  },
};
