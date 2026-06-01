# CoreClaw CLI

CoreClaw worker 本地运行时、验证器和上传前预检 CLI。

CoreClaw 官方开发者文档描述了上传就绪的 worker 项目结构、平台注入的 SDK 文件、`input_schema.json`、`output_schema.json`、SDK gRPC 端点 `127.0.0.1:20086`，以及 `PROXY_AUTH`、`PROXY_DOMAIN`、`ChromeWs` 等运行时变量。同时，官方文档也说明本地 SDK worker 模式尚不可用。本 CLI 的目标就是补齐这个缺口，让开发者在上传前尽量做到“本地跑通 = 平台跑通”。

## 模拟能力

- CoreClaw SDK gRPC 服务：
  - `Parameter/GetInputJSONString`
  - `Result/SetTableHeader`
  - `Result/PushData`
  - `Log/Debug`、`Log/Info`、`Log/Warn`、`Log/Error`
- 从 `input_schema.json` 默认值、`--input` 或 `--json` 注入运行输入。
- 平台环境变量：
  - `ChromeWs`
  - `CDP_ENDPOINT` / `BROWSER_WS_ENDPOINT`
  - 请求云端代理模式时的 `PROXY_AUTH` / `PROXY_DOMAIN`
- 每次运行独立的临时状态目录：
  - `CORECLAW_TMP_DIR`
  - `TMPDIR` / `TMP` / `TEMP`
- `.coreclaw/runs/<run-id>/` 下的运行生命周期产物。
- 上传 ZIP 结构验证和打包。
- `verify` 默认从上传包视角的临时 staging 目录运行，并在该目录安装依赖。

它不会模拟 CoreClaw 真实的远程指纹浏览器池。浏览器 worker 可以启动本地 Chrome remote debugging `127.0.0.1:9222`，或用 `--chrome-ws` 传入真实远程 CDP 端点。HTTP worker 可以使用 `--local-proxy --require-proxy-usage` 通过 `PROXY_AUTH` / `PROXY_DOMAIN` 暴露本地 SOCKS5 代理，并在 worker 绕过代理时让 run 失败。

## 安装

在仓库内：

```bash
npm install
node ./bin/coreclaw.js --help
```

本地开发时也可以直接调用可执行文件：

```bash
node E:/worker/coreclaw-cli/bin/coreclaw.js doctor
```

提交 CLI 改动前运行：

```bash
npm run verify
```

这个命令会先跑单元测试，再对 Node 示例 worker 执行 `coreclaw verify`，包括与 `examples/node-hello-cloud-output.json` 的云端输出对比。

## 命令

### 创建 Worker

```bash
node ./bin/coreclaw.js init ./my-worker --language node --name my-worker
node ./bin/coreclaw.js init ./my-python-worker --language python
node ./bin/coreclaw.js init ./my-go-worker --language go
```

生成的项目会包含 CoreClaw 官方文档要求的 SDK 文件：

- Python: `sdk.py`, `sdk_pb2.py`, `sdk_pb2_grpc.py`
- Node.js: `sdk.js`, `sdk_pb.js`, `sdk_grpc_pb.js`
- Go: `GoSdk/sdk.go`, `GoSdk/sdk.pb.go`, `GoSdk/sdk_grpc.pb.go`

### 静态校验

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
```

校验内容包括：

- 根目录只能有一个入口文件：`main.py`、`main.js` 或 `main.go`。
- 必需的依赖文件、SDK 文件和 `input_schema.json`。
- SDK 运行时依赖必须声明在平台依赖文件中：
  - Python: `requirements.txt` 中的 `grpcio`、`protobuf`
  - Node.js: `package.json` 中的 `@grpc/grpc-js`、`google-protobuf`
  - Go: `go.mod` 中的 `google.golang.org/grpc`、`google.golang.org/protobuf`
- `input_schema.json` 根字段、唯一 property name、受支持的类型和 editor。
- `input_schema.b` 必须指向一个 array property。
- 存在 `output_schema.json` 时校验列名和受支持类型。

CoreClaw 上传后会从 `requirements.txt`、`package.json` 或 `go.mod` 安装依赖。因此 CLI 会拒绝那些本地机器因为已安装 SDK 包而能运行、但云端安装文件没有声明这些包的 worker。

官方文档把 `output_schema.json` 描述为上传就绪项目文件，但当前平台仍兼容没有 `output_schema.json` 的老 worker。因此 CLI 把缺失 `output_schema.json` 作为 warning，而不是阻塞错误。没有 output schema 时，本地 `export.ndjson` 会保留完整原始结果行。

### 批量审计 Worker

```bash
node ./bin/coreclaw.js audit E:/worker \
  --output ./tmp/all-workers-audit.json \
  --markdown ./tmp/all-workers-audit.md \
  --soft
```

`audit` 会发现根目录下的 `worker-*` 项目，执行与 `validate` 相同的项目/schema 校验，并写出 JSON/Markdown 报告。只有当你明确想校验任何包含 `main.py`、`main.js` 或 `main.go` 的目录时，才使用 `--all`。

### 本地运行

```bash
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello --json "{\"url\":\"https://example.com\"}"
node ./bin/coreclaw.js run ./examples/node-hello --input input.json
node ./bin/coreclaw.js run ./examples/node-hello --timeout-ms 10m --idle-timeout-ms 30s
node ./bin/coreclaw.js run ./examples/node-hello --min-results 1
node ./bin/coreclaw.js run ./worker --local-proxy --require-proxy-usage
```

`run` 会启动本地 CoreClaw SDK gRPC server，监听 `127.0.0.1:20086`，然后执行 worker。

`--timeout-ms` 用于限制整个 worker 进程运行时间；`--idle-timeout-ms` 用于停止已经不再输出但仍有 Node/Python/Go handle 未退出的 worker。时长支持毫秒、`s` 和 `m`。

真实 worker 冒烟测试应使用 `--min-results`。有些 worker 会在上游或浏览器失败后仍以 exit code `0` 退出，因此结果行数才是更可靠的成功门槛。

每次运行都会得到独立临时目录 `.coreclaw/runs/<run-id>/tmp`。Node.js worker 还会默认预加载一个本地 hook，把绝对路径 `/tmp/...` 文件操作映射到该运行目录，避免宿主机旧 `/tmp` 状态影响重复运行。

如果 `http://127.0.0.1:9222/json/version` 可访问，CLI 会自动发现本地 Chrome browser WebSocket 路径并注入：

- `ChromeWs=127.0.0.1:9222/devtools/browser/<id>`
- `CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`
- `BROWSER_WS_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id>`

用 `--no-discover-chrome` 可关闭自动发现。未检测到浏览器时，`ChromeWs` 回退为 `127.0.0.1:9222`，保持与 CoreClaw 文档中 host-style `ChromeWs` 一致的环境形态。

运行产物：

```text
.coreclaw/runs/<run-id>/
  input.json
  env.json
  command.json
  upload_manifest.json # staged verify 使用的上传文件清单
  logs.ndjson
  results.ndjson      # SDK push_data 原始 payload
  export.ndjson       # 按 output_schema 投影后的 CoreClaw 风格输出
  table_headers.json
  tmp/                # 每次运行独立临时状态
  summary.json
```

`summary.json` 会记录 `project_dir` 和 `worker_dir`。普通 `run` 中两者相同；staged `verify` 中，`project_dir` 是保存产物的原 worker 目录，`worker_dir` 是临时上传包视角执行目录。

### 上传前预检

```bash
node ./bin/coreclaw.js verify ./examples/node-hello --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --timeout-ms 10m --idle-timeout-ms 30s --min-results 1
node ./bin/coreclaw.js verify ./worker --input input.json --cloud-output ./cloud-output.json --min-shared 1 --max-diff 0
node ./bin/coreclaw.js verify ./worker --no-staging --no-install
node ./bin/coreclaw.js verify ./worker --no-pack
```

`verify` 是上传前门槛。它会执行静态校验，把可上传 worker 文件复制到 `.coreclaw/staging/<stage-id>/`，在 staging 目录安装依赖，从 staging 目录启动本地 CoreClaw runtime 执行 worker，校验结果行数，可选对比 CoreClaw 云端 JSON 导出，并在未传 `--no-pack` 时创建上传 ZIP。

这种默认行为能捕获只因为源目录里存在 `.coreclaw`、`node_modules`、`dist` 或其他不会上传的文件而本地跑通的假阳性。

默认情况下，运行产物仍写入原项目 `.coreclaw/runs/<run-id>/`；上传包默认写入 `.coreclaw/verify/<verify-id>/`；云端对比报告默认写入 `.coreclaw/runs/<run-id>/cloud-comparison.json`。staged preflight 还会在 run 目录写入 `upload_manifest.json`，用于审计到底哪些文件进入了上传包视角的执行目录。`--no-staging` 或 `--no-install` 只建议用于直接调试源目录行为。

### 检查运行产物

```bash
node ./bin/coreclaw.js inspect-run ./examples/node-hello/.coreclaw/runs/<run-id> --min-results 1
```

`inspect-run` 会检查 `summary.json`、`results.ndjson` 和 `export.ndjson` 的行数一致性。真实 worker 执行后应使用它，避免把“进程正常退出”误判为“产生了可用数据”。

### 模拟拆分任务

CoreClaw 的 `input_schema.b` 是任务拆分 key，必须指向一个数组 property。用 `--split <index>` 可以在本地运行一个展开后的单项任务：

```bash
node ./bin/coreclaw.js run ./examples/node-hello --split 0
```

对于 `{ "url": "https://example.com" }` 这样的 `requestList` 项，worker 会收到顶层 `url`，匹配现有 CoreClaw worker 常见的单项任务输入形态。

### 运行环境覆盖

```bash
node ./bin/coreclaw.js run ./worker \
  --proxy-auth "user:pass" \
  --proxy-domain "proxy.example:6000" \
  --chrome-ws "127.0.0.1:9222"
```

默认本地运行使用直连网络：

- 不设置 `PROXY_AUTH`
- 不设置 `PROXY_DOMAIN`
- `ChromeWs` 优先从本地 Chrome CDP 自动发现；否则为 `127.0.0.1:9222`

如需模拟 CoreClaw 的 SOCKS5 代理路径，可以启动本地代理：

```bash
node ./bin/coreclaw.js run ./worker --local-proxy
node ./bin/coreclaw.js verify ./worker --local-proxy --require-proxy-usage
```

`--local-proxy` 会在 `127.0.0.1:<port>` 启动带认证的 SOCKS5 代理，并注入匹配的 `PROXY_AUTH` / `PROXY_DOMAIN`。`--require-proxy-usage` 也会启用该代理，并在 worker 从未发起 SOCKS5 CONNECT 时让 run 失败。HTTP 请求型 worker 应使用这个门槛，避免代码只是因为本机直连网络而跑通。

如需模拟 CoreClaw 云端代理变量但没有真实代理，可以显式使用：

```bash
node ./bin/coreclaw.js run ./worker --cloud-proxy
```

cloud proxy mode 会暴露本地占位变量：

- `PROXY_AUTH=coreclaw-local:coreclaw-local`
- `PROXY_DOMAIN=127.0.0.1:6000`

### 打包上传

```bash
node ./bin/coreclaw.js pack ./examples/node-hello --output ./dist/node-hello.zip
```

ZIP 会把 worker 入口文件放在 archive root，并排除 `.coreclaw`、`node_modules`、virtualenv、构建产物、缓存和 git metadata。

## 云端输出对比

当你有 CoreClaw 云端 run 导出的 JSON，可以把它和本地 run 捕获的结果对比：

```bash
node ./bin/coreclaw.js compare \
  E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  E:/worker/worker-username-finder/.coreclaw/runs/<run-id> \
  --output ./tmp/username-finder-comparison.json \
  --min-shared 1
```

该命令会对比行数、shared keys、cloud-only rows、local-only rows 和 value differences。本地路径可以是 run 目录、`export.ndjson` 或 `results.ndjson`。默认 key 不够具体时可使用 `--key-fields username,site,urlUser`。需要严格云端一致性时可使用 `--min-shared`、`--max-diff`、`--max-only-local`、`--max-only-cloud` 作为 CI gate。

也可以把对比合并进上传前预检：

```bash
node ./bin/coreclaw.js verify ./worker \
  --input input.json \
  --cloud-output E:/worker/coreclaw_UsernameFinder_v1.0.2_20260601.json \
  --compare-output ./tmp/username-finder-comparison.json \
  --key-fields username,site,urlUser \
  --min-shared 1 \
  --max-diff 0
```

网络较重的 worker 如果本地机器没有等价的 CoreClaw 代理/浏览器基础设施，输出可能与云端不同。此时应记录差异，而不是直接把行数漂移视为 CLI runtime 失败。

## 开发

本地验证 gate、runtime 兼容规则和真实 worker smoke matrix 见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 本机验证记录

当前 Windows 机器上已验证：

```bash
node ./bin/coreclaw.js validate ./examples/node-hello
node ./bin/coreclaw.js run ./examples/node-hello
node ./bin/coreclaw.js validate ./examples/python-hello
node ./bin/coreclaw.js run ./examples/python-hello --command "py -3 main.py"
```

真实 worker 开发期间 smoke run：

```bash
# Node.js，无浏览器依赖
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-dedup-datasets --input %TEMP%/coreclaw-dedup-smoke-input.json --timeout-ms 30s --idle-timeout-ms 10s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-dedup-datasets/.coreclaw/runs/<run-id> --min-results 2

# Python，显式解释器
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-yfinance --input %TEMP%/coreclaw-yfinance-smoke-input.json --command "py -3 main.py" --timeout-ms 60s --idle-timeout-ms 20s --min-results 1

# Go，浏览器/CDP worker
node E:/worker/coreclaw-cli/bin/coreclaw.js run E:/worker/worker-google-maps-scraper --input %TEMP%/coreclaw-google-maps-smoke-input.json --chrome-ws 127.0.0.1:9222/devtools/browser/<id> --timeout-ms 90s --idle-timeout-ms 30s
node E:/worker/coreclaw-cli/bin/coreclaw.js inspect-run E:/worker/worker-google-maps-scraper/.coreclaw/runs/<run-id> --min-results 1
```

## 使用的官方文档契约

实现依据本地官方文档：

- `E:\worker\knowledge-files\docs\developer-guide\develop-worker\quick-start.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\project-structure.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\sdk-modules.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\input-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\output-schema.md`
- `E:\worker\knowledge-files\docs\developer-guide\builds-and-runs.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\proxy-support.md`
- `E:\worker\knowledge-files\docs\developer-guide\worker-definition\platform-features\browser-fingerprinting.md`
