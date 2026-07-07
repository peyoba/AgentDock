# AgentDock Claude Profile 内置兼容改写层设计

## 1. 背景

AgentDock 当前可以同时启动多个 Claude Profile，并为每个会话注入独立 endpoint 和 API Key。用户本机已有 `http://127.0.0.1:8787` AnyRouter 兼容代理，用于修正 Claude Code 与 AnyRouter Anthropic 兼容接口之间的请求差异。

现有外部代理的问题是它读取 `~/.anyrouter/current-upstream` 作为全局上游。若 AgentDock 的多个 Claude 会话都指向该代理，它们会被合并到同一个上游，破坏 AgentDock 的核心边界：不同 Profile 必须能同时运行不同 endpoint，互不影响。

## 2. 目标

为 Claude Profile 增加可选的内置兼容改写层，让启用该开关的 Profile 在 AgentDock 内部获得与本机兼容代理相同类型的请求修正能力，同时保持每个会话独立 endpoint、独立 API Key、独立生命周期。

## 3. 非目标

- 不复用 `~/.anyrouter/current-upstream`、`~/.anyrouter/current-key` 或外部 `~/.anyrouter/anyrouter-proxy.js`。
- 不做全局 provider 切换。
- 不做 API gateway、自动路由、fallback、成本统计或请求日志面板。
- 不修改 Codex、Gemini、OpenCode 启动链路。
- 不把完整 API Key、完整请求正文、完整响应正文写入日志、文档、测试 fixture 或 Renderer 状态。

## 4. 用户可见行为

API Profile 的 Claude 表单新增一个开关：

```text
启用 Anthropic 兼容改写
```

该开关只对 Claude Profile 生效。关闭时，Claude 会话继续直连 `profile.baseUrl`。开启时，AgentDock 在启动该会话前创建一个 session 专属的本地 loopback 转发器，并把该会话的 `ANTHROPIC_BASE_URL` 指向：

```text
http://127.0.0.1:<动态端口>
```

转发器内部固定保存当前 Profile 的远端 `baseUrl`，不会读取任何全局上游状态。两个启用兼容改写的 Claude Profile 同时运行时，应分别转发到各自配置的 endpoint。

## 5. 架构设计

新增主进程模块：

```text
src/main/claudeCompatProxy.ts
```

该模块提供一个小型 HTTP 转发器，职责仅限：

- 绑定 `127.0.0.1` 动态端口。
- 接收当前会话 Claude CLI 发出的 Anthropic API 请求。
- 将请求转发到当前 Profile 的 `baseUrl`。
- 对 `POST /v1/messages*` 执行兼容改写。
- 在会话结束时关闭服务器并释放端口。

该模块不持久化任何密钥，不向 Renderer 暴露任何 secret，不读取外部 AnyRouter 状态文件。

## 6. 数据模型

在 `ApiProfile` 增加字段：

```ts
claudeAnthropicCompatProxyEnabled?: boolean;
```

字段含义：

- `true`：该 Claude Profile 启动非本地 shell 命令时启用内置兼容改写层。
- `false` 或缺省：保持当前直连行为。

Profile 保存、迁移、Renderer 表单、preload 类型白名单需同步支持该字段。默认 Profile 可以继续保持关闭，除非用户在界面主动开启。

## 7. 启动数据流

关闭兼容层时：

```text
Profile baseUrl + secret
  -> buildLaunchEnvironment()
  -> ANTHROPIC_BASE_URL=<profile.baseUrl>
  -> Claude CLI
```

开启兼容层时：

```text
Profile baseUrl + secret
  -> startClaudeCompatProxy({ upstreamBaseUrl, secret, profileId, sessionId })
  -> ANTHROPIC_BASE_URL=http://127.0.0.1:<动态端口>
  -> Claude CLI
  -> compat proxy
  -> upstreamBaseUrl
```

`ANTHROPIC_AUTH_TOKEN` 仍按现有机制注入 PTY 环境。转发器透传 Authorization / Anthropic 相关 header，但日志不得输出 token。

## 8. 请求改写规则

第一版只复刻当前本机代理已验证的核心规则。

### 8.1 适用范围

只改写：

```text
POST /v1/messages*
```

其他请求直接透传，例如：

```text
GET /v1/models
```

### 8.2 thinking 字段

当请求体中 `thinking` 缺失、为 `null` 或为 `{ "type": "disabled" }` 时，根据模型修正：

- `claude-3-*`：删除 `thinking`。
- `opus-4-[6-9]`、`sonnet-4-[6-9]`：设置为 `{ "type": "adaptive" }`。
- 其他高版本模型：设置为 `{ "type": "enabled", "budget_tokens": <预算> }`。

其他高版本模型包括但不限于 `claude-fable-5`、`claude-haiku-4-5-*`、`claude-sonnet-4-5-*`。

### 8.3 thinking 参数归一化

当改写后启用了 thinking：

- 设置 `temperature=1`。
- 删除 `top_p`。
- 删除 `top_k`。
- 保证 `max_tokens > budget_tokens`。

### 8.4 beta header

当改写启用了 thinking 时，确保 `anthropic-beta` 包含：

```text
interleaved-thinking-2025-05-14
```

同时移除当前已知 AnyRouter 不支持的 beta：

```text
prompt-caching-scope-2026-01-05
effort-2025-11-24
```

保留已有的 `context-1m-2025-08-07`。

## 9. 错误处理与日志

代理启动失败时，会话启动失败，并返回脱敏错误。

上游返回 4xx/5xx 时，代理将状态码和响应体原样返回给 Claude CLI。主进程日志只允许记录脱敏摘要：

- sessionId
- profileId
- upstream host
- path
- status code
- model
- thinking 状态
- beta 是否被剥离

禁止记录：

- 完整 API Key
- Authorization header
- 完整请求正文
- 完整用户 prompt
- 完整响应正文

## 10. 生命周期

- 启动 Claude PTY 前创建代理。
- PTY 启动失败时立即关闭代理。
- session exit、kill、restart 或 runtime owner 释放时关闭代理。
- 重启会话时重新创建新的代理实例。
- 同一个 session 不允许被两个窗口同时运行，沿用现有 runtime owner 规则。

## 11. 安全边界

- 代理仅监听 `127.0.0.1`。
- 代理端口使用系统分配的动态端口，不写入全局文件。
- Renderer / preload / IPC 不暴露完整 env 或完整 secret。
- 兼容代理状态最多作为 session 内部运行状态存在，不持久化 secret。
- 错误消息必须经过现有 secret 脱敏边界。

## 12. 测试计划

### 12.1 单元测试

新增测试覆盖：

- `claudeCompatProxy` 对 `thinking` 缺失、`null`、`disabled` 的改写。
- `claude-3-*` 删除 thinking。
- `claude-opus-4-8` 使用 adaptive thinking。
- `claude-fable-5` 使用 enabled thinking。
- 启用 thinking 时归一化 `temperature/top_p/top_k/max_tokens`。
- beta header 追加 `interleaved-thinking-2025-05-14` 并剥离不支持 beta。
- `/v1/models` 不改写请求体。
- 日志和错误不包含 secret。

### 12.2 SessionService 测试

新增测试覆盖：

- Profile 开启兼容层时，`ANTHROPIC_BASE_URL` 注入本地动态端口。
- Profile 关闭兼容层时，仍注入远端 `baseUrl`。
- 两个 Profile 同时启动时，两个代理分别使用各自 upstream。
- PTY 启动失败时关闭代理。
- session exit/kill 时关闭代理。

### 12.3 UI 与类型测试

新增或更新测试覆盖：

- API 配置页 Claude Profile 显示“启用 Anthropic 兼容改写”开关。
- 保存 Profile 后该字段不丢失。
- preload 类型白名单包含该字段，但不新增 secret/env 暴露面。

### 12.4 真实验证

开发完成后至少执行：

```bash
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
```

并补充真实验证：

- 启动一个 AnyRouter A Profile，确认请求经 AgentDock 内置代理到 A endpoint。
- 启动一个 AnyRouter B 或 fcapp Profile，确认请求经独立代理到 B endpoint。
- 两个会话并发运行时，切换外部 `~/.anyrouter/current-upstream` 不影响 AgentDock 已运行会话。
- 验证日志和 UI 不出现完整 API Key。

## 13. 验收标准

- 用户可以按 Claude Profile 开关启用兼容改写。
- 启用后无需外部 `127.0.0.1:8787` 代理即可获得 thinking/beta 兼容修正。
- 多个启用兼容层的 Claude 会话可以同时连接不同 endpoint，互不串上游。
- 未启用的 Claude Profile 行为不变。
- Codex 行为不变。
- 不新增生产依赖。
- 不泄露完整 secret、完整 env、完整请求正文或完整响应正文。

## 14. 风险等级

本任务为 L3。

触发原因：

- 修改 Claude API 请求链路。
- 修改环境变量注入结果。
- 处理 API Key 和 Authorization header。
- 涉及本地 HTTP 代理、PTY 生命周期和外部 LLM endpoint。

需要启用测试、开发、验收、质量、安全、风险、集成角色，并保留真实验证记录。
