# 真实验证记录

## 验证对象
Batch A 与 Claude lite/full MCP 启动模式在主分支的集成结果：

- Claude 5 项模型映射配置。
- Claude 默认轻量 MCP 启动与完整 MCP 可选启动。
- 多窗口 SessionService 隔离。
- macOS 时间戳打包输出。

## 验证环境
本地 macOS，主工作区：

```text
/Users/peyoba/Desktop/web/AgentDock
```

## 使用的真实依赖
- Electron packaged App：`release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app`
- 本地 `node-pty` + `zsh` PTY
- 本地 macOS `codesign`
- 本机 Claude CLI：`/opt/homebrew/bin/claude`
- 本机 AgentDock Profile/Workspace metadata（未读取或输出 API Key）

## 验证步骤
1. 解决 Batch A 分支与 Claude lite/full MCP 改动的合并冲突。
2. 运行 focused tests 覆盖 SessionService、配置 UI、多窗口 preload/registry 和打包脚本。
3. 运行全量 app/workflow/typecheck/build/package 验证。
4. 对时间戳目录下的新 App 包执行 strict codesign verify。
5. 检查 Claude CLI 支持 `--mcp-config` 与 `--strict-mcp-config`。
6. 启动 packaged App remote debugging 实例，打开第二个窗口。
7. 在两个窗口中分别通过 preload API 启动本地 `zsh`，写入不同 marker，读取各自 terminal buffer。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| 冲突标记 | `rg -n "<<<<<<<|=======|>>>>>>>" . src tests || true` | PASS：无输出 |
| Focused tests | `npm run test -- tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/windowSessionRegistry.test.ts tests/app/packageMacScript.test.ts` | PASS：5 files / 54 tests |
| Typecheck | `npm run typecheck` | PASS |
| App 测试 | `npm run test` | PASS：29 files / 149 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS |
| 工作流测试 | `npm run test:workflow` | PASS：8 passed |
| Build | `npm run build` | PASS：仅 Vite chunk size warning |
| Package | `npm run package:mac` | PASS：输出 `release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-134324/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk，satisfies Designated Requirement |
| Claude CLI 参数 | `command -v claude && claude --help | rg -- "--mcp-config|--strict-mcp-config"` | PASS：本机 Claude CLI 存在并支持两个 MCP 参数 |
| Packaged 多窗口 | CDP packaged smoke | PASS：page target 从 1 个变为 2 个 |
| Packaged 本地 PTY 隔离 | 两个窗口分别启动 `zsh` 并写入 `agentdock-window-a` / `agentdock-window-b` | PASS：每窗口 `sessionCount=1`，各自 buffer 只含自身 marker |
| Diff whitespace | `git diff --check` | PASS：无输出 |
| Key/token scan | changed and untracked files key-like pattern scan | PASS：无输出 |

## 实际结果
- 合并后同时保留 `ClaudeLaunchMode = 'lite' | 'full'` 与 `ClaudeDefaultLaunchMode = 'default' | 'opus' | 'sonnet' | 'haiku' | 'custom'`。
- `SessionService` 同时保留 Claude 模型映射 settings 写入与 lite 模式空 MCP strict config 追加。
- Renderer 保留 Claude 启动模式选择，并保留 Batch A 的 Claude 模型映射配置 UI。
- 多窗口 packaged smoke 证明两个窗口内同名 `session-1` 不串 session/output。
- `npm run package:mac` 输出新时间戳目录，不覆盖固定 release App。

## 未验证项
- 未发起真实 Claude 模型请求，避免再次触发上游 429/520。
- 未验证 notarization；当前仅本地 ad-hoc signature strict verify。

## 结论
PASS

## 发现的问题
无阻塞问题。Vite chunk size warning 为既有构建提示，不影响构建退出码。

## 后续动作
进入 delivery_hook，提交 merge commit 后交付用户测试新版 App。
