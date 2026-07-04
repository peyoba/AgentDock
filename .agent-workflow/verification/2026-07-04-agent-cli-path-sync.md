# 真实验证记录

## 验证对象
AgentDock PTY 启动环境中的 Agent CLI PATH 解析顺序。

## 验证环境
本地 macOS，AgentDock Electron main build，真实 `node-pty`，本机已安装两个 Claude CLI：

- `/opt/homebrew/bin/claude` -> `2.0.36`
- `/Users/peyoba/.local/bin/claude` -> `2.1.201`

## 使用的真实依赖
- 真实 `node-pty`
- 本机 `zsh`
- 本机 Claude CLI binary
- macOS app 打包产物

## 验证步骤
1. 写入 PATH 顺序回归测试，确认旧实现下用户级 CLI 目录排在 Homebrew 后面时失败。
2. 调整 PTY adapter：用户 CLI 目录优先，并在 login shell 命令执行前重新 `export PATH`。
3. 运行应用测试、workflow doctor、typecheck、build。
4. 使用 build 后的 `dist/main/adapters/ptyAdapter.js` 通过真实 `node-pty` 启动一次性 shell，检查 `command -v claude` 和 `claude --version`。
5. 打包 macOS App，校验 codesign，并解包 app.asar 确认编译后的 PTY adapter 包含 PATH 修复逻辑。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED 测试 | `npm run test -- tests/app/ptyAdapter.test.ts` | PASS：新增测试先失败，错误显示 `~/.local/bin` 索引 3、Homebrew 索引 0 |
| 相关测试 | `npm run test -- tests/app/ptyAdapter.test.ts` | PASS：1 file / 8 tests |
| 全量测试 | `npm run test` | PASS：30 files / 159 tests |
| Workflow doctor | `npm run workflow:doctor` | PASS |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| 真实 node-pty PATH smoke | build 后 `createNodePtyAdapter()` 启动 `command -v claude; claude --version` | PASS：输出 `/Users/peyoba/.local/bin/claude` 和 `2.1.201 (Claude Code)` |
| macOS package | `npm run package:mac` | PASS：`release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-193715/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内代码检查 | `npx asar extract ... /tmp/agentdock-asar-check && rg "export PATH|\\.local|\\.npm-global" /tmp/agentdock-asar-check/dist/main/adapters/ptyAdapter.js` | PASS：包内包含 `.local`、`.npm-global` 和 `export PATH` |

## 实际结果
AgentDock PTY adapter 现在会把 `~/.local/bin`、`~/.npm-global/bin`、`~/.claude/bin` 等用户级 CLI 路径放在继承 PATH 和 Homebrew 路径之前，并在 `zsh -lc` 执行命令前重新导出合成后的 PATH。真实 PTY smoke 已确认 `claude` 解析到 `/Users/peyoba/.local/bin/claude`，版本为 `2.1.201`。

## 未验证项
- 未启动 GUI 手动点击 Claude profile 发起真实 Claude 请求；本次变更只影响 CLI binary 解析路径，未触碰 endpoint/API key 注入逻辑。

## 结论
PASS

## 发现的问题
旧实现只调整 PTY env 的 PATH，但 `zsh -lc` 的登录配置可能再次覆盖 PATH，因此需要在命令执行前显式 `export PATH`。

## 后续动作
进入 delivery_hook，交付给用户用新包手动 smoke。
