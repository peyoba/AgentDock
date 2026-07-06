# AgentDock 分层记忆恢复设计

## 背景

当前 AgentDock 已有 per-session transcript、summary/handoff 和恢复 prompt 注入能力，但恢复体验仍有两个问题：

- 恢复材料会以大段文本进入 Claude/Codex 终端输入区，影响 TUI 显示和用户输入体验。
- 用户无法直观看到“恢复了什么”，容易误以为上下文没有保存或没有加载。

本设计参考 Engram 的记忆处理思路：短期记录、用户意图、长期摘要和恢复上下文分层保存；恢复时后台加载，用户界面只展示状态和一句话摘要。

## 目标

1. 保证 AgentDock 窗口重启后，终端近期内容不丢失。
2. 恢复/重启 Agent 会话时，后台加载可用记忆，不把大段恢复提示词显示在终端输入框。
3. 记忆加载完成后，在 UI 展示一句话恢复摘要，让用户知道恢复内容的核心结论。
4. 保持现有安全边界：API Key、token、完整环境变量不得写入恢复文件、摘要、IPC 响应或前端持久化状态。

## 非目标

- 不引入 SQLite、FTS 或完整 Engram 克隆。
- 不做云同步、团队同步或跨机器记忆。
- 不做自动语义检索和复杂 memory dashboard。
- 不把完整 transcript 注入模型上下文。

## 存储分层

### 1. 短期 transcript 层

每个 session 使用独立 transcript 文件持续追加写入。运行中输出应尽快落盘，不等待进程退出。默认读取最近 20MB tail 用于终端 UI 回放，保证窗口内容不丢。

短期 transcript 是终端显示恢复材料，不直接等同于 Agent 任务记忆。

### 2. 用户意图层

记录用户输入和关键操作，用于恢复“用户刚才要求什么”。MVP 可先保存最近用户 prompt 或由现有终端输出中可读片段推导；后续可扩展为独立 prompt log。

### 3. 长期 summary 层

已有 summary/handoff 继续作为长期压缩记忆。会话过长、用户点击“总结并续开”、或后续自动压缩时，写入结构化 Markdown 文件。

恢复时优先使用 summary/handoff；没有 summary 时使用最近 transcript tail fallback。

### 4. restore context 层

恢复/重启时，AgentDock 后台组合：

```text
latest summary/handoff
+ recent user prompts
+ recent readable transcript tail
```

组合结果写入本地 restore context 文件。AgentDock 只向 Claude/Codex 注入一条短指令，让 Agent 读取该文件继续任务；终端输入框不得显示完整恢复内容。

## 恢复流程

```text
用户恢复或重启 Agent 会话
→ AgentDock 读取 session metadata
→ 读取最新 summary/handoff
→ 读取最近 user prompts / transcript tail
→ 生成 restore context 文件
→ 后台向 PTY 注入短指令读取 restore context 文件
→ UI 显示恢复状态和一句话恢复摘要
```

恢复指令应短且稳定，例如：

```text
Read the AgentDock restore context file, then continue the current task: <file-path>
```

不允许把 restore context 的完整正文直接粘贴到 Claude/Codex 输入区。

## UI 要求

恢复记忆时，终端区域保持干净。UI 只显示轻量状态：

- `正在恢复记忆`
- `记忆已恢复`
- `未找到可恢复记忆`
- `记忆恢复失败`

恢复成功后展示一句话摘要，例如：

```text
记忆已恢复：上次会话主要在修复 AgentDock 会话恢复与输入框污染问题，已确认采用分层记忆存储方案，下一步是写 SPEC 并实现后台 restore。
```

这句话应来自已加载的 summary/user prompts/transcript tail 的提炼结果。MVP 可以采用确定性规则生成，不强制调用 LLM；已有 summary 时优先从 summary 提炼，没有 summary 时从最近 transcript tail 提炼。

可提供“查看来源文件”入口，但默认不展开来源细节。

## 错误与降级

- 找到 summary 和 transcript：使用 summary + recent tail。
- 找到 transcript 但无 summary：使用 transcript fallback，并显示一句话摘要。
- 找不到任何可恢复材料：不注入恢复指令，UI 显示 `未找到可恢复记忆`。
- restore context 文件写入失败：不启动大段 stdin fallback，UI 显示 `记忆恢复失败` 和安全错误信息。
- Claude/Codex 不支持读取文件或短指令失败：终端仍正常启动，UI 保留恢复失败状态，用户可手动打开 restore context 文件。

## 安全要求

- restore context、transcript tail、summary 和一句话摘要都必须经过 secret-like pattern 脱敏。
- IPC 不返回完整环境变量对象或完整 API Key。
- UI 不展示完整 secret。
- 错误信息不得包含 secret。
- 复制恢复来源时默认不包含完整凭证。

## 验收标准

1. 运行中 session 输出会持续写入本地 transcript 文件。
2. App 重启后，可从 transcript tail 恢复近期终端显示。
3. 恢复/重启 Claude 或 Codex 会话时，AgentDock 生成 restore context 文件。
4. PTY 只收到短读取指令，不收到完整 restore context 正文。
5. Claude/Codex 输入框不显示大段恢复提示词。
6. 记忆加载完成后，UI 显示一句话恢复摘要。
7. 没有 summary 时，系统使用 transcript tail fallback 并仍生成一句话摘要。
8. restore context 和一句话摘要不包含完整 API Key、token 或完整环境变量。
9. 相关测试覆盖 transcript tail、restore context 文件生成、短指令注入、UI 一句话摘要和 secret 脱敏。
10. L3 真实验证覆盖 node-pty 写入路径，确认输入区不被大段恢复文本污染。

## 风险等级

L3。

触发原因：该功能涉及 PTY 输入、会话恢复、环境变量/密钥安全边界、本地 transcript/summary 文件和 Agent 上下文恢复。

## 后续实施建议

实施时按 TDD 进行：

1. 先补 restore context 文件生成和短指令注入的 RED 测试。
2. 再补 UI 一句话恢复摘要测试。
3. 最小实现文件写入、脱敏和状态展示。
4. 最后进行真实 node-pty smoke，确认恢复内容后台处理且输入框干净。
