# AgentDock Phase 1 MVP Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first safe, testable AgentDock MVP foundation: typed Profile/Workspace/Session contracts, secret-safe launch environment generation, IPC/preload boundaries, and the terminal-first renderer shell.

**Architecture:** Phase 1 should create the contract and UI foundation before connecting real `node-pty` and macOS Keychain operations. The main process owns metadata, launch environment generation, and future adapters; the renderer only receives redacted metadata and sends typed launch requests through preload IPC. Real PTY/Keychain wiring remains Phase 2 so Phase 1 can be TDD-driven without handling real secrets.

**Tech Stack:** Electron + React + TypeScript + Vite + xterm.js CSS, npm. Recommended test addition: Vitest + jsdom + React Testing Library as dev-only dependencies, pending user confirmation.

---

## Phase 1 Scope

### Build now

- Profile / Workspace / Session TypeScript domain types.
- Secret redaction helpers and environment preview helpers.
- Claude and Codex launch environment builders.
- Adapter interfaces for Keychain and PTY without real native implementation.
- Main/preload IPC contracts for listing profiles/workspaces and launching a session.
- Renderer split into focused components matching the accepted v3b terminal-first UI.
- Current session details collapsed by default.
- API config UI skeleton grouped by tool type: Claude / Codex / Gemini / OpenCode / 全部.

### Do not build in Phase 1

- Real `node-pty` session spawning.
- Real macOS Keychain read/write.
- Connection testing to external providers.
- Cost statistics, request logs, API gateway, routing, fallback.
- Complex dashboard, IDE, diff viewer, or split panes.

### Open decision before coding

Phase 1 TDD needs a JavaScript/React test runner. The current repo only has Python workflow tests and TypeScript build checks.

Recommended: add dev-only dependencies:

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Why: app behavior involves TypeScript domain functions and React UI states; `npm run typecheck` alone cannot prove behavior.

If dependency additions are not approved, fall back to `tsc`/build-only verification and manual UI checks, but that is weaker and does not satisfy strong TDD as well.

---

## Task 1: Add app test harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `tests/app/smoke.test.ts`

**Step 1: Confirm dependency decision**

Ask the user to confirm adding dev-only test dependencies:

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: user confirms before changing `package.json` / `package-lock.json`.

**Step 2: Install dependencies**

Run:

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: `package.json` and `package-lock.json` update with dev dependencies only.

**Step 3: Add test scripts**

Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Expected: `npm run test` exists and can run app tests.

**Step 4: Add minimal failing smoke test**

Create `tests/app/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('AgentDock app test harness', () => {
  it('runs app tests', () => {
    expect('AgentDock').toContain('Dock');
  });
});
```

**Step 5: Run test**

Run:

```bash
npm run test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts tests/app/smoke.test.ts
git commit -m "test: add app test harness"
```

---

## Task 2: Add shared domain contracts and secret redaction

**Files:**
- Create: `src/shared/agentdockTypes.ts`
- Create: `src/shared/secretPreview.ts`
- Create: `tests/app/secretPreview.test.ts`

**Step 1: Write failing tests**

Create `tests/app/secretPreview.test.ts`:

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

Run:

```bash
npm run test -- secretPreview
```

Expected: FAIL because files/functions do not exist.

**Step 2: Implement domain types**

Create `src/shared/agentdockTypes.ts`:

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

**Step 3: Implement redaction**

Create `src/shared/secretPreview.ts`:

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

**Step 4: Run tests**

```bash
npm run test -- secretPreview
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/agentdockTypes.ts src/shared/secretPreview.ts tests/app/secretPreview.test.ts
git commit -m "feat: add secret-safe domain contracts"
```

---

## Task 3: Add launch environment builder

**Files:**
- Create: `src/main/launchEnvironment.ts`
- Create: `tests/app/launchEnvironment.test.ts`

**Step 1: Write failing tests**

Create `tests/app/launchEnvironment.test.ts`:

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

    expect(env.OPENAI_API_KEY).toBe('local-development-secret');
    expect(env.CODEX_HOME).toContain('codex-openai');
  });
});
```

Run:

```bash
npm run test -- launchEnvironment
```

Expected: FAIL because module does not exist.

**Step 2: Implement minimal environment builder**

Create `src/main/launchEnvironment.ts`:

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
      OPENAI_API_KEY: secret,
      CODEX_HOME:
        profile.codexHome ??
        path.join(appDataPath, 'codex-profiles', profile.id),
    };
  }

  return {};
}
```

**Step 3: Run tests and typecheck**

```bash
npm run test -- launchEnvironment
npm run typecheck
```

Expected: PASS.

**Step 4: Security review checkpoint**

Confirm:

- tests use fake non-key strings only;
- no key-like fixture is committed;
- preview redaction is separate from PTY environment generation.

**Step 5: Commit**

```bash
git add src/main/launchEnvironment.ts tests/app/launchEnvironment.test.ts
git commit -m "feat: build per-profile launch environments"
```

---

## Task 4: Add adapter contracts for Keychain and PTY

**Files:**
- Create: `src/main/adapters/keychainAdapter.ts`
- Create: `src/main/adapters/ptyAdapter.ts`
- Create: `tests/app/adapterContracts.test.ts`

**Step 1: Write failing tests**

Create `tests/app/adapterContracts.test.ts`:

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

Run:

```bash
npm run test -- adapterContracts
```

Expected: FAIL because adapters do not exist.

**Step 2: Implement Keychain contract**

Create `src/main/adapters/keychainAdapter.ts`:

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

**Step 3: Implement PTY contract**

Create `src/main/adapters/ptyAdapter.ts`:

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

**Step 4: Run tests**

```bash
npm run test -- adapterContracts
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/adapters/keychainAdapter.ts src/main/adapters/ptyAdapter.ts tests/app/adapterContracts.test.ts
git commit -m "feat: define keychain and pty adapters"
```

---

## Task 5: Add metadata stores for profiles and workspaces

**Files:**
- Create: `src/main/stores/jsonStore.ts`
- Create: `src/main/stores/profileStore.ts`
- Create: `src/main/stores/workspaceStore.ts`
- Create: `tests/app/metadataStores.test.ts`

**Step 1: Write failing tests**

Create `tests/app/metadataStores.test.ts`:

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

Run:

```bash
npm run test -- metadataStores
```

Expected: FAIL because stores do not exist.

**Step 2: Implement JSON store and specific stores**

Keep implementation simple:

- create file if missing;
- write pretty JSON;
- fail fast on invalid JSON;
- no API key field in profile metadata.

**Step 3: Run tests**

```bash
npm run test -- metadataStores
npm run typecheck
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/main/stores tests/app/metadataStores.test.ts
git commit -m "feat: persist profile and workspace metadata"
```

---

## Task 6: Add typed preload IPC surface

**Files:**
- Modify: `src/preload/preload.ts`
- Create: `src/shared/preloadTypes.ts`
- Modify: `src/renderer/App.tsx` or create `src/renderer/types/global.d.ts`
- Create: `tests/app/preloadTypes.test.ts`

**Step 1: Write failing type/behavior tests**

Test the exported contract shape without invoking real Electron IPC:

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
});
```

Expected: FAIL because `AgentDockApi` does not exist.

**Step 2: Define preload API type**

Create `src/shared/preloadTypes.ts`:

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

**Step 3: Expose placeholder API safely**

Modify `src/preload/preload.ts` so renderer receives methods but no Node access and no secrets:

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

**Step 4: Add main IPC handlers in a later task**

Do not call real Keychain/PTy yet.

**Step 5: Run checks**

```bash
npm run test -- preloadTypes
npm run typecheck
```

Expected: PASS after renderer global type is declared.

**Step 6: Commit**

```bash
git add src/preload/preload.ts src/shared/preloadTypes.ts src/renderer/types tests/app/preloadTypes.test.ts
git commit -m "feat: define renderer preload API"
```

---

## Task 7: Split renderer into terminal-first components

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/AppHeader.tsx`
- Create: `src/renderer/components/CommandBar.tsx`
- Create: `src/renderer/components/SessionTabs.tsx`
- Create: `src/renderer/components/TerminalPane.tsx`
- Create: `src/renderer/components/SessionDetailsDrawer.tsx`
- Create: `src/renderer/components/ApiConfigPanel.tsx`
- Modify: `src/renderer/styles.css`
- Create: `tests/app/App.test.tsx`

**Step 1: Write failing UI tests**

Create `tests/app/App.test.tsx`:

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

Expected: FAIL until components/export/test setup are ready.

**Step 2: Refactor App export**

Change `App.tsx` to export `App` separately and keep root rendering at bottom or move bootstrap to `src/renderer/main.tsx` in a follow-up.

**Step 3: Create focused components**

Keep each file under 200 lines. Use local sample data only. Do not persist secrets or call real APIs yet.

**Step 4: Implement collapsed details state**

Default:

```ts
const [detailsOpen, setDetailsOpen] = React.useState(false);
```

Only show endpoint/keychain metadata when expanded, and always show masked key preview.

**Step 5: Run UI tests and build**

```bash
npm run test -- App
npm run typecheck
npm run build
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/renderer tests/app/App.test.tsx
git commit -m "feat: build terminal-first renderer shell"
```

---

## Task 8: Add main-process in-memory session orchestration

**Files:**
- Create: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Create: `tests/app/sessionService.test.ts`

**Step 1: Write failing service tests**

Create `tests/app/sessionService.test.ts`:

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

Expected: FAIL because service does not exist.

**Step 2: Implement session service**

Create an in-memory service only. Do not spawn PTY. Do not read Keychain. Return `starting` or `failed` with safe error messages.

**Step 3: Register IPC handlers**

In `src/main/main.ts`, register `profiles:list`, `workspaces:list`, `sessions:list`, and `sessions:launch` with sample data or metadata stores. Keep secret values out of returned payloads.

**Step 4: Run checks**

```bash
npm run test -- sessionService
npm run typecheck
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/main/main.ts src/main/sessionService.ts tests/app/sessionService.test.ts
git commit -m "feat: add phase one session orchestration"
```

---

## Task 9: Update workflow state and perform integration verification

**Files:**
- Modify: `.agent-workflow/state.md`
- Create: `.agent-workflow/verification/2026-07-01-agentdock-phase-1-mvp-foundation.md`

**Step 1: Run full verification**

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run typecheck
npm run build
git status --short --branch
```

Expected:

- workflow doctor PASS;
- workflow tests PASS;
- app tests PASS;
- typecheck PASS;
- build PASS;
- git status contains only intended files before commit, then clean after commit.

**Step 2: Record verification**

Create verification report with:

- exact commands;
- actual outputs;
- L3 note that real PTY/Keychain verification is deferred to Phase 2;
- security note that no real API key was used or committed.

**Step 3: Update state**

Set:

- 当前任务: AgentDock Phase 1 MVP Foundation
- 风险等级: L3
- 当前 Hook: integration_hook or delivery_hook depending on completion status
- 当前阶段: phase-1-verified
- 用户待确认: Phase 2 real PTY/Keychain integration scope

**Step 4: Commit**

```bash
git add .agent-workflow/state.md .agent-workflow/verification/2026-07-01-agentdock-phase-1-mvp-foundation.md
git commit -m "docs: record phase one verification"
```

---

## Required verification before claiming Phase 1 complete

```bash
npm run workflow:doctor
npm run test:workflow
npm run test
npm run typecheck
npm run build
```

Do not say Phase 1 is complete unless the commands above were run and their outputs were inspected.

## Phase 2 handoff preview

After Phase 1 is accepted and verified, Phase 2 should implement the real high-risk integrations:

1. macOS Keychain adapter, probably `keytar` first because it is already listed as optional dependency.
2. `node-pty` adapter for real terminal sessions.
3. Real xterm.js terminal binding to PTY output/input/resize.
4. True Claude/Codex launch verification:
   - different Claude endpoints per session;
   - different secret values injected only into each PTY;
   - per-profile `CODEX_HOME`;
   - Ctrl+C, resize, paste, Chinese input checks.

