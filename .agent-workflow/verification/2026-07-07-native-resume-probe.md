# Native Resume 探针验证

## 结论

PARTIAL PASS。

- Claude：CLI capability 已确认，但当前本机 direct CLI 未登录；使用 AgentDock `claude-custom-5` profile 注入环境后，普通 `--print` 与 `--session-id` smoke 均超时无输出。结论为 `nativeResume=partial`，后续不得默认启用 verified native resume，必须继续使用 AgentDock restore context fallback，直到 profile 路径真机恢复 smoke 通过。
- Codex：`codex exec --json` 可稳定输出 `thread_id`，同一 `CODEX_HOME` 下 `codex exec ... resume --json <thread_id>` 可恢复上一轮上下文。结论为 `nativeResume=verified`，首版可将 JSONL `thread.started.thread_id` 作为 Codex native resume id 来源。

## 单元测试

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/app/nativeResumeProbe.test.ts` | PASS：1 file / 4 tests |

## Claude

| 项目 | 结果 |
|------|------|
| CLI version | `2.1.201 (Claude Code)` |
| Help capability | `--session-id <uuid>` 与 `--resume [value]` 均存在 |
| Direct CLI smoke | FAIL：`claude --session-id <uuid> --print ...` 返回 `Not logged in · Please run /login` |
| AgentDock profile smoke | TIMEOUT：`claude-custom-5` 注入 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 后，普通 `--print` 与 `--session-id` smoke 均超过 60-90 秒无输出，已中断 |
| Decision | `nativeResume=partial` |

备注：Claude capability parser 可以识别 `<uuid>`、`<id>`、`<session>` 等 help 参数标签，不会因 help 文案占位符变化误判。

## Codex

| 项目 | 结果 |
|------|------|
| CLI version | `codex-cli 0.142.5` |
| Help capability | `codex resume [SESSION_ID]` 与 `codex exec resume [SESSION_ID]` 存在；未发现首启指定 session id 参数 |
| First run | PASS：临时 `CODEX_HOME` + `codex-openai` profile，`codex exec --json ...` exit 0 |
| Captured id | PASS：JSONL 第一行 `{"type":"thread.started","thread_id":"019f3d38-8102-77a2-9cd1-afad7eb4d368"}` |
| Resume by id | PASS：`codex exec --sandbox read-only --skip-git-repo-check --color never resume --json <thread_id> ...` exit 0 |
| Resume output | PASS：last message 为 `AGENTDOCK_CODEX_RESUME_PROBE_ONE` |
| Decision | `nativeResume=verified` |

## 关键实现约束

- Codex `resume` 的工作命令需要把 `--sandbox` / `--skip-git-repo-check` / `--color` 放在 `resume` 前面：`codex exec --sandbox read-only --skip-git-repo-check --color never resume --json <thread_id> <prompt>`。
- `codex exec resume --json --sandbox ...` 和 `codex exec resume --json --cd ...` 在当前 CLI 中会报 `unexpected argument`，不能照 help 文本直接拼接。
- Claude 后续实现只能保存 generated `--session-id` capability metadata；在真实 profile resume smoke 通过前，UI 和恢复策略必须显示为 fallback/partial，不得标记为 verified native resume。
- 探针过程中未打印、写入或提交任何 API Key；secret 仅通过子进程环境变量注入 CLI。
