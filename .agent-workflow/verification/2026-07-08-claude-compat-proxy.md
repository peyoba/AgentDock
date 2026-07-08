# Claude Compat Proxy Verification

## Scope

Claude Profile 内置 Anthropic 兼容改写层：Profile 开关、请求改写、本地 loopback 代理、SessionService 生命周期接线、Renderer 配置入口和 secret 边界。

## Commands

- `npx vitest run tests/app/claudeCompatProxy.test.ts tests/app/configMigration.test.ts tests/app/claudeProfileDefaults.test.ts tests/app/launchEnvironment.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts tests/app/App.test.tsx` — PASS：7 files / 148 tests
- `npm test` — PASS：49 files / 317 tests
- `npm run workflow:doctor` — PASS
- `npm run test:workflow` — PASS：8 passed
- `npm run typecheck` — PASS
- `npm run build` — PASS；仅 Vite chunk size warning

## Real Verification

- Local two-upstream HTTP smoke against built `dist/main/claudeCompatProxy.js` — PASS
  - Proxy A forwarded `POST /v1/messages` to upstream A.
  - Proxy B forwarded `GET /v1/models` to upstream B.
  - `thinking` was injected for `claude-fable-5`.
  - `prompt-caching-scope-2026-01-05` was stripped and `interleaved-thinking-2025-05-14` was added.
  - Log payload did not contain the test Authorization token.
- Local gzip upstream regression — PASS：修复上游 `fetch` 自动解压后仍转发 `content-encoding` 导致下游二次解压失败的问题。
- Real external Claude endpoint smoke — PARTIAL：
  - `claude-custom-1` / `vps.loveta.cyou` / `claude-opus-4-7`：PASS，HTTP 200，返回目标 marker，改写为 `adaptive`，不支持 beta 已剥离。
  - `claude-anyrouter` / `anyrouter.top`：PARTIAL，HTTP 503 Service Unavailable；代理已完成 `adaptive` 改写和 beta 剥离，失败来自上游服务状态。
  - `claude-custom-2`、`claude-custom-4` / `fcapp.run`：PARTIAL，HTTP 503 Service Unavailable；代理已完成 `enabled` 改写和 beta 剥离，失败来自上游服务状态。

## Secret Boundary

已扫描相关 feature 文件，命中仅为测试 fixture 字符串和环境变量名。生产代理模块未记录完整 API Key、Authorization header、完整请求正文或完整响应正文。

## Result

有条件通过：代码、测试、构建、本地真实 HTTP 验证和 1 个外部 Claude endpoint 真机请求通过；其余已配置 AnyRouter/fcapp endpoint 当前返回 503，上游状态未通过。
