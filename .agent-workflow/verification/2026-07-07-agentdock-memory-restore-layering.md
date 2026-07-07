# AgentDock 分层记忆恢复验证记录

## 范围
实现短期 transcript + 长期 summary 的恢复上下文文件生成；Claude/Codex 重启后只向 PTY 注入短读取指令；Renderer 展示一句话恢复摘要，不展示完整 prompt、context 文件路径或 secret。

## 自动化测试
| 命令 | 结果 |
|------|------|
| `npx vitest run tests/app/restoreContextStore.test.ts` | PASS：4 tests，覆盖恢复文件、短指令、一句话摘要、transcript/command 脱敏 |
| `npx vitest run tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/App.test.tsx tests/app/preloadTypes.test.ts tests/app/sessionSecurity.test.ts` | PASS：5 files / 94 tests |
| `npm run workflow:doctor` | PASS：required files、role documents、PROJECT_PROFILE、Superpowers、Markdown fences 全通过 |
| `npm run test:workflow` | PASS：pytest 8 passed |
| `npm run typecheck` | PASS：`tsc --noEmit` 和 `tsc -p tsconfig.main.json --noEmit` 通过 |
| `npm run build` | PASS：typecheck、Vite build、main TS build 通过；仅保留既有 Vite chunk size warning |
| `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run package:mac` | PASS：生成 `release/packages/20260707-062838/AgentDock-darwin-arm64/AgentDock.app` |
| `codesign --verify --deep --strict --verbose=2 release/packages/20260707-062838/AgentDock-darwin-arm64/AgentDock.app` | PASS：valid on disk，satisfies Designated Requirement |
| packaged app.asar marker scan | PASS：包内包含 `dist/main/restoreContextStore.js`、`dist/main/sessionService.js`、短读取指令 marker 和 `memoryRestore` marker |

## 真实验证
| 项目 | 结果 |
|------|------|
| 真实 `node-pty` restore smoke | PASS：使用 `dist/main/sessionService.js` + `createNodePtyAdapter()` 启动真实 PTY，旧会话输出 transcript 后退出，新会话捕获 stdin |
| 短指令验证 | PASS：新 PTY 只收到 `Read the AgentDock restore context file... <path>`，不包含 transcript 正文、`OPENAI_API_KEY` 或测试 key |
| 恢复文件验证 | PASS：`.agentdock/context/restores/session-1.md` 包含可读 transcript tail，测试 key 被替换为 `[REDACTED]` |
| UI 暴露验证 | PASS：App 测试确认只显示一句话摘要，不显示 restore context path 或短读取指令 |
| IPC/metadata 安全 | PASS：未新增 IPC；`sessionSecurity` 确认 session metadata 不暴露恢复正文、短指令或 secret |

## 风险结论
L3 风险项已覆盖：PTY 注入从长 prompt 改为短文件读取指令；恢复文件、摘要、session metadata 和 UI 均有脱敏/不暴露验证。新 macOS 包已生成并通过 codesign 与包内 marker 校验。构建警告为既有 bundle size warning，不影响本次功能正确性。
