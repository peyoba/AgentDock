# 真实验证记录

## 验证对象
AgentDock Batch A：Claude 模型映射、多窗口 Session 隔离、macOS 时间戳打包输出。

## 验证环境
本地 macOS，worktree：

```text
/Users/peyoba/.config/superpowers/worktrees/AgentDock/batch-a-claude-models-multiwindow-package
```

## 使用的真实依赖
- Electron packaged App：`release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app`
- 本地 `node-pty` + `zsh` PTY
- 本地 macOS `codesign`
- 本机 AgentDock Profile/Workspace metadata（未读取或输出 API Key）

## 验证步骤
1. 运行全量 app/workflow/typecheck/build/package 验证。
2. 对时间戳目录下的新 App 包执行 strict codesign verify。
3. 启动 packaged App remote debugging 实例，点击“新窗口”，确认出现两个 page target。
4. 在两个窗口中分别通过 preload API 启动本地 `zsh`，写入不同 `echo`，读取各自 terminal buffer。
5. 用编译后的 `dist/main/sessionService.js` + fake PTY/fake secret 启动 Claude settings 写入路径，检查模型映射和 secret 边界。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| App 测试 | `npm run test` | PASS：29 files / 146 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS |
| 工作流测试 | `npm run test:workflow` | PASS：8 passed |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS，仅 Vite chunk size warning |
| Package | `npm run package:mac` | PASS：输出 `release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260704-120943/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk，satisfies Designated Requirement |
| Packaged 多窗口 | CDP packaged smoke | PASS：2 个窗口 target |
| Packaged 本地 PTY 隔离 | 两个窗口分别启动 `zsh` 并写入 `agentdock-window-a` / `agentdock-window-b` | PASS：每窗口 `sessionCount=1`，各自 buffer 只含自身输出 |
| Claude settings 安全 | fake secret + fake PTY 启动 `claude` settings 写入 | PASS：model=`opus`，Thinking=true，模型映射 env 存在，`secretPresent=false` |

## 实际结果
- Claude model mapping 已进入 profile metadata、UI、launch env 和 Claude settings。
- 多窗口入口已存在：标题栏“新窗口”和 macOS 菜单 `CommandOrControl+N`。
- 每个窗口的 `SessionService` 独立；真实 packaged smoke 中两个窗口内 `session-1` 互不冲突，terminal buffer 不串窗。
- `npm run package:mac` 默认输出新时间戳目录，不再覆盖固定 `release/AgentDock-darwin-arm64/AgentDock.app`。
- 未触发真实 Claude API 请求，避免上游 429/520。

## 未验证项
- 未把本 Batch A worktree 与另一个 Agent 的 Claude lite/full MCP 改动合并；后续集成必须同时保留 `claudeLaunchMode` 与 Batch A 模型映射行为。
- 未发起真实 Claude 模型请求；本批只验证 settings/env 写入和本地 PTY 隔离。

## 结论
PASS

## 发现的问题
无阻塞问题。Vite chunk size warning 为既有构建提示，不影响构建退出码。

## 后续动作
进入 delivery_hook；合并回主工作区前进行冲突解决和二次全量验证。
