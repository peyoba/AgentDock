# 会话 Transcript 存储与上下文恢复交付报告

## 任务

按中文 SPEC `docs/superpowers/specs/2026-07-06-session-transcript-storage-context-restore-design.zh-CN.md` 实现：

- 移除底部 5MB 本地回放提示和 `新开会话` / `存档历史` 动作。
- 将终端输出从 `sessions.json` 迁移到 per-session transcript 文件。
- UI 和恢复读取有边界 transcript tail。
- 恢复/重启 agent session 时注入 summary/近期 transcript tail 组成的 restore prompt。
- 增加本地 session/transcript 清理策略。

## 风险等级

L3。

## 关键实现

- 新增 `src/main/stores/sessionTranscriptStore.ts` 管理 transcript append、tail read、delete。
- `sessionHistoryStore` 迁移旧 `terminalBuffer`，`sessions.json` 不再保存大段终端输出。
- 新增 `src/main/contextRestore.ts`，构建脱敏 restore prompt。
- `SessionService.restart` 对 Claude/Codex agent session 注入 restore prompt。
- Renderer 移除 `SessionHistoryLimitBar` 和底部 5MB 存储提示。

## 验证

验证记录见：

`.agent-workflow/verification/2026-07-06-session-transcript-storage-context-restore.md`

最终包：

`release/packages/20260706-221852/AgentDock-darwin-arm64/AgentDock.app`

## 未验证项

未执行真实 Claude/Codex API 请求；本轮真实验证使用 node-pty + `cat` smoke 验证 PTY 注入链路，不消耗用户 API 额度。

## 结论

可交付。用户可使用最终 macOS 包进行手动验收：长输出不再出现底部 5MB warning，恢复/重启 agent session 时应能接收 AgentDock restore prompt。
