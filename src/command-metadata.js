export const CLI_VERSION = '0.1.0';

export const COMMAND_GROUPS = [
  {
    title: 'Worker 开发',
    commands: ['init', 'examples', 'validate', 'env', 'run'],
  },
  {
    title: 'CoreClaw 云端',
    commands: ['account', 'workers', 'tasks', 'runs', 'prove'],
  },
  {
    title: '上传预检',
    commands: ['verify', 'pack', 'release'],
  },
  {
    title: '检查与对比',
    commands: ['inspect-run', 'inspect-package', 'compare'],
  },
  {
    title: '工作区与工具',
    commands: ['audit', 'migrate', 'doctor', 'help'],
  },
];

export const COMMANDS = {
  init: {
    summary: '创建包含 SDK 文件和 schema 的可上传 Worker',
    usage: [
      'coreclaw init [target] --language <python|node|go> [--name worker-name] [--force] [--no-input-example]',
    ],
    examples: [
      'coreclaw init ./my-worker --language node --name my-worker',
      'coreclaw init ./my-go-worker --language go',
      'coreclaw init ./my-worker --language python --no-input-example',
    ],
  },
  examples: {
    summary: '列出内置示例 Worker 及推荐的 verify 命令',
    usage: [
      'coreclaw examples [--json-output]',
    ],
    examples: [
      'coreclaw examples',
      'coreclaw examples --json-output',
      'coreclaw verify ./examples/node-http-proxy --local-proxy --require-proxy-usage --min-results 1',
    ],
  },
  validate: {
    summary: '检查 Worker 根文件、依赖、SDK 文件和 schema',
    usage: [
      'coreclaw validate [project] [--strict] [--json-output]',
    ],
    examples: [
      'coreclaw validate ./worker',
      'coreclaw validate ./worker --strict',
      'coreclaw validate ./worker --json-output',
    ],
  },
  env: {
    summary: '不运行 Worker，直接打印 CoreClaw runtime 环境变量',
    usage: [
      'coreclaw env [project] [--cloud-proxy | --local-proxy] [--chrome-ws host] [--lightpanda-domain host] [--json-output]',
      'coreclaw env [project] [--proxy-auth user:pass] [--proxy-domain host:port] [--no-discover-chrome]',
    ],
    examples: [
      'coreclaw env ./worker',
      'coreclaw env ./worker --cloud-proxy --lightpanda-domain lightpanda-inner.coreclaw.com',
      'coreclaw env ./worker --json-output',
    ],
  },
  run: {
    summary: '使用 CoreClaw SDK runtime 模拟器在本地运行 Worker',
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
  account: {
    summary: '查看 CoreClaw 账户余额和流量额度',
    usage: [
      'coreclaw account info [--json-output]',
      'CORECLAW_API_KEY=... coreclaw account info',
    ],
    examples: [
      'coreclaw account info',
      'coreclaw account info --json-output',
    ],
  },
  workers: {
    summary: '通过公开 API 搜索、查看和运行 CoreClaw Worker',
    usage: [
      'coreclaw workers search <query> [--limit 10] [--json-output]',
      'coreclaw workers detail <scraper_slug> [--json-output]',
      'coreclaw workers run <scraper_slug> --input request.json [--version auto] [--sync] [--callback-url url]',
      'coreclaw workers run <scraper_slug> --input request.json --wait [--wait-timeout 10m] [--poll-interval 5s] [--results-output cloud-results.json]',
      'coreclaw workers run <scraper_slug> --input request.json --wait --run-evidence-output run-evidence.json',
    ],
    examples: [
      'coreclaw workers search amazon --limit 5',
      'coreclaw workers detail <scraper_slug>',
      'coreclaw workers run <scraper_slug> --input cloud-request.json --version auto',
      'coreclaw workers run <scraper_slug> --input cloud-request.json --wait --results-output cloud-results.json',
      'coreclaw workers run <scraper_slug> --input cloud-request.json --wait --run-evidence-output run-evidence.json',
    ],
  },
  tasks: {
    summary: '运行已保存的 CoreClaw Task 模板',
    usage: [
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook [--json-output]',
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook --wait [--results-output task-results.json]',
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook --wait --run-evidence-output task-evidence.json',
    ],
    examples: [
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook',
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook --json-output',
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook --wait --results-output task-results.json',
      'coreclaw tasks run <task_slug> --callback-url https://example.com/webhook --wait --run-evidence-output task-evidence.json',
    ],
  },
  runs: {
    summary: '查看 CoreClaw 云端 run、日志、结果、导出和控制操作',
    usage: [
      'coreclaw runs list [--page-index 1] [--page-size 20] [--status 0] [--scraper-slug <scraper_slug>]',
      'coreclaw runs detail <run_slug> [--json-output]',
      'coreclaw runs logs <run_slug> [--json-output]',
      'coreclaw runs results <run_slug> [--page-index 1] [--page-size 20] [--output cloud-results.json]',
      'coreclaw runs export <run_slug> [--format json|csv] [--filter-keys title,url] [--download-output export.json|export.csv]',
      'coreclaw runs diagnose <run_slug> [--page-size 20] [--output diagnosis.json] [--json-output]',
      'coreclaw runs cost <run_slug> [--output cost.json] [--json-output]',
      'coreclaw runs collect <run_slug> [--output run-evidence.json] [--markdown run-evidence.md] [--download-output export.json]',
      'coreclaw runs rerun <run_slug> --callback-url https://example.com/webhook',
      'coreclaw runs abort <run_slug>',
    ],
    examples: [
      'coreclaw runs list --page-size 10',
      'coreclaw runs detail <run_slug>',
      'coreclaw runs logs <run_slug>',
      'coreclaw runs results <run_slug> --output cloud-results.json',
      'coreclaw runs export <run_slug> --format json --download-output cloud-export.json',
      'coreclaw runs diagnose <run_slug> --output diagnosis.json',
      'coreclaw runs cost <run_slug> --output cost.json',
      'coreclaw runs collect <run_slug> --output run-evidence.json --markdown run-evidence.md --download-output export.json',
      'coreclaw compare ./cloud-results.json ./worker/.coreclaw/runs/<run-id> --min-shared 1 --max-diff 0',
    ],
  },
  prove: {
    summary: '执行本地预检、启动云端 run、保存结果并对比一致性',
    usage: [
      'coreclaw prove [project] --scraper-slug <scraper_slug> --cloud-input request.json [--version auto]',
      'coreclaw prove [project] --scraper-slug <scraper_slug> --cloud-input request.json [--wait-timeout 10m] [--poll-interval 5s]',
      'coreclaw prove [project] --scraper-slug <scraper_slug> --cloud-input request.json [--min-shared 1] [--max-diff 0]',
      'coreclaw prove [project] --scraper-slug <scraper_slug> --cloud-input request.json [--run-evidence-output run-evidence.json] [--release-output release-dossier.json]',
    ],
    examples: [
      'coreclaw prove ./worker --scraper-slug <scraper_slug> --cloud-input cloud-request.json --version auto',
      'coreclaw prove ./worker --scraper-slug <scraper_slug> --cloud-input cloud-request.json --min-shared 1 --max-diff 0',
      'coreclaw prove ./worker --scraper-slug <scraper_slug> --cloud-input cloud-request.json --run-evidence-output run-evidence.json --release-output release-dossier.json',
    ],
  },
  verify: {
    summary: '在干净的类上传 staging 目录中执行上传预检',
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
    summary: '创建入口文件位于 ZIP 根目录的 CoreClaw 上传包',
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
  release: {
    summary: '整理发布候选 Worker 的本地包、云端测试和 Console 发布证据',
    usage: [
      'coreclaw release dossier [project] --package worker.zip [--cloud-run run_slug] [--compare-report report.json]',
      'coreclaw release dossier [project] --package worker.zip --run-evidence run-evidence.json --compare-report report.json',
      'coreclaw release dossier [project] [--diagnosis diagnosis.json] [--cost-report cost.json] [--output release.json] [--markdown release.md]',
    ],
    examples: [
      'coreclaw release dossier ./worker --package ./dist/worker.zip --cloud-run <run_slug> --compare-report ./worker/.coreclaw/runs/<run-id>/cloud-comparison.json',
      'coreclaw release dossier ./worker --package ./dist/worker.zip --run-evidence run-evidence.json --compare-report cloud-comparison.json',
      'coreclaw release dossier ./worker --package ./dist/worker.zip --diagnosis diagnosis.json --cost-report cost.json --output release.json --markdown release.md',
    ],
  },
  audit: {
    summary: '批量校验多个 worker-* 项目并写出 JSON/Markdown 报告',
    usage: [
      'coreclaw audit [root] --output audit.json --markdown audit.md [--audit-profile profile.json] [--all] [--fail-on-warn]',
    ],
    examples: [
      'coreclaw audit E:/worker --output ./tmp/audit.json --markdown ./tmp/audit.md --soft',
      'coreclaw audit E:/worker --audit-profile ./examples/coreclaw-audit-profile.json --fail-on-warn',
    ],
  },
  migrate: {
    summary: '审计 Apify Actor 到 CoreClaw Worker 的迁移工作量',
    usage: [
      'coreclaw migrate apify [project] [--output migration.json] [--markdown migration.md] [--json-output]',
    ],
    examples: [
      'coreclaw migrate apify ./apify-actor --output migration.json --markdown migration.md',
      'coreclaw migrate apify ./apify-actor --json-output',
    ],
  },
  'inspect-run': {
    summary: '校验本地 .coreclaw/runs/<run-id> 运行产物目录',
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
    summary: '校验上传 ZIP 的布局、大小、最大文件以及可选项目清单一致性',
    usage: [
      'coreclaw inspect-package worker.zip [--language python|node|go] [--project ./worker] [--max-package-size 50MB] [--strict]',
    ],
    examples: [
      'coreclaw inspect-package ./dist/worker.zip --language node',
      'coreclaw inspect-package ./dist/worker.zip --language node --project ./worker',
      'coreclaw inspect-package ./dist/worker.zip --language node --max-package-size 25MB',
      'coreclaw inspect-package ./dist/go-worker.zip --language go --strict',
    ],
  },
  compare: {
    summary: '对比 CoreClaw 云端 JSON/CSV 输出与本地 run 输出',
    usage: [
      'coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--compare-profile profile.json] [--min-shared 1] [--max-diff 0]',
      'coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--ignore-fields completed_at] [--ignore-keys key1,key2] [--require-status-ok]',
      'coreclaw compare cloud.json|cloud.csv .coreclaw/runs/<run-id> [--json-summary] [--output report.json]',
    ],
    examples: [
      'coreclaw compare ./cloud-output.json ./worker/.coreclaw/runs/<run-id> --min-shared 1 --max-diff 0',
      'coreclaw compare ./cloud-output.csv ./worker/.coreclaw/runs/<run-id> --output ./tmp/compare.json',
      'coreclaw compare ./cloud-results.json ./worker/.coreclaw/runs/<run-id> --json-summary',
    ],
  },
  doctor: {
    summary: '检查本地工具、浏览器端点和可选 CoreClaw 云端连通性',
    usage: [
      'coreclaw doctor [--python "py -3"] [--node node] [--go go] [--strict]',
      'coreclaw doctor --cloud [--scraper-slug <scraper_slug>]',
      'coreclaw doctor --cloud --scraper-slug <scraper_slug> --cloud-input request.json --wait [--results-output cloud-results.json]',
    ],
    examples: [
      'coreclaw doctor',
      'coreclaw doctor --python "py -3" --go go --strict',
      'coreclaw doctor --cloud --scraper-slug <scraper_slug>',
      'coreclaw doctor --cloud --scraper-slug <scraper_slug> --cloud-input cloud-request.json --wait --results-output cloud-results.json',
    ],
  },
  help: {
    summary: '显示总帮助或指定命令帮助',
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
