# 长期会话库与终端优先布局最终验证

## 验证对象
AgentDock 长期会话库、终端优先布局、只读项目面板、verified-native-first 恢复语义与 macOS 本机包。

## 验证环境
本机 macOS，主 worktree：`/Users/peyoba/Desktop/web/AgentDock`，branch `main`。

## 使用的真实依赖
- 本机 npm / Vite / TypeScript / Vitest。
- 本机 Claude CLI：`2.1.201 (Claude Code)`。
- 本机 Codex CLI：`codex-cli 0.142.5`。
- Electron macOS package 脚本与本机 `AgentDock Codesign` 签名身份。

## 验证步骤
1. 复核 Codex native resume：`codex exec --json` 首启捕获 `thread_id`，再用 `codex exec resume --json <thread_id>` 续接。
2. 复核 Claude native resume 能力：检查 `--session-id` / `--resume`，尝试真实 `--session-id` 非交互 smoke。
3. 复核终端优先布局：CSS 硬约束、App/TerminalPane 测试、Batch 4/5/6 集成测试。
4. 运行 workflow、测试、typecheck、build、diff check、secret-like scan。
5. 运行 macOS package 并做 codesign deep/strict 验证。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| workflow doctor | `npm run workflow:doctor` | PASS |
| workflow tests | `npm run test:workflow` | PASS：8 passed |
| 全量测试 | `npm test` | PASS：46 files / 295 tests |
| Typecheck | `npm run typecheck` | PASS |
| Build | `npm run build` | PASS；仅 Vite chunk size warning |
| Diff whitespace | `git diff --check` | PASS |
| Secret-like scan | `rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|PRIVATE) KEY" src tests docs .agent-workflow || true` | PASS：无命中 |
| Codex native resume | `codex exec --json ...` / `codex exec resume --json 019f3e97-8ac4-7062-857c-4688533c5bbe ...` | PASS：首启输出 `thread_id`，续接同一 id 返回 `CODEX_SMOKE_BRAVO_20260708` |
| Claude native resume | `claude --help` / `claude --session-id ... -p ...` | PARTIAL：help 暴露 `--session-id` / `--resume`；真实 smoke 因本机认证返回 `Invalid API key · Please run /login`，未标 verified |
| 终端列宽约束 | `src/renderer/styles.css` 中 `--terminal-min-columns: 100`、右侧 rail 默认收起、展开时 `minmax(var(--terminal-min-width), 1fr)`；Batch 4/App/TerminalPane 测试 | PASS：自动证据通过；未做人工视觉验收 |
| 只读项目面板 | `workspaceFiles:listDirectory` IPC、`workspaceFileTreeService`、`ProjectPanel`、Batch 5 测试 | PASS：只返回 metadata，不返回文件正文/完整 diff |
| macOS package | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260708-060114/AgentDock-darwin-arm64/AgentDock.app` |
| codesign | `codesign --verify --deep --strict --verbose=2 release/packages/20260708-060114/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk，satisfies Designated Requirement |

## 实际结果
- Batch 0-6 已完成并分批提交。
- 左侧长期会话库已替代顶部标签作为主会话入口，支持 workspace 分组、搜索、归档过滤和会话操作菜单。
- Session Record / Open View / PTY Process 已拆分：关闭视图不删除历史；停止 PTY 为 `stopped`；自然退出为 `exited`；窗口销毁/重启恢复为 `interrupted`；删除记录为显式危险操作。
- 右侧项目面板默认收起，展开后为只读文件树和折叠信息区；文件树有 workspace 边界校验、git 状态、本会话变化标记和 diff stat 数字。
- 恢复语义为 verified-native-first：Codex 当前可 verified native resume；Claude 当前保持 partial，走 AgentDock restore context fallback。
- Renderer/preload/IPC 边界未返回完整 API Key、完整 env、完整 restore context、未脱敏 summary 输入、文件正文或完整 diff。
- macOS app 包和 codesign 验证通过。

## 未验证项
- 未启动 Electron 图形窗口做人工拖拽和截图验收；右侧项目面板、信息区拖拽和终端列宽目前由 CSS 约束、组件测试与打包验证覆盖。
- Claude native resume 真实模型续接未验证，原因是本机 Claude CLI 认证失败；当前产品行为按 partial 降级到 AgentDock restore context fallback。
- 未做 notarization；本次要求覆盖本机 package 与 codesign。

## 结论
PASS，有条件说明：Claude native resume 不标 verified；人工视觉验收未执行但自动验证和 package/codesign 通过。

## 发现的问题
- `claude --safe-mode` 在 help 中出现，但本机实际解析返回 `unknown option '--safe-mode'`，不应作为 AgentDock 探针的稳定依据。
- Claude CLI 当前认证状态不可用，不能完成真实 resume marker 验证。

## 后续动作
进入 delivery hook，提交最终验证记录、交付报告和 workflow state。
