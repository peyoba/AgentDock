# 真实验证记录

## 验证对象
AgentDock 高优先级审查问题修复：Claude lite 模式在续开/恢复/重启路径保留、Claude summary runner lite 隔离、总结操作展示范围、Keychain/vault 文档口径。

## 验证环境
本地 macOS，Electron + React + TypeScript，Vitest，真实本机 Claude/Codex CLI help 检查和 summary runner smoke。

## 使用的真实依赖
- 本机 `claude --help`
- 本机 `codex exec --help`
- 本机已保存 Claude/Codex profile secret（仅进入 PTY env，未输出）
- 真实 Claude/Codex CLI summary runner
- TypeScript 编译器
- Vite build

## 验证步骤
1. 写 RED 测试覆盖 SessionService、summaryContinuation、summaryRunner、App 目标路径。
2. 确认 RED 测试失败点与缺失行为一致。
3. 实现最小修复。
4. 重跑聚焦测试、全量测试、workflow、typecheck、build。
5. 使用本机已保存 profile 跑真实 summary runner smoke。
6. 扫描旧 Keychain/打包矛盾文案和本次 touched 文件 key-like 模式。

## 证据门
| 检查项 | 命令或证据 | 结果 |
|--------|------------|------|
| RED：lite/summary/UI | `npx vitest run tests/app/sessionService.test.ts tests/app/summaryContinuation.test.ts tests/app/summaryRunner.test.ts tests/app/App.test.tsx` | PASS：实现前 9 个预期失败 |
| GREEN：聚焦测试 | `npx vitest run tests/app/sessionService.test.ts tests/app/summaryContinuation.test.ts tests/app/summaryRunner.test.ts tests/app/App.test.tsx` | PASS：4 files / 82 tests |
| RED：Codex CLI 参数 | `npx vitest run tests/app/summaryRunner.test.ts` | PASS：实现前因 `--ask-for-approval` 旧参数失败 |
| RED：Claude effort 参数 | `npx vitest run tests/app/summaryRunner.test.ts` | PASS：实现前因缺少 provider 兼容的 `--effort high` 失败 |
| GREEN：summaryRunner | `npx vitest run tests/app/summaryRunner.test.ts` | PASS：1 file / 3 tests |
| 工作流检查 | `npm run workflow:doctor` | PASS：最终复跑通过 |
| 工作流测试 | `npm run test:workflow` | PASS：最终复跑 8 passed |
| 全量测试 | `npm test` | PASS：最终复跑 39 files / 243 tests |
| Typecheck | `npm run typecheck` | PASS：最终复跑通过 |
| Build | `npm run build` | PASS：最终复跑通过，仅 Vite chunk size warning |
| Claude CLI 参数 | `claude --help` | PASS：支持 `--print`、`--no-session-persistence`、`--setting-sources`、`--mcp-config`、`--strict-mcp-config`、`--effort` |
| Codex CLI 参数 | `codex exec --help` | PASS：支持 `--cd`、`--sandbox read-only`、`--skip-git-repo-check`、`--ephemeral`、`--color never`；未支持 `--ask-for-approval`，已移除旧参数 |
| Codex 真实 summary smoke | `createProfileSummaryRunner` with `codex-openai` | PASS：summary validated OK，outputChars 3202，包含 `# AgentDock Session Summary` |
| Claude 真实 direct CLI smoke | `claude --print` lite flags with `claude-custom-5` | PASS：5.2s 返回 `AGENTDOCK_OK` |
| Claude 真实 summary smoke | `createProfileSummaryRunner` with `claude-custom-5` | PASS：21.2s，`validateSummaryMarkdown` ok，outputChars 1700，首行 `# AgentDock Session Summary` |
| Claude 外部 profile 诊断 | `claude-anyrouter` / `claude-custom-2` / `claude-custom-3` / `claude-custom-4` | FAIL：75s 内无 stdout/stderr，被诊断脚本超时终止 |
| Claude 外部 profile 诊断 | `claude-custom-1` | FAIL：初次暴露 `output_config.effort` 不兼容并已新增 `--effort high`；最终 direct CLI 返回 403 上游额度不足 |
| 空白检查 | `git diff --check` | PASS：最终复跑通过 |
| 文档旧口径扫描 | `rg` 扫描 Keychain 主存储与打包矛盾旧表述 | PASS：聚焦旧矛盾口径无命中；宽扫描仅命中历史说明和本次验证记录文本 |
| 本次 touched 文件 key-like scan | `rg` 扫描真实 key-like 模式 | PASS：无真实 key-like 命中；测试假 token 已避免 secret 扫描噪音 |
| macOS 打包 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：`release/packages/20260706-211053/AgentDock-darwin-arm64/AgentDock.app` |
| codesign 验证 | `codesign --verify --deep --strict --verbose=2 release/packages/20260706-211053/AgentDock-darwin-arm64/AgentDock.app` | PASS |
| 包内 marker 检查 | `@electron/asar` 检查 app.asar | PASS：包含 summary runner strict MCP、summaryContinuation、terminalOutputSanitizer、sessionService sanitizer markers |
| packaged ccline smoke | packaged `ccline --version` | PASS：`ccline 1.1.2` |

## 实际结果
- Claude session 元数据新增 `claudeLaunchMode`，新启动 lite/full 会话会保存模式。
- 重启、恢复、历史满后新开、summary continuation 会继承 Claude lite/full 模式。
- Claude summary runner 写入空 MCP 配置，并使用 `--setting-sources project,local`、`--mcp-config`、`--strict-mcp-config`、`--effort high`。
- Codex summary runner 移除当前 CLI 不支持的 `--ask-for-approval` 参数，保留只读 sandbox 和 ephemeral 约束。
- Codex summary runner 已用本机真实 profile 完成 summary smoke，输出通过 required headings 校验。
- Claude summary runner 已用本机可用真实 profile `claude-custom-5` 完成 summary smoke，输出通过 required headings 校验。
- Renderer 只对命令确认为 Claude/Codex 的 agent session 展示总结/续开操作，本地 shell、Gemini、OpenCode 不展示。
- 文档口径改为本机加密 vault 主路径，Keychain 仅 legacy 迁移/适配；交付报告打包状态矛盾已修正。

## 未验证项
- 本机部分 Claude profile 仍不可用：`claude-custom-1` 为上游额度不足；`claude-anyrouter`、`claude-custom-2`、`claude-custom-3`、`claude-custom-4` 表现为 75s 无输出超时。这属于 profile/provider 可用性风险，不影响 `claude-custom-5` 对 runner 路径的真实验证。
- 已按用户要求重新运行 `npm run package:mac` 并完成 codesign、包内 marker 和 packaged ccline smoke。

## 结论
PASS

## 发现的问题
- 真实 `codex exec --help` 未包含旧的 `--ask-for-approval` 参数；已通过 RED/GREEN 修复。
- 真实 Claude profile `claude-custom-1` 返回过 `output_config.effort` 参数不兼容；已通过 RED/GREEN 固定 `--effort high`。
- 当前本机部分 Claude profiles 未能完成真实 smoke，需后续定位 provider 响应慢、额度不足、模型/网关兼容或 CLI 认证链路；`claude-custom-5` 已证明 Claude runner 真实路径可用。

## 后续动作
进入 delivery_hook。后续优先定位不可用 Claude profile 的上游超时/额度问题；Codex 和 Claude 可用 profile summary runner 均已完成真实 smoke；新 macOS 包已生成并验证。
