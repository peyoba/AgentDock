# AgentDock Grok Build CLI 一等公民接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本机 Grok Build TUI（`grok`）接入 AgentDock，成为与 Claude / Codex 同级的正式工具类型：Profile CRUD、独立 `GROK_HOME`、API Key/OAuth 双认证、启动注入、模型拉取、恢复与摘要最小闭环。

**Architecture:** 在现有 `ToolType` + `ApiProfile` + `buildLaunchEnvironment` + `SessionService` + Renderer 配置/启动栏管线上扩展 `grok`，不新增状态库或 UI 框架。隔离主键为 Profile 级 `GROK_HOME`；API Key 走 vault → `XAI_API_KEY`；OAuth 在独立 `GROK_HOME` 内由 Grok 终端自行登录。Key 模式启动前若存在 `auth.json` 则改名停用，避免 session token 覆盖 Key。

**Tech Stack:** Electron + React + TypeScript + xterm.js + node-pty + Vitest + npm。

**Spec:** `docs/superpowers/specs/2026-07-18-agentdock-grok-build-cli-integration-design.zh-CN.md`

---

## 风险与执行角色

本任务为 **L3**：密钥存储、PTY、外部 CLI、环境变量、恢复注入、摘要。

执行前按项目模板登记任务卡；性能角色默认 SKIPPED（无热路径算法变更）。

- ①测试工程师：按 SPEC 写失败测试，不看实现细节放水
- ②开发工程师：最小实现，不改测试语义
- ③验收工程师：逐条对照 SPEC §14
- ④质量工程师：查重复分支、命名、文件膨胀
- ⑤安全工程师：Key/auth.json/日志/transcript/IPC
- ⑩风险审查官：OAuth 隔离、双 Profile 并发、Windows PATH、partial 摘要
- ⑦文档工程师：PROJECT_REQUIREMENTS / DECISIONS / PROJECT_PROFILE
- ⑧集成工程师：全量测试 + 真机 `grok` 验证记录
- ⑨部署工程师：本任务默认不发版；若用户要求打包再启用

## 文件结构

### 新增

- `src/shared/grokProfileDefaults.ts`：默认 baseUrl、模型、`GROK_HOME` 路径辅助、默认 baseUrl 判断
- `src/main/grokHomePrep.ts`：确保 `GROK_HOME`、合并写最小 `config.toml`、API Key 模式 disable `auth.json`
- `tests/app/grokProfileDefaults.test.ts`
- `tests/app/grokHomePrep.test.ts`
- `.agent-workflow/verification/2026-07-19-agentdock-grok-build-cli-integration.md`
- `.agent-workflow/delivery/2026-07-19-agentdock-grok-build-cli-integration-delivery-report.md`（交付时）

### 修改

- `src/shared/agentdockTypes.ts`：`ToolType` 加 `grok`；`GrokAuthMode`；`ApiProfile.grokHome/grokAuthMode`；`NativeResumeState.tool`；相关联合类型
- `src/shared/sessionCommands.ts`：允许 `grok` / `grok.exe`
- `src/main/launchEnvironment.ts`：`resolveGrokHome` + Grok env 分支
- `src/main/adapters/ptyAdapter.ts`：`MANAGED_AGENT_ENV_KEYS` 扩展 Grok 键
- `src/main/stores/profileStore.ts`：sanitize 保留 grok 字段
- `src/main/stores/configMigration.ts`：如有 schema 白名单则纳入 grok 字段
- `src/main/sessionService.ts`：Grok 启动 prep、secret 可选（oauth）、resume/summary 分支接入
- `src/main/modelFetchService.ts`：Grok 走 Bearer；oauth 无 Key 明确错误
- `src/main/nativeResumeProbe.ts`：Grok continue/resume 命令
- `src/main/initialPromptInjector.ts`：`InitialPromptTool` 含 `grok`
- `src/main/summaryRunner.ts` / `summaryContinuation.ts`：Grok 摘要命令与 handoff
- `src/main/secretRedaction.ts`（及 streaming sanitizer 若集中维护模式）：`XAI_API_KEY` / `xai-` token
- `src/renderer/App.tsx`：`defaultCommandFor` / launchMode / summary 支持判断
- `src/renderer/components/ApiConfigPanel.tsx`：Grok tab/表单
- `src/renderer/components/CommandBar.tsx`：Grok 不显示 claude/codex 模式
- `src/renderer/components/SessionDetailsDrawer.tsx`：展示 grokHome / authMode
- `docs/PROJECT_REQUIREMENTS.md`、`DECISIONS.md`、`PROJECT_PROFILE.md`（若有工具矩阵）
- 对应 `tests/app/*.test.ts(x)`

### 不修改

- 不引入新 npm 依赖
- 不启用 gemini/opencode UI
- 不实现 Grok compat proxy / gateway

---

## Batch 0 — 基线确认

- [ ] **Step 0.1: 记录基线**

Run:

```bash
npm run workflow:doctor
npm run typecheck
npx vitest run tests/app/launchEnvironment.test.ts tests/app/sessionCommands.test.ts tests/app/modelFetchService.test.ts
```

Expected: 当前主干绿色（或记下已有失败，实现期不顺手修无关失败）。

- [ ] **Step 0.2: 确认本机 grok**

Run:

```bash
command -v grok
script -q /dev/null grok --help </dev/null | head -20
```

Expected: 能看到 `Grok Build TUI` Usage。若缺失，真机项标记 PARTIAL。

---

## Task 1：共享类型与默认值（L2）

**Files:**
- Create: `src/shared/grokProfileDefaults.ts`
- Create: `tests/app/grokProfileDefaults.test.ts`
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/sessionCommands.ts`
- Modify: `tests/app/sessionCommands.test.ts`
- Modify: `tests/app/preloadTypes.test.ts`（若断言 ToolType 联合）

- [ ] **Step 1.1: 写失败测试 — sessionCommands 允许 grok**

```ts
it('allows grok executables in the session command allowlist', () => {
  expect(isSupportedSessionCommand('grok --no-alt-screen')).toBe(true);
  expect(isSupportedSessionCommand('grok.exe --no-alt-screen')).toBe(true);
  expect(commandExecutableName('/Users/me/.local/bin/grok --resume abc')).toBe('grok');
});
```

- [ ] **Step 1.2: 写失败测试 — grok defaults**

```ts
import {
  DEFAULT_GROK_BASE_URL,
  DEFAULT_GROK_MODEL,
  defaultGrokHomePath,
  isDefaultGrokBaseUrl,
} from '../../src/shared/grokProfileDefaults';

it('provides grok profile defaults', () => {
  expect(DEFAULT_GROK_BASE_URL).toBe('https://api.x.ai/v1');
  expect(DEFAULT_GROK_MODEL).toBe('grok-build');
  expect(defaultGrokHomePath('grok-work')).toBe('~/.agentdock/grok-profiles/grok-work');
  expect(isDefaultGrokBaseUrl('https://api.x.ai/v1')).toBe(true);
  expect(isDefaultGrokBaseUrl('https://proxy.example/v1')).toBe(false);
});
```

- [ ] **Step 1.3: 运行确认 RED**

Run: `npx vitest run tests/app/sessionCommands.test.ts tests/app/grokProfileDefaults.test.ts`

Expected: FAIL（缺实现 / allowlist 无 grok）

- [ ] **Step 1.4: 最小实现**

`agentdockTypes.ts`：

```ts
export type ToolType = 'claude' | 'codex' | 'grok' | 'gemini' | 'opencode';
export type GrokAuthMode = 'api-key' | 'oauth';

// ApiProfile 增加：
grokHome?: string;
grokAuthMode?: GrokAuthMode;

// NativeResumeState.tool:
tool: 'claude' | 'codex' | 'grok';
```

`sessionCommands.ts`：`SUPPORTED_SESSION_EXECUTABLES` 加入 `grok`、`grok.exe`。

`grokProfileDefaults.ts`：导出默认常量与 `defaultGrokHomePath` / `isDefaultGrokBaseUrl`（trim、去尾 `/` 后比较）。

- [ ] **Step 1.5: 运行确认 GREEN**

Run: `npx vitest run tests/app/sessionCommands.test.ts tests/app/grokProfileDefaults.test.ts`

Expected: PASS

- [ ] **Step 1.6: Commit**

```bash
git add src/shared/agentdockTypes.ts src/shared/sessionCommands.ts src/shared/grokProfileDefaults.ts tests/app/sessionCommands.test.ts tests/app/grokProfileDefaults.test.ts
git commit -m "feat(grok): add tool type defaults and command allowlist"
```

---

## Task 2：launchEnvironment + managed env scrub（L3）

**Files:**
- Modify: `src/main/launchEnvironment.ts`
- Modify: `src/main/adapters/ptyAdapter.ts`
- Modify: `tests/app/launchEnvironment.test.ts`
- Modify: `tests/app/ptyAdapter.test.ts`（若覆盖 scrub）

- [ ] **Step 2.1: 写失败测试**

```ts
it('builds grok api-key launch env with isolated GROK_HOME', () => {
  const env = buildLaunchEnvironment({
    profile: {
      id: 'grok-a',
      name: 'Grok A',
      toolType: 'grok',
      baseUrl: 'https://api.x.ai/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'grok-a',
      grokAuthMode: 'api-key',
      grokHome: '~/.agentdock/grok-profiles/grok-a',
    },
    secret: 'xai-test-secret',
    appDataPath: '/tmp/agentdock-app',
    homeDir: '/Users/demo',
  });

  expect(env.XAI_API_KEY).toBe('xai-test-secret');
  expect(env.GROK_HOME).toContain('grok-profiles/grok-a');
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toBeUndefined();
});

it('builds grok oauth launch env without API key injection', () => {
  const env = buildLaunchEnvironment({
    profile: {
      id: 'grok-oauth',
      name: 'Grok OAuth',
      toolType: 'grok',
      baseUrl: 'https://api.x.ai/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'grok-oauth',
      grokAuthMode: 'oauth',
    },
    secret: 'should-not-inject',
    appDataPath: '/tmp/agentdock-app',
    homeDir: '/Users/demo',
  });

  expect(env.XAI_API_KEY).toBeUndefined();
  expect(env.GROK_HOME).toBeTruthy();
});

it('injects proxy base url overrides for custom grok endpoint', () => {
  const env = buildLaunchEnvironment({
    profile: {
      id: 'grok-proxy',
      name: 'Grok Proxy',
      toolType: 'grok',
      baseUrl: 'https://proxy.example/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'grok-proxy',
      grokAuthMode: 'api-key',
    },
    secret: 'xai-test-secret',
    appDataPath: '/tmp/agentdock-app',
    homeDir: '/Users/demo',
  });

  expect(env.GROK_CLI_CHAT_PROXY_BASE_URL).toContain('proxy.example');
  expect(env.GROK_MODELS_BASE_URL).toContain('proxy.example');
});
```

- [ ] **Step 2.2: RED**

Run: `npx vitest run tests/app/launchEnvironment.test.ts`

- [ ] **Step 2.3: 实现 `resolveGrokHome` + Grok 分支**

规则对齐 SPEC §5.2：

- `GROK_HOME` 必须设置
- `grokAuthMode !== 'oauth'` 时设置 `XAI_API_KEY=secret`
- 非默认 baseUrl 时设置 `GROK_CLI_CHAT_PROXY_BASE_URL` 与 `GROK_MODELS_BASE_URL`
- 不设置 `OPENAI_*` 冒充

`MANAGED_AGENT_ENV_KEYS` 增加：

```ts
'XAI_API_KEY',
'GROK_CODE_XAI_API_KEY',
'GROK_HOME',
'GROK_CLI_CHAT_PROXY_BASE_URL',
'GROK_MODELS_BASE_URL',
'GROK_MODELS_LIST_URL',
```

- [ ] **Step 2.4: GREEN + Commit**

```bash
npx vitest run tests/app/launchEnvironment.test.ts tests/app/ptyAdapter.test.ts
git add src/main/launchEnvironment.ts src/main/adapters/ptyAdapter.ts tests/app/launchEnvironment.test.ts tests/app/ptyAdapter.test.ts
git commit -m "feat(grok): inject isolated GROK_HOME and XAI_API_KEY"
```

---

## Task 3：GROK_HOME 准备与 auth.json 冲突处理（L3）

**Files:**
- Create: `src/main/grokHomePrep.ts`
- Create: `tests/app/grokHomePrep.test.ts`
- Modify: `src/main/sessionService.ts`（调用 prep）

- [ ] **Step 3.1: 写失败测试（使用临时目录）**

```ts
it('writes minimal config.toml defaults without secrets', async () => {
  // prepareGrokHome({ grokHome, defaultModel: 'grok-build' })
  // config.toml 含 [models] default 与 [terminal] alt_screen = "never"
  // 文件内容不得包含 xai- 或 api key
});

it('renames auth.json in api-key mode and returns a safe notice', async () => {
  // 预先写入 auth.json
  // prepareGrokHome({ authMode: 'api-key' })
  // auth.json 不存在，出现 auth.json.agentdock-disabled-*
  // notice 无 secret
});

it('leaves auth.json untouched in oauth mode', async () => {
  // authMode oauth 时 auth.json 保持不变
});
```

- [ ] **Step 3.2: RED → 实现 `prepareGrokHome`**

职责：

1. `mkdir` GROK_HOME
2. 合并更新 `config.toml` 最小段（不抹掉其他用户段）
3. api-key 模式 disable `auth.json`
4. 返回 `{ grokHome, notice?: string }`

- [ ] **Step 3.3: SessionService 接入**

在 Grok 非 local-shell 启动路径，PTY spawn 前调用 `prepareGrokHome`；若有 notice，写入终端系统提示（与现有 `[AgentDock]` 提示风格一致），**不得**包含 secret。

OAuth 模式：vault 无 Key 时不得抛 missing secret；传空 secret 给 env builder 且不注入 Key。

API Key 模式：secret 缺失仍失败。

- [ ] **Step 3.4: 相关 sessionService 测试补齐后 GREEN**

Run: `npx vitest run tests/app/grokHomePrep.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts`

- [ ] **Step 3.5: Commit**

```bash
git commit -m "feat(grok): prepare profile home and disable conflicting auth.json"
```

---

## Task 4：Profile 存储消毒与配置迁移（L2）

**Files:**
- Modify: `src/main/stores/profileStore.ts`
- Modify: `src/main/stores/configMigration.ts`（若字段白名单）
- Modify: `tests/app/metadataStores.test.ts` / `configMigration.test.ts`

- [ ] **Step 4.1: 测试 sanitize 保留 `grokHome`/`grokAuthMode`，清空 claude/codex 专用字段混入**

- [ ] **Step 4.2: 实现并 GREEN**

- [ ] **Step 4.3: Commit**

```bash
git commit -m "feat(grok): persist grok profile fields in profile store"
```

---

## Task 5：API 配置 UI（L2）

**Files:**
- Modify: `src/renderer/components/ApiConfigPanel.tsx`
- Modify: `tests/app/App.test.tsx` 或新增 `tests/app/ApiConfigPanel.test.tsx`

- [ ] **Step 5.1: 失败测试**

- 筛选 tabs 含 Grok
- 新建 Grok draft：`baseUrl=https://api.x.ai/v1`，`grokAuthMode=api-key`，`grokHome=~/.agentdock/grok-profiles/<id>`，`defaultModel=grok-build`
- 切换 oauth 时 API Key 非强制
- gemini/opencode 仍不在可编辑列表

- [ ] **Step 5.2: 实现 UI**

- `toolTypes` / `editableToolTypes` 加 Grok
- 表单字段按 SPEC §7.1
- 保存时只持久化 Grok 相关字段
- 环境变量预览：`XAI_API_KEY=******`（api-key）、`GROK_HOME=...`

- [ ] **Step 5.3: GREEN + Commit**

```bash
git commit -m "feat(grok): expose Grok profiles in API config panel"
```

---

## Task 6：启动栏 / App 默认命令 / 会话详情（L2）

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/CommandBar.tsx`
- Modify: `src/renderer/components/SessionDetailsDrawer.tsx`
- Modify: `tests/app/App.test.tsx`
- Modify: `tests/app/SessionDetailsDrawer.test.tsx`（若有）

- [ ] **Step 6.1: 测试**

- `defaultCommandFor(grokProfile) === 'grok --no-alt-screen'`
- 选中 Grok 时不渲染 Claude/Codex 模式选择
- `local-shell` 仍可选
- `isSummarySupportedAgentSession` 对 grok+命令 grok 为 true
- 会话详情展示认证方式与 GROK_HOME

- [ ] **Step 6.2: 实现 + GREEN + Commit**

```bash
git commit -m "feat(grok): wire default command and session details"
```

---

## Task 7：模型拉取（L2）

**Files:**
- Modify: `src/main/modelFetchService.ts`
- Modify: `tests/app/modelFetchService.test.ts`

- [ ] **Step 7.1: 测试**

- Grok + secret：Bearer 请求 `/models` 候选
- Grok oauth 且 secret 读失败/空：抛出明确中文错误，不含 secret
- 不添加 anthropic-version 头

- [ ] **Step 7.2: 实现 + GREEN + Commit**

```bash
git commit -m "feat(grok): fetch models with bearer auth"
```

---

## Task 8：原生恢复与初始注入（L3）

**Files:**
- Modify: `src/main/nativeResumeProbe.ts`
- Modify: `src/main/initialPromptInjector.ts`
- Modify: `src/main/sessionService.ts`（resume 路径识别 grok）
- Modify: `tests/app/nativeResumeProbe.test.ts`
- Modify: `tests/app/initialPromptInjector.test.ts`
- Modify: 相关 sessionService 测试

- [ ] **Step 8.1: 测试**

```ts
it('builds grok continue resume command', () => {
  // status partial or verified
  // resumeCommand 包含 'grok --no-alt-screen --continue' 或 '--resume <id>'
});
```

初始注入：

- tool `grok` 可创建 injector
- 取消/超时路径不泄露 prompt 到 throw message 以外的日志（沿用现有 redaction）

- [ ] **Step 8.2: 实现**

探测策略（最小可用）：

1. 若 `${GROK_HOME}` 下能解析到 session id → `grok --no-alt-screen --resume <id>` / verified
2. 否则若 GROK_HOME 存在 → `grok --no-alt-screen --continue` / partial
3. 否则 unavailable

不要把恢复正文放进 argv。

- [ ] **Step 8.3: GREEN + Commit**

```bash
git commit -m "feat(grok): add native resume probe and prompt injection support"
```

---

## Task 9：摘要与续聊（L3）

**Files:**
- Modify: `src/main/summaryRunner.ts`
- Modify: `src/main/summaryContinuation.ts`
- Modify: `src/renderer/App.tsx`（入口判断，若尚未做）
- Modify: `tests/app/summaryRunner.test.ts`
- Modify: `tests/app/summaryContinuation.test.ts`

- [ ] **Step 9.1: 测试**

- Grok api-key：可构建 headless 摘要命令或 HTTP 摘要路径（选 **一种** 最小实现并锁测试）
  - 推荐最小：`grok --no-alt-screen -p <prompt>` 或文档中的 single-turn 形式；需在实现时用本机 `grok --help` 核对 flag（`-p/--single`）
- OAuth 无 Key：返回 partial handoff（模板摘要 + transcript 片段），状态明确，不抛成假 success
- continuation session 使用 grok 默认命令与同一 profile/workspace

- [ ] **Step 9.2: 实现 + GREEN + Commit**

```bash
git commit -m "feat(grok): support summary handoff and continuation sessions"
```

---

## Task 10：脱敏与安全回归（L3）

**Files:**
- Modify: `src/main/secretRedaction.ts`（及必要 sanitizer）
- Modify: `tests/app/secretRedaction.test.ts`
- Modify: `tests/app/sessionSecurity.test.ts`
- Modify: `tests/app/streamingPersistenceSanitizer.test.ts`（若需）

- [ ] **Step 10.1: 测试**

- 文本含 `XAI_API_KEY=xai-abc` / `xai-` token 被脱敏
- launch 失败错误不包含 secret
- 普通 profile list 不含 secret（既有合同保持）

- [ ] **Step 10.2: GREEN + Commit**

```bash
git commit -m "security(grok): redact XAI API key material in outputs"
```

---

## Task 11：文档与需求矩阵（L1）

**Files:**
- Modify: `docs/PROJECT_REQUIREMENTS.md`
- Modify: `DECISIONS.md`
- Modify: `PROJECT_PROFILE.md`（如有工具列表）
- Modify: SPEC 状态行改为「已批准 / 实施中」

- [ ] **Step 11.1: 更新文案**

- 正式支持工具：Claude / Codex / Grok
- 决策表追加：GROK_HOME 隔离、双认证、默认 `grok --no-alt-screen`、不做 gateway

- [ ] **Step 11.2: Commit**

```bash
git commit -m "docs(grok): record Grok Build CLI product decisions"
```

---

## Task 12：总验证与真机记录（L3）

- [ ] **Step 12.1: 自动化**

```bash
npm run workflow:doctor
npm run typecheck
npm run build
npx vitest run
```

Expected: 全绿。若有无关既有失败，记录但不宣称本任务导致。

- [ ] **Step 12.2: 真机（本机有 grok）**

验证清单写入 `.agent-workflow/verification/2026-07-19-agentdock-grok-build-cli-integration.md`：

1. 创建 Grok API Key Profile，启动进入 TUI
2. 创建 Grok OAuth Profile，独立 `GROK_HOME`，不影响 `~/.grok`
3. 两 Profile 并发，目录不同
4. Key 模式预置 `auth.json` 被 disable 且有提示
5. 模型拉取成功或可解释失败
6. resume/fresh 入口可用
7. 摘要入口状态明确
8. 日志/UI 无明文 Key

无真实 Key 时：API 调用项标 `PARTIAL`，不得写“应该可以”。

- [ ] **Step 12.3: 交付报告**

使用 `.agent-workflow/templates/delivery-report.md` 输出到  
`.agent-workflow/delivery/2026-07-19-agentdock-grok-build-cli-integration-delivery-report.md`

- [ ] **Step 12.4: 最终 commit（若还有验证文档）**

```bash
git commit -m "test(grok): add integration verification record"
```

---

## 验收对照（SPEC §14）

| # | 标准 | 覆盖任务 |
|---|------|----------|
| 1 | Grok 分类与默认 GROK_HOME | T5 |
| 2 | API Key 启动注入 | T2 T3 T6 |
| 3 | OAuth 独立登录 | T2 T3 T6 |
| 4 | 双 Profile 隔离 | T2 T3 T12 |
| 5 | 默认命令无 always-approve | T6 |
| 6 | auth.json disable | T3 |
| 7 | 模型拉取 | T7 |
| 8 | 会话库 + resume/fresh | T8 T6 |
| 9 | 摘要状态明确 | T9 |
| 10 | 无明文 Key 泄露 | T10 |
| 11 | gemini/opencode 仍隐藏 | T5 |
| 12 | doctor/typecheck/build/tests | T12 |

---

## 执行方式建议

用户确认本计划后，推荐：

1. `superpowers:subagent-driven-development` 按 Task 1→12 顺序执行  
2. 每个 Task 严格 TDD：RED → GREEN → commit  
3. L3 Task（2/3/8/9/10/12）完成后写 handoff，必要时过安全/风险闸门  
4. 未获用户明确授权前：不改 `.env`、不加依赖、不发版

---

## Plan Self-Review

- 覆盖 SPEC 必须项；明确不做 gateway / gemini
- 类型 → env → home prep → UI → models → resume → summary → security → docs → verify 无反依
- 每个 Task 有文件、测试、命令、commit
- 真机与无 Key 的 PARTIAL 规则写死，避免假完成
