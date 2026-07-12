# AgentDock 流式脱敏与私有存储加固实施计划

## 1. 实施原则

- 任务等级：L3。
- 使用 npm，不引入新依赖。
- 严格 TDD：先写失败测试，再做最小实现。
- 分两个可独立验收的批次：
  1. 流式脱敏与 canonical safe stream；
  2. 私有文件权限与旧文件自愈。
- 不回退当前工作区已有改动，不修改用户普通项目文件权限。
- 每个批次完成后先全量验证，再进入下一批次。

## 2. Batch A：流式脱敏

### Task A1：锁定流式安全合同

允许修改：

- `tests/app/secretRedaction.test.ts`
- `tests/app/terminalOutputSanitizer.test.ts`
- 新测试文件 `tests/app/streamingPersistenceSanitizer.test.ts`

RED 场景：

1. 已知 Secret 在每一个合法切分点拆成两段，最终拼接输出不含 Secret。
2. `sk-ant-*`、`sk-*`、API Key 环境变量和 Bearer Token 跨 chunk 脱敏。
3. ANSI/OSC/CSI 跨 chunk 且插入 Secret 中间。
4. `flush()` 不释放疑似 Secret 前缀，`end()` 保留普通尾部。
5. 未闭合敏感 value 在 `end()` 时 fail-closed。
6. 两个 Session 的 pending 状态互不影响。
7. 中文和 emoji 跨 chunk 不产生替换字符。
8. 超长无边界敏感 token 的内存有上限。

完成标准：测试因流式处理器缺失或行为未实现而失败，不允许语法、依赖或测试收集错误。

### Task A2：实现纯流式处理器

建议新增：

- `src/main/streamingTerminalTextSanitizer.ts`
- `src/main/streamingSecretRedactor.ts`
- `src/main/streamingPersistenceSanitizer.ts`

允许小幅调整：

- `src/main/secretRedaction.ts`
- `src/main/terminalOutputSanitizer.ts`

要求：

- 每个实例完全独立，无模块级 pending 状态。
- 终端控制序列过滤先于 Secret 脱敏。
- 保留现有完整字符串函数，供 restore/既有调用使用。
- 不把完整 Secret、原始 chunk 或 pending 内容写入错误消息。
- 单文件若接近 200 行，按 parser/redactor 职责拆开。

验证：Task A1 聚焦测试全部转绿。

### Task A3：接入 SessionService canonical safe stream

先修改：

- `tests/app/sessionServiceTerminal.test.ts`
- 必要时 `tests/app/sessionService.test.ts`

RED 场景：

1. 两次 `runtime.emit()` 拼成一个 Secret，History 完整拼接结果不含 Secret。
2. Workspace context 完整拼接结果不含 Secret。
3. 两个 sink 消费相同 canonical safe text。
4. PTY exit、kill、restart、delete、dispose 会 end 并等待处理器。
5. restart 不继承旧 pending tail。
6. 写入失败后的重试缓存仅包含安全文本。

生产修改：

- `src/main/sessionService.ts`

实施要求：

- Session 启动读取 Secret 后创建处理器。
- Renderer 和内存实时终端仍接收原始 PTY 数据。
- 删除 Workspace 路径对原始 chunk 的独立 sanitizer/redactor。
- 统一安全输出进入既有 history flush 队列和 workspace queue。
- 生命周期操作等待安全输出写入完成。

### Task A4：统一 Summary/Restore 纵深脱敏

先修改测试：

- `tests/app/summaryJobService.test.ts`
- `tests/app/sessionSummaryStore.test.ts`
- `tests/app/restoreContextStore.test.ts`

RED 场景：

- 任意格式的已知测试 Secret 不进入 summary runner 输入、summary、handoff 或 restore 文件。
- Summary byte tail 截断中文时不产生 `U+FFFD`。

生产修改候选：

- `src/main/sessionSummaryStore.ts`
- `src/main/summaryJobService.ts`
- `src/main/restoreContextStore.ts`

要求：Summary 不再维护比主脱敏器更弱的独立规则；完整字符串仍执行纵深脱敏。

### Batch A 证据门

```bash
npx vitest run tests/app/streamingPersistenceSanitizer.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/summaryJobService.test.ts tests/app/sessionSummaryStore.test.ts tests/app/restoreContextStore.test.ts
npm test
npm run typecheck
npm run build
git diff --check
```

并执行真实 `node-pty` 测试：本地安全测试值分块输出后，实际 userData transcript 和 Workspace transcript 均不得含原值。

## 3. Batch B：私有存储权限

### Task B1：建立私有文件 helper

新增：

- `src/main/privateFileSystem.ts`
- `tests/app/privateFileSystem.test.ts`

RED 场景必须使用真实临时目录和 `stat.mode`：

1. 在 `umask 022` 下目录为 `0700`、文件为 `0600`。
2. `0755/0644` 旧路径自动修复且内容不变。
3. 原子写失败保留完整旧目标并清理临时文件。
4. append 后文件保持 `0600`。
5. 目标或父路径为 symlink 时安全失败，不修改外部目标。
6. 并发原子写使用不同临时文件，不互相覆盖或遗留。

注意：修改 `process.umask()` 的测试必须串行并在 `finally` 恢复。

### Task B2：加固 userData Store

按以下顺序先测试后实现：

1. `src/main/stores/jsonStore.ts`
   - `tests/app/jsonStore.test.ts` 或相关 Profile/Workspace Store 测试；
   - 私有父目录、临时文件、最终 JSON、corrupt backup。
2. `src/main/stores/sessionTranscriptStore.ts`
   - `tests/app/sessionTranscriptStore.test.ts`；
   - transcript 目录、append log、roll 文件和旧权限自愈。
3. `src/main/stores/sessionHistoryStore.ts`
   - `tests/app/sessionRecordStore.test.ts`；
   - sessions recovery、corrupt backup、archive。
4. `src/main/stores/sessionFileIndexStore.ts`
   - `tests/app/sessionFileIndexStore.test.ts`；
   - JSON 改为私有原子写。
5. `src/main/adapters/secretVaultAdapter.ts`
   - `tests/app/secretVaultAdapter.test.ts`；
   - 补父目录 `0700` 和读取时权限自愈，保持现有加密与 mutation queue。

### Task B3：加固 Workspace `.agentdock/context` Store

先修改：

- `tests/app/workspaceContextStore.test.ts`
- `tests/app/sessionSummaryStore.test.ts`
- `tests/app/restoreContextStore.test.ts`

生产修改：

- `src/main/workspaceContextStore.ts`
- `src/main/sessionSummaryStore.ts`
- `src/main/restoreContextStore.ts`

验收：

- `.agentdock/context`、sessions、summaries、handoffs、restores 目录为 `0700`；
- index、shared context、transcript、summary、handoff、restore 文件为 `0600`；
- 覆盖写入原子化，append 保持顺序；
- 已有宽权限文件自愈；
- Workspace 普通文件和 `.git/info/exclude` mode 不变；
- `.agentdock` symlink 触发安全失败。

### Task B4：加固 AgentDock 生成的 CLI 配置

先修改：

- `tests/app/sessionService.test.ts`
- `tests/app/summaryRunner.test.ts`

生产修改候选：

- `src/main/sessionService.ts`
- `src/main/summaryRunner.ts`

验收：

- AgentDock 生成的 Claude settings 和 MCP 文件为 `0600`；
- AgentDock 管理的 Codex Home 目录为 `0700`，`config.toml` 为 `0600`；
- 不修改用户全局 `.claude`、`.codex` 或非 AgentDock 管理目录的其他文件；
- 配置文件不含完整 API Key。

### Task B5：旧文件自愈与所有权集成

修改候选：

- `src/main/main.ts`
- 各 Store 初始化或首次读取路径。

要求：

- 固定 userData 路径在 Store 使用时自愈；
- 动态 Workspace 只在实际访问 `.agentdock` 时自愈；
- 不递归扫描 Home 或所有 Workspace；
- 权限错误返回脱敏信息并阻止假成功。

### Batch B 证据门

```bash
npx vitest run tests/app/privateFileSystem.test.ts tests/app/secretVaultAdapter.test.ts tests/app/sessionTranscriptStore.test.ts tests/app/sessionRecordStore.test.ts tests/app/sessionFileIndexStore.test.ts tests/app/workspaceContextStore.test.ts tests/app/sessionSummaryStore.test.ts tests/app/restoreContextStore.test.ts tests/app/sessionService.test.ts tests/app/summaryRunner.test.ts
npm test
npm run test:workflow
npm run workflow:doctor
npm run typecheck
npm run build
git diff --check
```

## 4. 最终真实验证

1. 使用测试专用临时 userData 和 Workspace，不读取现有用户数据。
2. 使用真实 `node-pty` 分块输出测试 Secret。
3. 检查所有生成 artifact 的完整内容和 `stat.mode`。
4. 生成时间戳 macOS 包并严格验证签名。
5. 使用隔离 userData 启动打包应用，创建本地 zsh 测试 Session。
6. 验证打包后的 userData transcript、Workspace context 和 CLI 配置权限。
7. 不调用真实 Claude/Codex API，不消耗用户额度。

## 5. 工作流角色

- ①测试：为每个 Task 先建立 RED 合同。
- ②开发：只实现让已确认测试转绿的最小代码。
- ③验收：逐条核对 SPEC 15 项安全验收标准。
- ④质量：检查重复 helper、错误处理、职责和复杂度。
- ⑤安全：重点检查 raw Secret 是否可能进入失败队列、日志、临时文件或其他 sink。
- ⑩风险：检查 chmod 所有权边界、symlink、旧数据兼容和打包行为。
- ⑥性能：检查逐字符 parser、频繁 chmod 和高频 append 的开销。
- ⑧集成：全量自动化与真实文件系统/node-pty 验证。
- ⑨部署：macOS package、codesign 和打包产物权限 smoke。

## 6. 停止条件

出现任一情况必须暂停并请求用户决策：

- 需要引入新依赖；
- 需要修改用户普通 Workspace、`.git`、全局 Claude/Codex 目录权限；
- 需要改变 API Key 查看或 Vault 产品决策；
- 发现现有用户文件无法在不破坏兼容性的情况下安全自愈；
- 同一问题被安全、验收或质量角色打回超过两次。
