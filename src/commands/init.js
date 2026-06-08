import fs from 'node:fs';
import path from 'node:path';
import { defaultsFromInputSchema } from '../runtime/input.js';
import { CliError } from '../utils/errors.js';
import { repoRoot } from '../utils/paths.js';

const SUPPORTED_LANGUAGES = new Set(['python', 'node', 'go']);

const GO_SUM = [
  'github.com/go-logr/logr v1.4.3 h1:CjnDlHq8ikf6E492q6eKboGOC0T8CDaOvkHCIg8idEI=',
  'github.com/go-logr/logr v1.4.3/go.mod h1:9T104GzyrTigFIr8wt5mBrctHMim0Nb2HLGrmQ40KvY=',
  'github.com/go-logr/stdr v1.2.2 h1:hSWxHoqTgW2S2qGc0LTAI563KZ5YKYRhT3MFKZMbjag=',
  'github.com/go-logr/stdr v1.2.2/go.mod h1:mMo/vtBO5dYbehREoey6XUKy/eSumjCCveDpRre4VKE=',
  'github.com/golang/protobuf v1.5.4 h1:i7eJL8qZTpSEXOPTxNKhASYpMn+8e5Q6AdndVa1dWek=',
  'github.com/golang/protobuf v1.5.4/go.mod h1:lnTiLA8Wa4RWRcIUkrtSVa5nRhsEGBg48fD6rSs7xps=',
  'github.com/google/go-cmp v0.7.0 h1:wk8382ETsv4JYUZwIsn6YpYiWiBsYLSJiTsyBybVuN8=',
  'github.com/google/go-cmp v0.7.0/go.mod h1:pXiqmnSA92OHEEa9HXL2W4E7lf9JzCmGVUdgjX3N/iU=',
  'github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=',
  'github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=',
  'go.opentelemetry.io/auto/sdk v1.2.1 h1:jXsnJ4Lmnqd11kwkBV2LgLoFMZKizbCi5fNZ/ipaZ64=',
  'go.opentelemetry.io/auto/sdk v1.2.1/go.mod h1:KRTj+aOaElaLi+wW1kO/DZRXwkF4C5xPbEe3ZiIhN7Y=',
  'go.opentelemetry.io/otel v1.38.0 h1:RkfdswUDRimDg0m2Az18RKOsnI8UDzppJAtj01/Ymk8=',
  'go.opentelemetry.io/otel v1.38.0/go.mod h1:zcmtmQ1+YmQM9wrNsTGV/q/uyusom3P8RxwExxkZhjM=',
  'go.opentelemetry.io/otel/metric v1.38.0 h1:Kl6lzIYGAh5M159u9NgiRkmoMKjvbsKtYRwgfrA6WpA=',
  'go.opentelemetry.io/otel/metric v1.38.0/go.mod h1:kB5n/QoRM8YwmUahxvI3bO34eVtQf2i4utNVLr9gEmI=',
  'go.opentelemetry.io/otel/sdk v1.38.0 h1:l48sr5YbNf2hpCUj/FoGhW9yDkl+Ma+LrVl8qaM5b+E=',
  'go.opentelemetry.io/otel/sdk v1.38.0/go.mod h1:ghmNdGlVemJI3+ZB5iDEuk4bWA3GkTpW+DOoZMYBVVg=',
  'go.opentelemetry.io/otel/sdk/metric v1.38.0 h1:aSH66iL0aZqo//xXzQLYozmWrXxyFkBJ6qT5wthqPoM=',
  'go.opentelemetry.io/otel/sdk/metric v1.38.0/go.mod h1:dg9PBnW9XdQ1Hd6ZnRz689CbtrUp0wMMs9iPcgT9EZA=',
  'go.opentelemetry.io/otel/trace v1.38.0 h1:Fxk5bKrDZJUH+AMyyIXGcFAPah0oRcT+LuNtJrmcNLE=',
  'go.opentelemetry.io/otel/trace v1.38.0/go.mod h1:j1P9ivuFsTceSWe1oY+EeW3sc+Pp42sO++GHkg4wwhs=',
  'golang.org/x/net v0.47.0 h1:Mx+4dIFzqraBXUugkia1OOvlD6LemFo1ALMHjrXDOhY=',
  'golang.org/x/net v0.47.0/go.mod h1:/jNxtkgq5yWUGYkaZGqo27cfGZ1c5Nen03aYrrKpVRU=',
  'golang.org/x/sys v0.38.0 h1:3yZWxaJjBmCWXqhN1qh02AkOnCQ1poK6oF+a7xWL6Gc=',
  'golang.org/x/sys v0.38.0/go.mod h1:OgkHotnGiDImocRcuBABYBEXf8A9a87e/uXjp9XT3ks=',
  'golang.org/x/text v0.31.0 h1:aC8ghyu4JhP8VojJ2lEHBnochRno1sgL6nEi9WGFGMM=',
  'golang.org/x/text v0.31.0/go.mod h1:tKRAlv61yKIjGGHX/4tP1LTbc13YSec1pxVEWXzfoeM=',
  'gonum.org/v1/gonum v0.16.0 h1:5+ul4Swaf3ESvrOnidPp4GZbzf0mxVQpDCYUQE7OJfk=',
  'gonum.org/v1/gonum v0.16.0/go.mod h1:fef3am4MQ93R2HHpKnLk4/Tbh/s0+wqD5nfa6Pnwy4E=',
  'google.golang.org/genproto/googleapis/rpc v0.0.0-20251029180050-ab9386a59fda h1:i/Q+bfisr7gq6feoJnS/DlpdwEL4ihp41fvRiM3Ork0=',
  'google.golang.org/genproto/googleapis/rpc v0.0.0-20251029180050-ab9386a59fda/go.mod h1:7i2o+ce6H/6BluujYR+kqX3GKH+dChPTQU19wjRPiGk=',
  'google.golang.org/grpc v1.78.0 h1:K1XZG/yGDJnzMdd/uZHAkVqJE+xIDOcmdSFZkBUicNc=',
  'google.golang.org/grpc v1.78.0/go.mod h1:I47qjTo4OKbMkjA/aOOwxDIiPSBofUtQUI5EfpWvW7U=',
  'google.golang.org/protobuf v1.36.11 h1:fV6ZwhNocDyBLK0dj+fg8ektcVegBBuEolpbTQyBNVE=',
  'google.golang.org/protobuf v1.36.11/go.mod h1:HTf+CrKn2C3g5S8VImy6tdcUvCska2kB7j23XfzDpco=',
];

export async function initCommand(target = '.', options = {}) {
  const language = normalizeLanguage(options.language ?? options.lang ?? 'python');
  const projectDir = path.resolve(process.cwd(), target);

  if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length > 0 && !options.force) {
    throw new CliError(`Target directory is not empty: ${projectDir}. Use --force to write into it.`);
  }

  fs.mkdirSync(projectDir, { recursive: true });
  copyTemplateSdk(language, projectDir);
  writeTemplateProject(language, projectDir, options.name ?? path.basename(projectDir), options);

  console.log(`Created ${language} CoreClaw worker: ${projectDir}`);
  console.log(`Next: coreclaw run ${projectDir}`);
  return projectDir;
}

function normalizeLanguage(language) {
  const value = String(language).toLowerCase();
  if (value === 'js' || value === 'javascript' || value === 'nodejs') {
    return 'node';
  }
  if (!SUPPORTED_LANGUAGES.has(value)) {
    throw new CliError(`Unsupported language "${language}". Use python, node, or go.`);
  }
  return value;
}

function copyTemplateSdk(language, projectDir) {
  const sourceDir = path.join(repoRoot, 'templates', language);
  copyDir(sourceDir, projectDir);
}

function copyDir(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDir(source, target);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

function writeTemplateProject(language, projectDir, name, options = {}) {
  const inputSchema = {
    description: `${name} CoreClaw worker`,
    b: 'startUrls',
    properties: [
      {
        title: 'Start URLs',
        name: 'startUrls',
        type: 'array',
        editor: 'requestList',
        description: 'URLs to process.',
        default: [{ url: 'https://example.com' }],
        required: true,
      },
    ],
  };

  writeJson(path.join(projectDir, 'input_schema.json'), inputSchema);
  if (options.inputExample !== false) {
    writeJson(path.join(projectDir, 'input.example.json'), defaultsFromInputSchema(inputSchema));
  }

  writeJson(path.join(projectDir, 'output_schema.json'), [
    { name: 'url', type: 'string', description: 'URL' },
    { name: 'status', type: 'string', description: 'Status' },
    { name: 'title', type: 'string', description: 'Title' },
  ]);

  if (language === 'python') {
    writeIfMissing(path.join(projectDir, 'requirements.txt'), 'grpcio>=1.80.0\nprotobuf>=6.31.1\n');
    writeIfMissing(path.join(projectDir, 'README.md'), readme(name, 'python'));
    writeIfMissing(path.join(projectDir, 'main.py'), pythonMain());
  } else if (language === 'node') {
    writeJson(path.join(projectDir, 'package.json'), {
      name: slugify(name),
      version: '0.1.0',
      private: true,
      main: 'main.js',
      type: 'commonjs',
      scripts: { start: 'node main.js' },
      dependencies: {
        '@grpc/grpc-js': '^1.14.3',
        'google-protobuf': '^4.0.2',
      },
    });
    writeIfMissing(path.join(projectDir, 'README.md'), readme(name, 'node'));
    writeIfMissing(path.join(projectDir, 'main.js'), nodeMain());
  } else if (language === 'go') {
    const moduleName = slugify(name);
    writeIfMissing(path.join(projectDir, 'go.mod'), goMod(moduleName));
    writeIfMissing(path.join(projectDir, 'go.sum'), goSum());
    writeIfMissing(path.join(projectDir, 'README.md'), readme(name, 'go'));
    writeIfMissing(path.join(projectDir, 'main.go'), goMain(moduleName));
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function slugify(value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'coreclaw-worker';
}

function readme(name, language) {
  return `# ${name}\n\nGenerated by CoreClaw CLI.\n\n## Local Run\n\n\`\`\`bash\ncoreclaw run .\n\`\`\`\n\n## Upload Package\n\n\`\`\`bash\ncoreclaw pack .\n\`\`\`\n\nLanguage: ${language}\n`;
}

function pythonMain() {
  return `#!/usr/bin/env python3\nimport asyncio\nfrom sdk import CoreSDK\n\n\nasync def run():\n    input_json = CoreSDK.Parameter.get_input_json_dict()\n    url = input_json.get("url") or (input_json.get("startUrls", [{}])[0].get("url") if input_json.get("startUrls") else "")\n\n    CoreSDK.Result.set_table_header([\n        {"label": "URL", "key": "url", "format": "text"},\n        {"label": "Status", "key": "status", "format": "text"},\n        {"label": "Title", "key": "title", "format": "text"},\n    ])\n    CoreSDK.Log.info(f"Processing {url}")\n    CoreSDK.Result.push_data({"url": url, "status": "success", "title": "Example Domain"})\n\n\nif __name__ == "__main__":\n    asyncio.run(run())\n`;
}

function nodeMain() {
  return `const coresdk = require('./sdk')\n\nasync function main() {\n  const input = await coresdk.parameter.getInputJSONObject()\n  const url = input.url || (Array.isArray(input.startUrls) && input.startUrls[0] ? input.startUrls[0].url : '')\n\n  await coresdk.result.setTableHeader([\n    { label: 'URL', key: 'url', format: 'text' },\n    { label: 'Status', key: 'status', format: 'text' },\n    { label: 'Title', key: 'title', format: 'text' },\n  ])\n  await coresdk.log.info(\`Processing \${url}\`)\n  await coresdk.result.pushData({ url, status: 'success', title: 'Example Domain' })\n}\n\nmain().catch(async (error) => {\n  try { await coresdk.log.error(error.stack || error.message) } catch {}\n  process.exitCode = 1\n})\n`;
}

function goMod(moduleName) {
  return `module ${moduleName}\n\ngo 1.24.6\n\nrequire (\n\tgoogle.golang.org/grpc v1.78.0\n\tgoogle.golang.org/protobuf v1.36.11\n)\n\nrequire (\n\tgolang.org/x/net v0.47.0 // indirect\n\tgolang.org/x/sys v0.38.0 // indirect\n\tgolang.org/x/text v0.31.0 // indirect\n\tgoogle.golang.org/genproto/googleapis/rpc v0.0.0-20251029180050-ab9386a59fda // indirect\n)\n`;
}

function goSum() {
  return `${GO_SUM.join('\n')}\n`;
}

function goMain(moduleName) {
  return `package main\n\nimport (\n\t"context"\n\t"encoding/json"\n\t"fmt"\n\n\tcoresdk "${moduleName}/GoSdk"\n)\n\nfunc main() {\n\tctx := context.Background()\n\tinputJSON, err := coresdk.Parameter.GetInputJSONString(ctx)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tvar input map[string]interface{}\n\t_ = json.Unmarshal([]byte(inputJSON), &input)\n\n\turl := ""\n\tif startUrls, ok := input["startUrls"].([]interface{}); ok && len(startUrls) > 0 {\n\t\tif first, ok := startUrls[0].(map[string]interface{}); ok {\n\t\t\turl, _ = first["url"].(string)\n\t\t}\n\t}\n\tif singleURL, ok := input["url"].(string); ok && singleURL != "" {\n\t\turl = singleURL\n\t}\n\n\t_, _ = coresdk.Result.SetTableHeader(ctx, []*coresdk.TableHeaderItem{\n\t\t{Label: "URL", Key: "url", Format: "text"},\n\t\t{Label: "Status", Key: "status", Format: "text"},\n\t\t{Label: "Title", Key: "title", Format: "text"},\n\t})\n\t_, _ = coresdk.Log.Info(ctx, fmt.Sprintf("Processing %s", url))\n\t_, _ = coresdk.Result.PushData(ctx, map[string]any{"url": url, "status": "success", "title": "Example Domain"})\n}\n`;
}
