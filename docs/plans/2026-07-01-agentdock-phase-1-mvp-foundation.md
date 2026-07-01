# AgentDock 第一阶段 MVP 基础层实施计划

> **给 Claude / Codex：** 执行本计划时必须使用 `superpowers:executing-plans`，并按任务逐项执行、逐项验证。

**目标：** 先交付一个安全、可测试的 AgentDock MVP 基础层，包括 Profile / Workspace / Session 类型契约、密钥安全预览、启动环境生成、IPC / preload 边界，以及终端优先的渲染层外壳。

**架构：** 第一阶段先建立类型、测试、UI 和安全边界，不直接接入真实 `node-pty` 或 macOS Keychain。主进程负责 metadata、启动环境生成和后续 adapter 边界；渲染进程只能拿到脱敏后的配置数据，并通过 preload 暴露的受控 IPC 发起请求。真实 PTY 和 Keychain 集成放到第二阶段，避免在测试边界未建立前处理真实密钥。

**技术栈：** Electron + React + TypeScript + Vite + xterm.js CSS，包管理器固定为 npm。建议新增 dev-only 测试依赖：Vitest + jsdom + React Testing Library；新增依赖前必须先得到用户确认。

---

## 第一阶段范围

### 本阶段要做

- 定义 Profile / Workspace / Session 的 TypeScript 领域类型。
- 定义密钥脱敏工具和环境变量预览工具。
- 实现 Claude / Codex 启动环境生成器。
- 定义 Keychain / PTY adapter interface，但不接入真实 native 实现。
- 定义 main / preload IPC 契约：列出 Profile、列出 Workspace、启动会话、列出会话。
- Codex 启动环境必须和 Claude 一样隔离 endpoint；不得只隔离 `CODEX_HOME` 和 key。
- Renderer / preload / IPC 不得返回完整 secret 或完整环境变量对象，只能返回脱敏预览或最小必要 metadata。
- 将 Renderer 拆成职责清晰的组件，匹配已确认的 v3b 终端优先 UI。
- 当前会话详情默认收起。
- API 配置 UI 骨架按工具类型分组：Claude / Codex / Gemini / OpenCode / 全部。

### 本阶段不做

- 不启动真实 `node-pty` 会话。
- 不读写真实 macOS Keychain。
- 不做外部 provider 连接测试。
- 不做成本统计、请求日志、API gateway、自动路由、fallback。
- 不做复杂 Dashboard、完整 IDE、diff viewer 或复杂分屏。

### 写代码前必须确认的事项

第一阶段要按 TDD 开发，需要 JavaScript / React 测试运行器。当前仓库只有 Python workflow 测试和 TypeScript 构建检查，无法覆盖 React UI 状态和 TypeScript 业务函数行为。

推荐新增 dev-only 依赖：

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

原因：AgentDock 的第一阶段会涉及 TypeScript 领域函数、React 默认收起状态、API 配置按工具类型分组、IPC 类型契约和安全脱敏逻辑；仅靠 `npm run typecheck` 不能证明行为正确。

如果用户不批准新增测试依赖，则只能退回到 `tsc` / build / 手工 UI 检查，但这会弱化 TDD，不推荐。

---

## 任务 1：建立应用测试框架

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 新建：`vitest.config.ts`
- 新建：`src/test/setup.ts`
- 新建：`tests/app/smoke.test.ts`

**步骤 1：确认依赖变更**

先请求用户确认允许新增 dev-only 测试依赖：

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

预期：用户确认后，才允许修改 `package.json` 和 `package-lock.json`。

**步骤 2：安装依赖**

执行：

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

预期：只新增 devDependencies，不改包管理器。

**步骤 3：新增测试脚本**

在 `package.json` 增加：

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

预期：`npm run test` 可以运行应用测试。

**步骤 4：新增最小 smoke test**

创建 `tests/app/smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

describe('AgentDock app test harness', () => {
  it('runs app tests', () => {
    expect('AgentDock').toContain('Dock');
  });
});
```

**步骤 5：运行测试**

```bash
npm run test
```

预期：PASS。

**步骤 6：提交**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts tests/app/smoke.test.ts
git commit -m "test: add app test harness"
```

---

## 任务 2：新增共享领域类型与密钥脱敏工具

**文件：**
- 新建：`src/shared/agentdockTypes.ts`
- 新建：`src/shared/secretPreview.ts`
- 新建：`tests/app/secretPreview.test.ts`

**步骤 1：先写失败测试**

创建 `tests/app/secretPreview.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { maskSecret, redactEnvironmentPreview } from '../../src/shared/secretPreview';

describe('secretPreview', () => {
  it('masks non-empty secrets without exposing the original value', () => {
    const masked = maskSecret('local-development-secret');

    expect(masked).toMatch(/^••••/);
    expect(masked).not.toContain('local-development-secret');
  });

  it('redacts sensitive environment values', () => {
    const preview = redactEnvironmentPreview({
      ANTHROPIC_BASE_URL: 'https://example.invalid/v1',
      ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
      CODEX_HOME: '/Users/example/.agentdock/codex-profiles/profile-a',
    });

    expect(preview.ANTHROPIC_BASE_URL).toBe('https://example.invalid/v1');
    expect(preview.ANTHROPIC_AUTH_TOKEN).not.toContain('local-development-secret');
    expect(preview.CODEX_HOME).toContain('profile-a');
  });
});
```

运行：

```bash
npm run test -- secretPreview
```

预期：FAIL，原因是目标文件和函数还不存在。

**步骤 2：实现领域类型**

创建 `src/shared/agentdockTypes.ts`：

```ts
export type ToolType = 'claude' | 'codex' | 'gemini' | 'opencode';

export type ApiProfile = {
  id: string;
  name: string;
  toolType: ToolType;
  baseUrl: string;
  defaultModel?: string;
  keychainService: string;
  keychainAccount: string;
  codexHome?: string;
};

export type Workspace = {
  id: string;
  name: string;
  path: string;
};

export type SessionStatus = 'starting' | 'running' | 'stopped' | 'failed';

export type AgentSession = {
  id: string;
  title: string;
  profileId: string;
  workspaceId: string;
  command: string;
  status: SessionStatus;
  startedAt: string;
};

export type LaunchRequest = {
  profileId: string;
  workspaceId: string;
  command: string;
};
```

**步骤 3：实现脱敏工具**

创建 `src/shared/secretPreview.ts`：

```ts
const SENSITIVE_ENV_NAMES = new Set([
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
]);

export function maskSecret(secret: string): string {
  if (secret.length === 0) {
    return '未设置';
  }

  const suffix = secret.slice(-3);
  return `••••••${suffix}`;
}

export function redactEnvironmentPreview(
  env: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      SENSITIVE_ENV_NAMES.has(key) ? maskSecret(value) : value,
    ]),
  );
}
```

**步骤 4：验证**

```bash
npm run test -- secretPreview
npm run typecheck
```

预期：PASS。

**步骤 5：提交**

```bash
git add src/shared/agentdockTypes.ts src/shared/secretPreview.ts tests/app/secretPreview.test.ts
git commit -m "feat: add secret-safe domain contracts"
```

---

## 任务 3：新增启动环境生成器

**文件：**
- 新建：`src/main/launchEnvironment.ts`
- 新建：`tests/app/launchEnvironment.test.ts`

**步骤 1：先写失败测试**

创建 `tests/app/launchEnvironment.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildLaunchEnvironment } from '../../src/main/launchEnvironment';
import type { ApiProfile } from '../../src/shared/agentdockTypes';

const baseProfile: ApiProfile = {
  id: 'profile-a',
  name: 'Claude A',
  toolType: 'claude',
  baseUrl: 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: 'profile-a',
};

describe('buildLaunchEnvironment', () => {
  it('builds isolated Claude environment variables', () => {
    const env = buildLaunchEnvironment({
      profile: baseProfile,
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/v1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-development-secret');
    expect(env.CODEX_HOME).toBeUndefined();
  });

  it('builds isolated Codex CODEX_HOME per profile', () => {
    const env = buildLaunchEnvironment({
      profile: { ...baseProfile, id: 'codex-openai', toolType: 'codex' },
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.OPENAI_BASE_URL).toBe('https://example.invalid/v1');
    expect(env.OPENAI_API_KEY).toBe('local-development-secret');
    expect(env.CODEX_HOME).toContain('codex-openai');
  });
});
```

运行：

```bash
npm run test -- launchEnvironment
```

预期：FAIL，原因是目标模块还不存在。

**步骤 2：实现最小环境生成器**

创建 `src/main/launchEnvironment.ts`：

```ts
import path from 'node:path';
import type { ApiProfile } from '../shared/agentdockTypes';

type BuildLaunchEnvironmentInput = {
  profile: ApiProfile;
  secret: string;
  appDataPath: string;
};

export function buildLaunchEnvironment({
  profile,
  secret,
  appDataPath,
}: BuildLaunchEnvironmentInput): Record<string, string> {
  if (profile.toolType === 'claude') {
    return {
      ANTHROPIC_BASE_URL: profile.baseUrl,
      ANTHROPIC_AUTH_TOKEN: secret,
    };
  }

  if (profile.toolType === 'codex') {
    return {
      OPENAI_BASE_URL: profile.baseUrl,
      OPENAI_API_KEY: secret,
      CODEX_HOME:
        profile.codexHome ??
        path.join(appDataPath, 'codex-profiles', profile.id),
    };
  }

  return {};
}
```

**步骤 3：运行测试和类型检查**

```bash
npm run test -- launchEnvironment
npm run typecheck
```

预期：PASS。

**步骤 4：安全检查点**

确认：

- 测试只使用明显的假 secret 字符串；
- 不提交任何看起来像真实 API Key 的 fixture；
- 环境变量预览脱敏逻辑与 PTY 实际注入逻辑分离。
- Codex 测试必须证明 endpoint 也按 Profile 隔离，即包含 `OPENAI_BASE_URL`。

**步骤 5：提交**

```bash
git add src/main/launchEnvironment.ts tests/app/launchEnvironment.test.ts
git commit -m "feat: build per-profile launch environments"
```

---

## 任务 4：新增 Keychain 与 PTY adapter 契约

**文件：**
- 新建：`src/main/adapters/keychainAdapter.ts`
- 新建：`src/main/adapters/ptyAdapter.ts`
- 新建：`tests/app/adapterContracts.test.ts`

**步骤 1：先写失败测试**

创建 `tests/app/adapterContracts.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createUnavailableKeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import { createUnavailablePtyAdapter } from '../../src/main/adapters/ptyAdapter';

describe('adapter contracts', () => {
  it('fails fast when keychain adapter is unavailable', async () => {
    const adapter = createUnavailableKeychainAdapter();

    await expect(adapter.readSecret('AgentDock', 'profile-a')).rejects.toThrow(
      /Keychain adapter is not available/,
    );
  });

  it('fails fast when pty adapter is unavailable', async () => {
    const adapter = createUnavailablePtyAdapter();

    await expect(
      adapter.spawn({
        sessionId: 'session-a',
        command: 'claude',
        cwd: '/tmp',
        env: {},
      }),
    ).rejects.toThrow(/PTY adapter is not available/);
  });
});
```

运行：

```bash
npm run test -- adapterContracts
```

预期：FAIL，原因是 adapter 文件还不存在。

**步骤 2：实现 Keychain 契约**

创建 `src/main/adapters/keychainAdapter.ts`：

```ts
export type KeychainAdapter = {
  readSecret(service: string, account: string): Promise<string>;
  writeSecret(service: string, account: string, secret: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<void>;
};

export function createUnavailableKeychainAdapter(): KeychainAdapter {
  const fail = async (): Promise<never> => {
    throw new Error('Keychain adapter is not available in Phase 1');
  };

  return {
    readSecret: fail,
    writeSecret: fail,
    deleteSecret: fail,
  };
}
```

**步骤 3：实现 PTY 契约**

创建 `src/main/adapters/ptyAdapter.ts`：

```ts
export type PtySpawnRequest = {
  sessionId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
};

export type PtySession = {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtyAdapter = {
  spawn(request: PtySpawnRequest): Promise<PtySession>;
};

export function createUnavailablePtyAdapter(): PtyAdapter {
  return {
    async spawn(): Promise<PtySession> {
      throw new Error('PTY adapter is not available in Phase 1');
    },
  };
}
```

**步骤 4：验证**

```bash
npm run test -- adapterContracts
npm run typecheck
```

预期：PASS。

**步骤 5：提交**

```bash
git add src/main/adapters/keychainAdapter.ts src/main/adapters/ptyAdapter.ts tests/app/adapterContracts.test.ts
git commit -m "feat: define keychain and pty adapters"
```

---

## 任务 5：新增 Profile 与 Workspace metadata 存储

**文件：**
- 新建：`src/main/stores/jsonStore.ts`
- 新建：`src/main/stores/profileStore.ts`
- 新建：`src/main/stores/workspaceStore.ts`
- 新建：`tests/app/metadataStores.test.ts`

**步骤 1：先写失败测试**

创建 `tests/app/metadataStores.test.ts`：

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore } from '../../src/main/stores/profileStore';
import { createWorkspaceStore } from '../../src/main/stores/workspaceStore';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('metadata stores', () => {
  it('saves profile metadata without secret values', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://example.invalid/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    });

    const profiles = await store.list();

    expect(profiles).toHaveLength(1);
    expect(JSON.stringify(profiles)).not.toContain('local-development-secret');
  });

  it('saves workspace metadata by local path', async () => {
    const store = createWorkspaceStore(tempDir);

    await store.save({
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
    ]);
  });
});
```

运行：

```bash
npm run test -- metadataStores
```

预期：FAIL，原因是 store 模块还不存在。

**步骤 2：实现 JSON store 与具体 store**

实现保持简单：

- 文件不存在时创建；
- 使用格式化 JSON 写入；
- JSON 无效时 fail fast；
- Profile metadata 不允许出现 API key 明文字段。

**步骤 3：验证**

```bash
npm run test -- metadataStores
npm run typecheck
```

预期：PASS。

**步骤 4：提交**

```bash
git add src/main/stores tests/app/metadataStores.test.ts
git commit -m "feat: persist profile and workspace metadata"
```

---

## 任务 6：新增类型化 preload IPC 接口

**文件：**
- 修改：`src/preload/preload.ts`
- 新建：`src/shared/preloadTypes.ts`
- 修改：`src/renderer/App.tsx` 或新建 `src/renderer/types/global.d.ts`
- 新建：`tests/app/preloadTypes.test.ts`

**步骤 1：先写类型 / 行为测试**

只测试导出的契约形状，不调用真实 Electron IPC；契约不得包含完整 secret 或完整 env：

```ts
import { describe, expect, it } from 'vitest';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

describe('preloadTypes', () => {
  it('documents required renderer API methods', () => {
    const methodNames = [
      'listProfiles',
      'listWorkspaces',
      'launchSession',
      'listSessions',
    ] satisfies Array<keyof AgentDockApi>;

    expect(methodNames).toEqual([
      'listProfiles',
      'listWorkspaces',
      'launchSession',
      'listSessions',
    ]);
  });

  it('does not expose full secrets or full environment snapshots through the renderer API', () => {
    const allowedMethodNames = [
      'version',
      'listProfiles',
      'listWorkspaces',
      'launchSession',
      'listSessions',
    ] satisfies Array<keyof AgentDockApi>;

    expect(allowedMethodNames).not.toContain('readSecret');
    expect(allowedMethodNames).not.toContain('getEnv');
    expect(allowedMethodNames).not.toContain('listEnvironment');
  });
});
```

预期：FAIL，原因是 `AgentDockApi` 还不存在。

**步骤 2：定义 preload API 类型**

创建 `src/shared/preloadTypes.ts`：

```ts
import type { AgentSession, ApiProfile, LaunchRequest, Workspace } from './agentdockTypes';

export type AgentDockApi = {
  version: string;
  listProfiles(): Promise<ApiProfile[]>;
  listWorkspaces(): Promise<Workspace[]>;
  launchSession(request: LaunchRequest): Promise<AgentSession>;
  listSessions(): Promise<AgentSession[]>;
};
```

注意：`AgentDockApi` 不允许新增返回完整 secret 或完整 env 的方法。若后续需要展示环境信息，必须设计为脱敏后的 preview 类型。

**步骤 3：安全暴露占位 API**

修改 `src/preload/preload.ts`，让渲染进程拿到受控方法，不启用 Node access，也不暴露 secret：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { AgentDockApi } from '../shared/preloadTypes';

const api: AgentDockApi = {
  version: '0.1.0',
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  launchSession: (request) => ipcRenderer.invoke('sessions:launch', request),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
};

contextBridge.exposeInMainWorld('agentDock', api);
```

**步骤 4：主进程 IPC handler 放到后续任务**

本任务不调用真实 Keychain / PTY。

**步骤 5：验证**

```bash
npm run test -- preloadTypes
npm run typecheck
```

预期：Renderer 全局类型声明完成后 PASS。

**步骤 6：提交**

```bash
git add src/preload/preload.ts src/shared/preloadTypes.ts src/renderer/types tests/app/preloadTypes.test.ts
git commit -m "feat: define renderer preload API"
```

---

## 任务 7：将渲染层拆成终端优先组件

**文件：**
- 修改：`src/renderer/App.tsx`
- 新建：`src/renderer/components/AppHeader.tsx`
- 新建：`src/renderer/components/CommandBar.tsx`
- 新建：`src/renderer/components/SessionTabs.tsx`
- 新建：`src/renderer/components/TerminalPane.tsx`
- 新建：`src/renderer/components/SessionDetailsDrawer.tsx`
- 新建：`src/renderer/components/ApiConfigPanel.tsx`
- 修改：`src/renderer/styles.css`
- 新建：`tests/app/App.test.tsx`

**步骤 1：先写失败 UI 测试**

创建 `tests/app/App.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/renderer/App';

describe('AgentDock shell', () => {
  it('renders terminal-first launch controls', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /新建会话/ })).toBeInTheDocument();
    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.getByLabelText('运行中的会话')).toBeInTheDocument();
  });

  it('keeps current session details collapsed by default', () => {
    render(<App />);

    expect(screen.queryByText(/Keychain 位置/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /会话详情/ })).toBeInTheDocument();
  });

  it('groups API configs by tool type', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
  });
});
```

预期：FAIL，直到组件拆分、导出和测试 setup 完成。

**步骤 2：重构 App 导出**

让 `App.tsx` 单独导出 `App`，同时保留底部 root rendering；也可以在后续任务中把 bootstrap 移到 `src/renderer/main.tsx`。

**步骤 3：创建职责单一组件**

每个组件文件默认不超过 200 行。第一阶段只使用本地 sample data，不持久化 secret，不调用真实 API。

**步骤 4：实现会话详情默认收起**

默认状态：

```ts
const [detailsOpen, setDetailsOpen] = React.useState(false);
```

只有展开后才展示 endpoint / keychain metadata，并且 key 预览必须始终是脱敏值。

**步骤 5：运行 UI 测试和构建**

```bash
npm run test -- App
npm run typecheck
npm run build
```

预期：PASS。

**步骤 6：提交**

```bash
git add src/renderer tests/app/App.test.tsx
git commit -m "feat: build terminal-first renderer shell"
```

---

## 任务 8：新增主进程内存会话编排

**文件：**
- 新建：`src/main/sessionService.ts`
- 修改：`src/main/main.ts`
- 新建：`tests/app/sessionService.test.ts`

**步骤 1：先写失败服务测试**

创建 `tests/app/sessionService.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';

describe('sessionService', () => {
  it('creates a session record without spawning PTY in Phase 1', async () => {
    const service = createSessionService({
      now: () => new Date('2026-07-01T00:00:00.000Z'),
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(session.status).toBe('starting');
    expect(session.title).toContain('Claude A');
  });
});
```

预期：FAIL，原因是服务还不存在。

**步骤 2：实现 session service**

只实现内存 service。不启动 PTY，不读取 Keychain。返回 `starting` 或 `failed`，错误信息必须安全，不包含 secret。

**步骤 3：注册 IPC handlers**

在 `src/main/main.ts` 注册 `profiles:list`、`workspaces:list`、`sessions:list`、`sessions:launch`。可以先使用 sample data 或 metadata store。返回 payload 不得包含完整 secret，也不得包含完整环境变量对象。

**步骤 4：验证**

```bash
npm run test -- sessionService
npm run typecheck
npm run build
```

预期：PASS。

**步骤 5：提交**

```bash
git add src/main/main.ts src/main/sessionService.ts tests/app/sessionService.test.ts
git commit -m "feat: add phase one session orchestration"
```

---

## 任务 9：更新工作流状态并执行集成验证

**文件：**
- 修改：`.agent-workflow/state.md`
- 新建：`.agent-workflow/verification/2026-07-01-agentdock-phase-1-mvp-foundation.md`

**步骤 1：运行完整验证**

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run typecheck
npm run build
git status --short --branch
```

预期：

- workflow doctor PASS；
- workflow tests PASS；
- app tests PASS；
- typecheck PASS；
- build PASS；
- UI 测试覆盖当前会话详情默认收起和 API 配置按工具类型分组；
- IPC/Renderer 测试覆盖不返回完整 secret 或完整 env；
- launch environment 测试覆盖 Codex endpoint 隔离；
- 提交前 `git status` 只包含预期文件，提交后 clean。

**步骤 2：记录验证报告**

创建验证报告，必须包含：

- 精确命令；
- 实际输出；
- L3 说明：真实 PTY / Keychain 验证延期到第二阶段；
- 安全说明：本阶段没有使用或提交真实 API Key。

**步骤 3：更新 state**

设置：

- 当前任务：AgentDock Phase 1 MVP Foundation
- 风险等级：L3
- 当前 Hook：根据完成状态设为 `integration_hook` 或 `delivery_hook`
- 当前阶段：`phase-1-verified`
- 用户待确认：Phase 2 真实 PTY / Keychain 集成范围

**步骤 4：提交**

```bash
git add .agent-workflow/state.md .agent-workflow/verification/2026-07-01-agentdock-phase-1-mvp-foundation.md
git commit -m "docs: record phase one verification"
```

---

## 宣称第一阶段完成前必须运行的验证

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run typecheck
npm run build
```

只有刚运行并检查过这些命令输出后，才能说第一阶段完成。

## 第二阶段交接预览

第一阶段验收通过后，第二阶段再处理真实高风险集成：

1. macOS Keychain adapter：优先评估 `keytar`，因为它已在 optionalDependencies 中。
2. `node-pty` adapter：用于真实终端会话。
3. xterm.js 与真实 PTY output / input / resize 绑定。
4. Claude / Codex 真实会话隔离验证：
   - 不同 Claude 会话使用不同 endpoint；
   - 不同 secret 只注入各自 PTY；
   - Codex 每个 Profile 使用独立 `CODEX_HOME`；
   - 验证 Ctrl+C、resize、长文本粘贴、中文输入。
