# CoreClaw CLI 中文说明

CoreClaw CLI 是面向 CoreClaw Worker 的本地开发、验证和打包工具。它的目标不是做一个普通脚本启动器，而是把 CoreClaw 平台文档里的 Worker 结构、SDK 调用、输入输出 schema、代理、浏览器端点、Lightpanda、CAPTCHA 命令和上传 ZIP 规则变成本地可执行的预检流程。

英文说明见 [README.md](./README.md)。

## 这个工具解决什么问题

CoreClaw Worker 上传后由平台准备运行环境、安装依赖、注入环境变量、提供 `127.0.0.1:20086` 的 SDK gRPC 服务、执行入口文件、收集日志并保存 SDK 推送的数据行。

这意味着一个 Worker 不是单个脚本，而是一个符合平台规范的项目。常见上传失败并不是业务代码本身的问题，而是：

- ZIP 根目录多包了一层目录。
- Go 上传包没有编译后的 Linux amd64 可执行文件 `main`。
- Windows 打包丢失 Go `main` 的可执行权限。
- `requirements.txt`、`package.json` 或 `go.mod/go.sum` 缺少运行时依赖。
- 本地能联网，但平台网络沙箱中没有使用 `PROXY_AUTH` / `PROXY_DOMAIN`。
- 浏览器 Worker 本地启动浏览器，但上传后没有读取 `ChromeWs`、`ChromeHttp` 或 `LightpandaDomain`。
- `input_schema.json` 的字段、类型、默认值、拆分 key 不符合平台表单规则。
- `output_schema.json` 和实际 `push_data` 字段不一致。
- Worker 进程退出码是 `0`，但输出行里已经包含 `status=fail` 之类的业务失败。

CoreClaw CLI 用本地命令把这些问题提前暴露出来。

## 主要能力

- 生成 Python、Node.js、Go Worker 模板，并包含官方 SDK 文件。
- 校验 Worker 根目录必需文件、依赖文件、SDK 文件、输入输出 schema。
- 本地启动 CoreClaw SDK gRPC 兼容服务，让 Worker 的 SDK 调用可运行。
- 根据 `input_schema.json` 校验实际运行输入。
- 捕获日志、表头、原始结果行、按 `output_schema.json` 投影后的导出行和 schema 漂移。
- 强制结果行数、结果状态、runtime table header、output schema、代理使用、浏览器连接、Lightpanda 连接、CAPTCHA 调用等门槛。
- 生成 CoreClaw 上传 ZIP，确保入口文件位于 ZIP 根目录。
- 为 Go Worker 构建 Linux amd64 可执行文件 `main`，并保留 ZIP 内 `100755` 可执行权限。
- 检查已有 ZIP 的根目录结构、嵌套目录错误、Go 可执行权限等问题。
- 将 CoreClaw 平台 JSON/CSV 输出与本地 run 输出对比。
- 批量审计工作区内的 `worker-*` 项目。

当前开发目标、已完成内容、可解决不足和仅能在云端验证的限制记录在 [docs/roadmap.md](./docs/roadmap.md)。精确命令语法由 CLI 元数据生成，见 [docs/commands.md](./docs/commands.md)。

## 安装

在仓库内：

```bash
npm install
node ./bin/coreclaw.js --help
```

本地开发时可以直接用路径调用：

```bash
node E:/worker/coreclaw-cli/bin/coreclaw.js doctor
```

如果已经全局安装或 link 到 shell，可以使用：

```bash
coreclaw --help
```

## 快速开始

创建一个 Node.js Worker，并完成本地验证和上传包生成：

```bash
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker
node ./bin/coreclaw.js validate ./my-worker --strict
node ./bin/coreclaw.js run ./my-worker --min-results 1
node ./bin/coreclaw.js verify ./my-worker --strict --min-results 1
```

验证内置示例，并与一份云端输出做对比：

```bash
node ./bin/coreclaw.js verify ./examples/node-hello \
  --cloud-output ./examples/node-hello-cloud-output.json \
  --compare-output ./tmp/node-hello-comparison.json \
  --min-shared 1 \
  --max-diff 0 \
  --output ./tmp/node-hello.zip
```

本仓库发布前校验：

```bash
npm run verify:release
```

## CoreClaw Worker 项目结构

### Python 源码项目

```text
main.py
requirements.txt
README.md
input_schema.json
output_schema.json
sdk.py
sdk_pb2.py
sdk_pb2_grpc.py
```

### Node.js 源码项目

```text
main.js
package.json
README.md
input_schema.json
output_schema.json
sdk.js
sdk_pb.js
sdk_grpc_pb.js
```

Node.js Worker 推荐按官方 SDK 文件使用 CommonJS：

```javascript
const coresdk = require('./sdk')
```

`package.json` 应符合 `main.js` + CommonJS 的运行约定。运行时依赖必须声明在 `dependencies` 或 `optionalDependencies` 中，不要只放在 `devDependencies`。例如 `@grpc/grpc-js`、`google-protobuf`、`puppeteer-core`、`axios`、`socks-proxy-agent` 等。

### Go 源码项目

```text
main.go
go.mod
go.sum
README.md
input_schema.json
output_schema.json
GoSdk/
  sdk.go
  sdk.pb.go
  sdk_grpc.pb.go
```

Go Worker 需要区分两个阶段：

- 源码项目：包含 `main.go`、`go.mod`、`go.sum`、`GoSdk/`、schema 和 README。
- 上传 ZIP：根目录必须包含编译后的 Linux amd64 可执行文件 `main`。

CoreClaw CLI 会用下面的方式构建 Go 上传入口：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -o main ./main.go
```

在 Windows 上用普通压缩工具打包 Go Worker 时，容易丢失 Linux 可执行权限。`coreclaw pack` 和 `coreclaw verify` 会保留 ZIP 中根目录 `main` 的 `100755` mode，`coreclaw inspect-package` 也会检查这一点。

## 上传 ZIP 结构

上传 ZIP 的运行入口必须在 archive root：

- Python：根目录 `main.py`。
- Node.js：根目录 `main.js`。
- Go：根目录编译后二进制 `main`。

不要上传包含额外目录层级的 ZIP，例如 ZIP 内是 `worker/main.js`。平台查找的是 ZIP 根目录入口。

CoreClaw CLI 打包时会排除：

- `.coreclaw/`
- `node_modules/`
- Python virtualenv
- 构建目录
- 缓存目录
- git metadata
- 临时文件

检查任意 ZIP：

```bash
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go --strict
```

## input_schema.json

`input_schema.json` 定义 CoreClaw 启动 Worker 时展示给用户的输入表单。CLI 会做静态校验，也会在本地 run 前校验实际输入。

根字段：

- `description`：可选，Worker 说明。
- `b`：必填，任务拆分 key，必须指向一个 `array` 类型 property。
- `properties`：必填，输入项数组。

示例：

```json
{
  "description": "Fetch pages and return basic metadata.",
  "b": "urls",
  "properties": [
    {
      "title": "URLs",
      "name": "urls",
      "type": "array",
      "editor": "requestList",
      "default": [
        { "url": "https://example.com" }
      ],
      "required": true
    },
    {
      "title": "Timeout (ms)",
      "name": "timeoutMs",
      "type": "integer",
      "editor": "number",
      "minimum": 1000,
      "maximum": 120000,
      "default": 60000
    }
  ]
}
```

支持的 `type`：

- `string`
- `integer`
- `boolean`
- `array`
- `object`

常见 `editor`：

- `input`
- `textarea`
- `number`
- `select`
- `radio`
- `checkbox`
- `switch`
- `datepicker`
- `requestList`
- `requestListSource`
- `stringList`

重要规则：

- 每个 `name` 必须唯一。
- `name` 建议使用 ASCII 标识符，便于代码读取。
- `b` 必须指向一个 `array` property。
- `requestList` 每一项必须包含非空 `url`。
- `stringList` 每一项必须包含非空 `string`。
- `requestListSource` 可以通过 `param_list` 声明自定义列表项字段。
- `select`、`radio`、`checkbox` 的值必须来自 `options`。
- 数值字段可以声明 `minimum` 和 `maximum`。
- `required: true` 的字段在运行时必须存在且非空。

传入运行输入：

```bash
node ./bin/coreclaw.js run ./worker --input input.json
node ./bin/coreclaw.js run ./worker --json "{\"timeoutMs\":60000}"
node ./bin/coreclaw.js run ./worker --input-json "{\"timeoutMs\":60000}"
node ./bin/coreclaw.js run ./worker --split 0
```

在 Windows 和 CI 脚本里，复杂输入优先使用 `--input input.json`，避免 shell 改写 inline JSON。

## output_schema.json

`output_schema.json` 定义平台展示和导出的结果表。它是一个 JSON 数组：

```json
[
  {
    "name": "url",
    "type": "string",
    "description": "URL"
  },
  {
    "name": "status",
    "type": "string",
    "description": "Status"
  },
  {
    "name": "html_length",
    "type": "integer",
    "description": "HTML Length"
  }
]
```

支持的输出类型：

- `string`
- `integer`
- `boolean`
- `array`
- `object`

`name` 必须和 Worker 调用 SDK `push_data` 时的字段一致。本地运行时 CLI 会写出：

- `results.ndjson`：SDK `push_data` 原始结果行。
- `export.ndjson`：按 `output_schema.json` 投影后的结果行。
- `output_schema_issues.json`：字段缺失、额外字段、类型错误、非 object 结果行等问题。

如果希望 schema 漂移直接导致本地 run 或上传预检失败，使用：

```bash
--require-output-schema-match
```

## SDK 使用方式

Worker 通过项目里的 SDK 文件和 CoreClaw 平台通信。CoreClaw CLI 会在本地启动兼容的 gRPC server，让这些 SDK 调用可以在本机运行。

### 读取输入

Python：

```python
from sdk import CoreSDK

input_dict = CoreSDK.Parameter.get_input_json_dict()
input_json = CoreSDK.Parameter.get_input_json_str()
```

Node.js：

```javascript
const coresdk = require('./sdk')

const input = await coresdk.parameter.getInputJSONObject()
const inputJson = await coresdk.parameter.getInputJSONString()
```

Go：

```go
inputJSON, err := coresdk.Parameter.GetInputJSONString(ctx)
```

### 写日志

```javascript
await coresdk.log.debug('debug details')
await coresdk.log.info('normal progress')
await coresdk.log.warn('recoverable warning')
await coresdk.log.error('error details')
```

### 设置 runtime 表头

```javascript
await coresdk.result.setTableHeader([
  { label: 'URL', key: 'url', format: 'text' },
  { label: 'Status', key: 'status', format: 'text' },
])
```

CLI 默认会在 Worker 没有调用 table header API 时给出 warning。上传前希望强制执行这个 SDK 契约时使用：

```bash
--require-table-header
```

### 推送结果行

```javascript
await coresdk.result.pushData({
  url: 'https://example.com',
  status: 'ok',
})
```

建议每次推送一个 JSON object，并确保字段和 `output_schema.json`、runtime table header 的 key 一致。

## 命令说明

### `help`

显示顶层帮助或某个命令的详细帮助。

```bash
node ./bin/coreclaw.js --help
node ./bin/coreclaw.js help verify
node ./bin/coreclaw.js run --help
```

当你知道要使用哪个工作流，但不确定具体参数和示例时，优先使用命令级帮助。输入未知命令时，CLI 也会尽量给出相近命令建议。

同一份命令元数据也会生成 [docs/commands.md](./docs/commands.md)，便于离线阅读和发布前校验。

### `doctor`

检查本地工具和浏览器端点。

```bash
node ./bin/coreclaw.js doctor
node ./bin/coreclaw.js doctor --python "py -3" --go go --strict
```

它会报告 Python、Node.js、Go、Chrome CDP 发现情况。调试 Worker 前建议先跑一次。

### `init`

创建新的 Worker。

```bash
node ./bin/coreclaw.js init ./my-node-worker --language node --name my-node-worker
node ./bin/coreclaw.js init ./my-python-worker --language python
node ./bin/coreclaw.js init ./my-go-worker --language go
```

常用选项：

- `--language python|node|go`：Worker 语言。
- `--name <name>`：包名或模块名。
- `--force`：覆盖已有目标目录。

生成项目会包含入口文件、依赖文件、SDK 文件、`README.md`、`input_schema.json` 和 `output_schema.json`。

### `validate`

静态校验 Worker 是否符合上传准备要求。

```bash
node ./bin/coreclaw.js validate ./worker
node ./bin/coreclaw.js validate ./worker --strict
```

校验内容包括：

- Python、Node.js、Go 的根目录必需文件。
- 是否只有一个语言入口。
- SDK 文件是否齐全。
- 依赖声明是否齐全。
- Node.js `main.js` + CommonJS 契约。
- Node.js 源码中第三方依赖是否声明在运行时依赖中。
- Python 源码中第三方依赖是否声明在 `requirements.txt` 中。
- Go SDK 依赖和 `go.sum` checksum。
- `input_schema.json` 的结构、字段名、editor/type、required、options、数值边界、`b` 拆分 key。
- `output_schema.json` 的列名和类型。
- HTTP Worker 是否读取 `PROXY_AUTH` / `PROXY_DOMAIN`。
- 浏览器 Worker 是否读取 `ChromeWs`、`ChromeHttp`、`LightpandaDomain`、`CDP_ENDPOINT` 或 `BROWSER_WS_ENDPOINT`。

默认模式会兼容旧 Worker，warning 不一定失败。新 Worker 或上传前建议使用 `--strict`。

### `run`

在本地 CoreClaw SDK runtime 中运行 Worker。

```bash
node ./bin/coreclaw.js run ./worker --input input.json --min-results 1
node ./bin/coreclaw.js run ./worker --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./worker --split 0
node ./bin/coreclaw.js run ./worker --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./worker --strict --min-results 1
```

常用运行门槛：

```bash
node ./bin/coreclaw.js run ./worker --require-status-ok
node ./bin/coreclaw.js run ./worker --require-status-ok --result-status-fields status,check_status --result-fail-values fail,error
node ./bin/coreclaw.js run ./worker --require-table-header
node ./bin/coreclaw.js run ./worker --require-output-schema-match
node ./bin/coreclaw.js run ./worker --min-results 1
```

`--require-status-ok` 会检查结果行中的失败状态。默认检查 `status` 字段，默认失败值包括 `fail`、`failed`、`failure`、`error` 等。不同 Worker 可用 `--result-status-fields` 和 `--result-fail-values` 调整。

`--strict` 会启用严格静态校验，并默认启用 table header、output schema、status 行等运行时门槛，除非你显式覆盖。

运行产物：

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  upload_manifest.json
  logs.ndjson
  results.ndjson
  export.ndjson
  output_schema_issues.json
  table_headers.json
  captcha_solver_calls.json
  tmp/
  summary.json
```

部分文件只在对应功能启用时出现。

### `verify`

上传前预检命令，也是上传前最重要的本地门槛。

```bash
node ./bin/coreclaw.js verify ./worker --strict --input input.json --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --no-pack
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
```

`verify` 会执行：

1. 静态项目校验。
2. 把可上传文件复制到干净 staging 目录。
3. 在 staging 中安装依赖。
4. 用本地 CoreClaw SDK runtime 执行 staged Worker。
5. 强制结果行数和状态门槛。
6. 可选对比 CoreClaw 云端输出。
7. 除非使用 `--no-pack`，否则创建上传 ZIP。
8. 检查生成的上传包。

Python verify 会创建临时 virtualenv，避免全局 Python 包掩盖 `requirements.txt` 缺失。

Node.js verify 会用 `npm ci --omit=dev` 或 `npm install --omit=dev` 安装运行时依赖，避免 dev-only 依赖掩盖平台上传失败。

Go verify 会构建 Linux amd64 `main`，再从上传视角的 runtime staging 目录执行，而不是直接依赖源码目录。

`verify` 默认启用 `--require-status-ok`。如果你的 Worker 的 `status` 字段不是错误语义，而是业务标签，可以用：

```bash
--no-require-status-ok
```

推荐上传前严格命令：

```bash
node ./bin/coreclaw.js verify ./worker \
  --strict \
  --input input.json \
  --min-results 1 \
  --require-table-header \
  --require-output-schema-match
```

### `pack`

创建上传 ZIP。

```bash
node ./bin/coreclaw.js pack ./worker --output ./dist/worker.zip
node ./bin/coreclaw.js pack ./go-worker --output ./dist/go-worker.zip --go go --strict
```

`pack` 会校验项目、复制可上传文件、必要时构建 Go 上传二进制、写出 ZIP，并执行包检查。`--strict` 会把兼容性 warning 也作为失败处理。

### `inspect-package`

检查已有上传 ZIP。

```bash
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language python
node ./bin/coreclaw.js inspect-package ./dist/worker.zip --language node --strict
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go
```

它会检查：

- 根目录入口文件。
- 必需 SDK 和依赖文件。
- ZIP 是否多包了一层目录。
- 推荐元数据文件。
- Go 根目录是否有可执行 `main`。
- Go `main` 是否是 `100755` mode。

### `inspect-run`

检查已有本地运行产物。

```bash
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --min-results 1
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --require-status-ok
node ./bin/coreclaw.js inspect-run ./worker/.coreclaw/runs/<run-id> --require-output-schema-match
```

当你已经有 `.coreclaw/runs/<run-id>`，但想重新应用结果行数、状态或 output schema 门槛时使用它。

### `compare`

对比 CoreClaw 平台输出和本地输出。

```bash
node ./bin/coreclaw.js compare \
  ./cloud-output.json \
  ./worker/.coreclaw/runs/<run-id> \
  --output ./tmp/cloud-comparison.json \
  --min-shared 1 \
  --max-diff 0 \
  --require-unique-keys \
  --require-status-ok \
  --output-schema ./worker/output_schema.json
```

云端输出可以是：

- JSON 数组。
- CoreClaw result-list API 包装结果，例如 `data.list`、`data.rows`、`data.items`、`data.results`、`data.records` 等。
- CSV 导出文件。

如果 API 响应里只有 `data.download_url`，请先下载真实 JSON/CSV 文件，再交给 `compare`。

常用选项：

- `--key-fields url,check_name`：指定对比 key。
- `--ignore-fields completed_at,__coreclaw_data_id__`：忽略波动字段。
- `--ignore-keys key1,key2`：忽略已知只在云端或本地出现的行。
- `--ignore-keys-file file`：从 JSON 或文本加载忽略 key。
- `--compare-profile profile.json`：复用对比配置。
- `--min-shared <n>`：至少 N 个共同 key。
- `--max-diff <n>`：限制字段值差异数量。
- `--max-only-cloud <n>` / `--max-only-local <n>`：限制单侧行数。
- `--require-output-schema-match`：按 `output_schema.json` 校验行。
- `--require-status-ok`：检查失败状态行。

`verify` 也可以在上传预检中直接做云端对比：

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output ./cloud-output.csv \
  --compare-output ./tmp/cloud-comparison.json \
  --min-shared 1 \
  --max-diff 0
```

如果需要保留 `--cloud-output` 但本次不对比，可以加：

```bash
--no-compare
```

### `audit`

批量审计一个目录下的 Worker。

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft

node ./bin/coreclaw.js audit E:/worker \
  --audit-profile ./examples/coreclaw-audit-profile.json \
  --fail-on-warn
```

默认发现 `worker-*` 目录。只有当你明确想审计所有带 Worker 入口文件的目录时，才使用 `--all`。

常用选项：

- `--recursive`：递归扫描。
- `--all`：包含非 `worker-*` 但看起来像 Worker 的目录。
- `--soft`：写报告但不让进程失败。
- `--fail-on-warn`：warning 也失败。
- `--ignore-issue-codes code1,code2`：保留已知问题记录，但不计入 pass/fail。
- `--audit-profile profile.json`：复用审计配置。

报告会包含 issue code、证据、文档依据、修复建议、ignored issues 和汇总计数。

## 平台功能本地验证

### HTTP SOCKS5 代理

CoreClaw 的 HTTP 请求 Worker 运行在网络沙箱中，必须使用平台代理：

- `PROXY_AUTH`：`username:password`
- `PROXY_DOMAIN`：代理 host 和 port

Node.js 示例：

```javascript
const axios = require('axios')
const { SocksProxyAgent } = require('socks-proxy-agent')

const proxyAuth = process.env.PROXY_AUTH
const proxyDomain = process.env.PROXY_DOMAIN
const proxyUrl = proxyAuth && proxyDomain ? `socks5://${proxyAuth}@${proxyDomain}` : null

const axiosConfig = { timeout: 30000 }
if (proxyUrl) {
  const agent = new SocksProxyAgent(proxyUrl)
  axiosConfig.httpAgent = agent
  axiosConfig.httpsAgent = agent
  axiosConfig.proxy = false
}

const response = await axios.get('https://ipinfo.io/ip', axiosConfig)
```

本地证明 Worker 确实使用代理：

```bash
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage --min-results 1
```

`--local-proxy` 会启动本地带认证 SOCKS5 代理并注入 env；`--require-proxy-usage` 会在 Worker 没有发起 SOCKS5 CONNECT 时失败。

如果只想注入云端风格占位变量，不启动真实代理：

```bash
node ./bin/coreclaw.js run ./worker --cloud-proxy
```

### 浏览器自动化

CoreClaw 浏览器 Worker 不应该在生产代码里启动本地浏览器，而应该连接平台注入的远程浏览器端点。

常见变量：

- `ChromeWs`：Playwright、Puppeteer、DrissionPage 使用的 host-style CDP WebSocket。
- `ChromeHttp`：Selenium Remote WebDriver 使用的 HTTP endpoint。
- `CDP_ENDPOINT`：完整 `ws://...` endpoint。
- `BROWSER_WS_ENDPOINT`：完整 browser WebSocket endpoint alias。

本地 Chrome 检测：

```bash
node ./bin/coreclaw.js doctor
node ./bin/coreclaw.js verify ./browser-worker --require-browser --min-results 1
```

如果本地 Chrome remote debugging 在 `127.0.0.1:9222`，CLI 会通过 `/json/version` 自动发现 browser WebSocket。

显式端点：

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --chrome-ws "127.0.0.1:9222/devtools/browser/<id>" \
  --require-browser \
  --min-results 1
```

验证 host-style `ChromeWs` / DrissionPage 连接契约：

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --browser-cdp-shim \
  --require-browser-cdp-shim \
  --min-results 1
```

这个 shim 接受 `ws://<ChromeWs>/devtools/browser/<id>` 和 DrissionPage 风格 `ws://<ChromeWs>/ws?apiKey=<PROXY_AUTH>`，用于证明 Worker 代码确实读取并连接 CoreClaw 的环境变量。

### Lightpanda

Lightpanda 是 CoreClaw 托管的 CDP 浏览器端点，不是自动化框架。你仍然用 Playwright 等库写自动化逻辑，只是连接 `LightpandaDomain`，而不是启动本地浏览器。

Worker 代码应当：

1. 读取 `LightpandaDomain`。
2. 如果它是裸域名，归一化为 `ws://<domain>/devtools/browser/new`。
3. 读取 `PROXY_AUTH`。
4. 用 `PROXY_AUTH` 生成 Basic `Authorization`。
5. 用 Playwright `connect_over_cdp` 连接。

本地契约验证：

```bash
node ./bin/coreclaw.js verify ./lightpanda-worker \
  --lightpanda-shim \
  --require-lightpanda-shim \
  --min-results 1
```

使用真实显式端点：

```bash
node ./bin/coreclaw.js verify ./lightpanda-worker \
  --lightpanda-domain "lightpanda-inner.coreclaw.com" \
  --min-results 1
```

本地 shim 校验 endpoint 形状和 Basic auth。真实页面导航和渲染仍需要在 CoreClaw 平台或真实上游 CDP endpoint 上验证。

### CAPTCHA

CoreClaw 通过自定义 CDP 命令提供 CAPTCHA 处理：

```text
Captchas.automaticSolver
```

参数：

- `timeout`：正数，秒。
- `solverType`：官方文档中的 solver 类型。

支持的 solverType：

- `cloudflare`
- `datadome`
- `google-v2`
- `google-v3`
- `oocl_slide`
- `perimeterx`
- `shein_same_object_click`
- `temu_auto`
- `tiktok_slide_simple`
- `tiktok_slide_auto`

调用后必须判断返回结果。`status=false` 或 `target page don't have verify code` 不能当成成功。

本地契约验证：

```bash
node ./bin/coreclaw.js verify ./browser-worker \
  --captcha-solver \
  --require-captcha-solver \
  --min-results 1
```

本地 shim 会对 `Captchas.automaticSolver` 返回 `{ "status": true }`，把调用记录写入 `captcha_solver_calls.json`，并在缺少调用或参数不符合文档时失败。

## 推荐的生产 Worker 流程

新 Worker 建议按这个顺序：

1. 生成或准备 Worker 项目。
2. 编写 `input_schema.json`，让平台表单和实际输入一致。
3. 编写 `output_schema.json`，让输出列和 `push_data` 字段一致。
4. 通过 SDK 读取输入。
5. 通过 SDK 写日志。
6. 设置 runtime table header。
7. 每次推送一个 JSON object 结果行。
8. HTTP 请求使用 `PROXY_AUTH` / `PROXY_DOMAIN`。
9. 浏览器 Worker 使用 `ChromeWs`、`ChromeHttp`、`LightpandaDomain` 或完整 CDP endpoint。
10. 运行 `coreclaw validate --strict`。
11. 运行 `coreclaw verify --strict --input input.json --min-results 1`。
12. 上传 `verify` 生成的 ZIP，或用 `coreclaw pack` 生成 ZIP。
13. 在 CoreClaw 平台真实运行。
14. 导出平台 JSON 或 CSV。
15. 用 `coreclaw compare` 或 `coreclaw verify --cloud-output` 对比平台与本地结果。

通用上传前命令：

```bash
node ./bin/coreclaw.js verify ./worker \
  --strict \
  --input input.json \
  --min-results 1 \
  --require-table-header \
  --require-output-schema-match
```

按 Worker 类型增加门槛：

```bash
# HTTP 请求 Worker
node ./bin/coreclaw.js verify ./worker --strict --input input.json --local-proxy --require-proxy-usage --min-results 1

# 浏览器 Worker
node ./bin/coreclaw.js verify ./worker --strict --input input.json --require-browser --min-results 1

# host-style ChromeWs / DrissionPage 契约
node ./bin/coreclaw.js verify ./worker --strict --input input.json --browser-cdp-shim --require-browser-cdp-shim --min-results 1

# Lightpanda 契约
node ./bin/coreclaw.js verify ./worker --strict --input input.json --lightpanda-shim --require-lightpanda-shim --min-results 1

# CAPTCHA CDP 命令契约
node ./bin/coreclaw.js verify ./worker --strict --input input.json --captcha-solver --require-captcha-solver --min-results 1
```

## compare profile

对比配置可以写成 JSON 文件复用：

```json
{
  "key_fields": ["url", "check_name"],
  "ignore_fields": ["completed_at", "__coreclaw_data_id__"],
  "min_shared": 1,
  "max_diff": 0,
  "require_unique_keys": true,
  "require_status_ok": true,
  "result_status_fields": ["status"],
  "result_fail_values": ["fail", "failed", "failure", "error"]
}
```

运行：

```bash
node ./bin/coreclaw.js compare ./cloud-output.json ./worker/.coreclaw/runs/<run-id> --compare-profile ./compare-profile.json
```

`verify --compare-profile` 也可以读取 profile 里的运行默认值，例如代理、浏览器、Lightpanda、CAPTCHA 和结果状态设置。

## 脚本化和退出码

CoreClaw CLI 适合 CI 和可重复脚本：

- 未知长选项会在 Worker 启动前失败。
- 每个命令只接受自己的选项。
- Boolean 支持 `--flag`、`--no-flag`、`--flag=true|false`。
- 校验、运行、打包、对比失败时返回非零退出码。
- 支持 JSON 报告输出，便于自动化读取。

## 常见问题

### 本地 run 通过，但上传后失败

不要只用源码目录 `run`，改用上传视角的 `verify`：

```bash
node ./bin/coreclaw.js verify ./worker --strict --input input.json --min-results 1
```

它会捕获缺失依赖声明、被忽略文件、SDK 文件缺失、输出漂移、runtime table header 缺失、ZIP 根目录错误等问题。

### Go 上传直接失败且没有 Worker 日志

检查 ZIP：

```bash
node ./bin/coreclaw.js inspect-package ./dist/go-worker.zip --language go --strict
```

ZIP 根目录必须包含 `100755` mode 的可执行文件 `main`。不要只上传 `main.go`。

### HTTP 请求本机能访问，平台不能访问

平台是网络沙箱，必须使用 SOCKS5 代理：

```bash
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage --min-results 1
```

静态校验也会在检测到 HTTP 库但没有读取 `PROXY_AUTH` / `PROXY_DOMAIN` 时给出 warning。

### 浏览器 Worker 在本地启动浏览器

生产 Worker 应连接平台注入的浏览器 endpoint。本地启动浏览器应该只放在明确的本地调试分支里。

```bash
node ./bin/coreclaw.js validate ./worker --strict
node ./bin/coreclaw.js verify ./worker --browser-cdp-shim --require-browser-cdp-shim --min-results 1
```

### 云端 JSON 只有 download_url

先下载真实 JSON 或 CSV 文件，再传给 `compare`。`compare` 读取的是结果行，不是只有下载链接的元数据响应。

### Windows inline JSON 被转义影响

使用输入文件：

```bash
node ./bin/coreclaw.js verify ./worker --input input.json --min-results 1
```

## 本仓库验证

给 CLI 本身做贡献时：

```bash
npm test
npm run verify
npm run verify:release
```

`npm run verify:release` 会运行单元测试、验证 Node 示例并做云端输出对比、执行 `git diff --check`，以及 `npm pack --dry-run --json`。

维护者可使用工作区矩阵脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-windows-worker-matrix.ps1
node .\tools\verify-platform-output.js worker-definition-node-puppeteer-contract-test E:\downloads\node-output.json
```

这些是本仓库维护工具，普通 Worker 作者不需要使用。

## License

MIT
