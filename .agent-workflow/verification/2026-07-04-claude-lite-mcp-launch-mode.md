# 真实验证记录

## 验证对象
Claude 启动模式优化：默认轻量启动写入空 MCP 配置并追加 `--strict-mcp-config`，完整模式保持 Claude CLI 原有 MCP 加载行为。

## 验证环境
本地 macOS 开发环境：`/Users/peyoba/Desktop/web/AgentDock`

## 使用的真实依赖
- 本机 Claude CLI：`/opt/homebrew/bin/claude`
- 本地 npm / TypeScript / Vite / Vitest / pytest

## 验证步骤
1. 使用单元测试验证 Claude lite/full 两种启动命令。
2. 使用 renderer 测试验证启动栏默认轻量模式，以及用户选择完整模式后 IPC 请求携带 `claudeLaunchMode: 'full'`。
3. 使用本机 Claude CLI help 验证 `--mcp-config` 和 `--strict-mcp-config` 参数存在。
4. 运行项目要求的工作流、类型检查和构建命令。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| 应用测试 | `npm run test` | PASS：27 files / 138 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS |
| 工作流测试 | `npm run test:workflow` | PASS：8 passed |
| Typecheck | `npm run typecheck` | PASS |
| 构建 | `npm run build` | PASS：存在 Vite chunk size warning，非失败 |
| 真实依赖验证 | `command -v claude` | PASS：`/opt/homebrew/bin/claude` |
| 真实依赖验证 | `claude --help \| rg -- "--mcp-config\|--strict-mcp-config"` | PASS：两个参数均存在 |
| Diff 检查 | `git diff --check` | PASS |
| 敏感信息扫描 | `rg` 扫描本次变更文件的 key/token 模式 | PASS：仅命中环境变量名和测试假值，无真实 key |

## 实际结果
- Claude 默认启动模式为轻量模式，启动请求携带 `claudeLaunchMode: 'lite'`。
- 轻量模式会生成空 MCP 配置 `{ "mcpServers": {} }`，并将 Claude 命令扩展为 `--mcp-config <empty.json> --strict-mcp-config`。
- 完整模式不会追加 strict MCP 参数，保持 Claude CLI 自己加载 MCP 配置。
- 用户要求保留的默认模型、`context-1m` beta、重试配置没有修改。

## 未验证项
- 未启动真实 Claude API 会话，也未发起模型请求；原因是本次目标是降低默认启动前请求重量，真实外部调用可能再次触发上游 429。已用本机 CLI help 和自动化测试覆盖启动参数行为。

## 结论
PASS

## 发现的问题
无。

## 后续动作
进入 `delivery_hook`，输出交付报告。
