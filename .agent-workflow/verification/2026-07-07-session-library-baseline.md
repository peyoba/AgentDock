# 长期会话库改版 Batch 0 基线验证

## 结论

PASS，有条件进入基线确认。

当前恢复相关改动可以作为后续长期会话库重构的候选基线，但提交前必须排除两个未跟踪项：

- `index-D3wM5j2Q.js`：根目录构建产物，516KB，不应提交。
- `docs/superpowers/specs_副本/`：历史 SPEC 副本目录，不应作为本批次基线提交。

## 工作区状态

当前分支：`main`。

当前工作区包含：

- 恢复相关已跟踪改动：`src/main/sessionService.ts`、`src/main/stores/sessionHistoryStore.ts`、`src/renderer/App.tsx`、`src/renderer/components/TerminalPane.tsx`、`src/renderer/terminalOutput.ts`、`src/shared/agentdockTypes.ts`、相关测试和文档。
- 新增恢复相关源码：`src/main/contextRestore.ts`、`src/main/restoreContextStore.ts`、`src/main/stores/sessionTranscriptStore.ts`、`src/main/summaryContinuation.ts`、`src/main/terminalOutputSanitizer.ts`、`src/shared/terminalText.ts`。
- 新增测试：`tests/app/contextRestore.test.ts`、`tests/app/restoreContextStore.test.ts`、`tests/app/sessionTranscriptStore.test.ts`、`tests/app/summaryContinuation.test.ts`、`tests/app/terminalOutputSanitizer.test.ts`。
- 新增本次长期会话库 SPEC 与实施计划。
- 新增 UI reference mockup HTML/PNG。

## Diff 审阅结果

已检查关键 diff：

- `src/main/sessionService.ts`：restore context 短指令、Claude `--append-system-prompt`、Codex 初始 prompt、恢复状态记录、持久化输出脱敏。
- `src/main/stores/sessionHistoryStore.ts`：per-session transcript 文件、旧 `terminalBuffer` 迁移、坏 JSON 备份恢复、50 session / 1GB cleanup。
- `src/renderer/App.tsx`：移除 5MB bar、恢复状态、summary/continue 入口、重启即时状态。
- `src/renderer/components/TerminalPane.tsx`：运行中 agent 输出过滤、OSC query guard、只读历史文本化、右键复制/粘贴和跳转按钮。
- `src/renderer/terminalOutput.ts` / `src/shared/terminalText.ts` / `src/main/terminalOutputSanitizer.ts`：TUI 控制序列和 OSC color reply 过滤。

未发现新增 `console.log`、`debugger`、临时日志或明显 WIP 调试代码。扫描命中项均为历史文档中的命令文本、测试假 key 或测试断言。

## 安全扫描

命令：

```bash
rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|OPENAI_API_KEY=|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=" index-D3wM5j2Q.js src/main src/renderer src/shared tests/app .agent-workflow docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md
rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|OPENAI_API_KEY=|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=" src/main src/renderer src/shared
```

结果：

- 源码限定扫描无命中。
- 广域扫描命中测试假 key、redaction 测试和历史验证命令文本，未发现真实 API Key、token 或 private key。

## 验证命令

| 命令 | 结果 |
|------|------|
| `git status --short` | PASS：已列出 dirty worktree；存在两个不应提交的未跟踪项 |
| `git diff --stat` | PASS：已跟踪 diff 25 files，约 1856 insertions / 304 deletions |
| `git diff --check` | PASS：无空白错误 |
| `npm run workflow:doctor` | PASS |
| `npm run test:workflow` | PASS：8 passed |
| `npm run typecheck` | PASS |
| `npm test` | PASS：42 files / 271 tests |
| `npm run build` | PASS：仅 Vite chunk size warning |

## 建议提交范围

如果用户确认提交基线，建议选择性 stage：

```bash
git add .agent-workflow README.md CLAUDE.md \
  docs/requirements \
  docs/superpowers/specs/2026-07-07-agentdock-session-library-terminal-first-ui-design.zh-CN.md \
  docs/superpowers/plans/2026-07-07-agentdock-session-library-terminal-first-ui.md \
  docs/assets/ui-references/agentdock-session-library-file-tree-mockup.html \
  docs/assets/ui-references/agentdock-session-library-file-tree-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-alt-mockup.html \
  docs/assets/ui-references/agentdock-terminal-first-alt-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-expanded-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-rail-mockup.png \
  docs/assets/ui-references/agentdock-terminal-first-v2-default.html \
  docs/assets/ui-references/agentdock-terminal-first-v2-default.png \
  docs/assets/ui-references/agentdock-terminal-first-v2-expanded.html \
  docs/assets/ui-references/agentdock-terminal-first-v2-expanded.png \
  src tests
```

不要 stage：

```text
index-D3wM5j2Q.js
docs/superpowers/specs_副本/
```

建议提交信息：

```bash
git commit -m "chore: stabilize session restore baseline"
```

## 下一步

等待用户确认是否按上述范围提交 Batch 0 基线。确认前不进入 Batch 1，也不修改应用源码。
