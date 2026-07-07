# Batch 6 恢复语义整合验证

## 结论

PASS。

## 范围

- `AgentSession.nativeResume` 增加 verified/partial/unavailable metadata。
- `MemoryRestoreState.method` 增加 `native` / `agentdock` / `none` 标识。
- `SessionService.restart` 在且仅在 `nativeResume.status === "verified"` 且工具类型匹配时优先使用 native resume command。
- native resume 被使用时不生成 AgentDock restore context，不注入 `--append-system-prompt` / 初始 fallback prompt。
- partial、unavailable 或缺失 native metadata 时继续使用 AgentDock restore context fallback。
- 右侧 `恢复摘要` 折叠段显示 `原生 resume` 或 `AgentDock 恢复材料`，不展示 restore context 文件路径。

## Native Resume 决策

- Codex：沿用 Batch 1 真机结论，`codex exec --json` 可稳定捕获 `thread_id`，`codex exec ... resume --json <thread_id>` 已验证。当前实现支持 verified metadata 或 explicit `resumeCommand` 优先路径。
- Claude：沿用 Batch 1 真机结论，CLI help 暴露 `--session-id`/`--resume`，但 direct/profile smoke 未通过，状态仍为 partial。当前实现不会把 Claude partial 自动标记为 verified，也不会默认启用 native resume。
- 未验证或 partial 时必须使用 AgentDock restore context fallback，UI 不伪装成 native resume。

## RED/GREEN

- `tests/app/sessionService.test.ts -t "verified native resume"`：
  - RED：verified native metadata 仍生成 AgentDock restore context，并注入 `--append-system-prompt`。
  - GREEN：verified native metadata 直接启动 `claude --resume <id>`，不生成 restore context 文件。
- `tests/app/App.test.tsx -t "native resume separately"`：
  - RED：右侧恢复摘要把 `method: native` 误标为 `AgentDock 恢复材料`。
  - GREEN：右侧恢复摘要显示 `原生 resume`，且不展示 restore context 文件路径。

## 验证命令

- `npx vitest run tests/app/sessionService.test.ts -t "verified native resume"`
  - PASS。
- `npx vitest run tests/app/App.test.tsx -t "native resume separately"`
  - PASS。
- `npx vitest run tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts tests/app/App.test.tsx tests/app/nativeResumeProbe.test.ts`
  - PASS：4 files / 105 tests passed。
- `npm run workflow:doctor`
  - PASS。
- `npm run test:workflow`
  - PASS：8 passed。
- `npm test`
  - PASS：46 files / 295 tests passed。
- `npm run typecheck`
  - PASS。
- `npm run build`
  - PASS；仅 Vite chunk size warning。
- `git diff --check`
  - PASS：无输出。
- secret-like scan：`rg -n "sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|PRIVATE) KEY" src tests docs .agent-workflow || true`
  - PASS：无命中。

## 未验证项

- 本批次未重新执行真实 Claude profile native resume smoke；沿用 Batch 1 `nativeResume=partial` 决策，不能标记为 verified。
- 最终交付前仍需做真实 Codex resume/fallback 复核和 packaged app 验证。
