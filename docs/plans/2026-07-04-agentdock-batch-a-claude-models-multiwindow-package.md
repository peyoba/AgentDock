# AgentDock Batch A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Claude model mapping, multi-window session isolation, and timestamped macOS packaging without expanding Codex model behavior.

**Architecture:** Keep Profile/Workspace/Secret stores shared in the Electron main process, but move PTY SessionService ownership to each BrowserWindow. Extend Claude profile metadata with focused model mapping fields, normalize them through existing profile migration/sanitization boundaries, and write non-secret model mapping into Claude launch env/settings.

**Tech Stack:** Electron + React + TypeScript + Vite + xterm.js + node-pty + Vitest + npm + electron-packager.

---

## File Structure

- `src/shared/agentdockTypes.ts`: add `ClaudeDefaultLaunchMode` and Claude model mapping fields on `ApiProfile`.
- `src/shared/claudeProfileDefaults.ts`: own AnyRouter Claude model constants, launch mode normalization, legacy `opus[1m]` cleanup, and default model mapping.
- `src/shared/defaultApiProfiles.ts`: use the updated AnyRouter Claude defaults.
- `src/main/stores/configMigration.ts`: migrate old profiles into the new model mapping shape.
- `src/main/stores/profileStore.ts`: whitelist and persist model mapping fields.
- `src/main/launchEnvironment.ts`: add Claude non-secret model env variables.
- `src/main/sessionService.ts`: write Claude settings `model` and `alwaysThinkingEnabled` from normalized profile fields.
- `src/main/sessionService.ts`: add `dispose()` so a closing window kills only that window's PTY sessions and output listeners.
- `src/main/windowSessionRegistry.ts`: new main-process helper that maps `webContents.id` to a per-window SessionService.
- `src/main/main.ts`: create per-window services, route terminal/session IPC by sender window, broadcast metadata changes, add new-window entry.
- `src/preload/preload.cts` and `src/shared/preloadTypes.ts`: expose metadata-change subscription and `openNewWindow`.
- `src/renderer/App.tsx`: refresh profile/workspace metadata when another window changes it; pass new-window action to header.
- `src/renderer/components/AppHeader.tsx`: add “新窗口” button.
- `src/renderer/components/ApiConfigPanel.tsx`: add Claude model mapping editor; keep Codex model UI unchanged.
- `src/renderer/styles.css`: style model mapping section and new-window button.
- `scripts/package-mac.mjs`: new packaging script that builds timestamped output and signs the resulting App.
- `package.json`: replace inline `package:mac` with `node scripts/package-mac.mjs`.
- `tests/app/**`: add/extend tests per task below.
- `.agent-workflow/state.md` and `.agent-workflow/verification/**`: update workflow status and verification record during execution.

---

## Task 1: Shared Claude Model Mapping Types and Defaults

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/claudeProfileDefaults.ts`
- Modify: `src/shared/defaultApiProfiles.ts`
- Modify: `tests/app/defaultApiProfiles.test.ts`
- Modify: `tests/app/configMigration.test.ts`
- Modify: `tests/app/metadataStores.test.ts`

- [ ] **Step 1: Write failing tests for AnyRouter Claude model mapping defaults**

Update `tests/app/defaultApiProfiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultApiProfiles, isDefaultApiProfileId } from '../../src/shared/defaultApiProfiles';

describe('default API profiles', () => {
  it('starts Claude AnyRouter with explicit Claude model mapping defaults', () => {
    const claudeProfile = defaultApiProfiles.find((profile) => profile.toolType === 'claude');

    expect(claudeProfile).toMatchObject({
      id: 'claude-anyrouter',
      defaultModel: 'claude-opus-4-8',
      claudeHaikuModel: 'claude-haiku-4-5-20251001',
      claudeSonnetModel: 'claude-fable-5',
      claudeOpusModel: 'claude-opus-4-8',
      claudeDefaultLaunchMode: 'default',
    });
    expect(claudeProfile?.defaultModel).not.toBe('opus[1m]');
    expect(claudeProfile?.availableModels).toBeUndefined();
  });

  it('keeps bundled profile ids protected defaults', () => {
    expect(isDefaultApiProfileId('claude-anyrouter')).toBe(true);
    expect(isDefaultApiProfileId('codex-openai')).toBe(true);
    expect(isDefaultApiProfileId('claude-custom-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test -- tests/app/defaultApiProfiles.test.ts
```

Expected: FAIL because `claudeHaikuModel`, `claudeSonnetModel`, `claudeOpusModel`, and `claudeDefaultLaunchMode` do not exist yet, and the current main model is still `claude-fable-5`.

- [ ] **Step 3: Add shared types and defaults**

Update `src/shared/agentdockTypes.ts`:

```ts
export type ClaudeDefaultLaunchMode = 'default' | 'opus' | 'sonnet' | 'haiku' | 'custom';

export type ApiProfile = {
  id: string;
  name: string;
  toolType: ToolType;
  baseUrl: string;
  defaultModel?: string;
  availableModels?: string[];
  keychainService: string;
  keychainAccount: string;
  codexHome?: string;
  skipPermissions?: boolean;
  bypassApprovals?: boolean;
  claudeCodeRetryWatchdog?: boolean;
  claudeCodeMaxRetries?: number;
  anthropicBetas?: string;
  httpProxy?: string;
  httpsProxy?: string;
  claudeCodeDisableNonessentialTraffic?: boolean;
  claudeCodeAttributionHeader?: string;
  disableInstallationChecks?: boolean;
  claudeCleanupPeriodDays?: number;
  claudeDefaultLaunchMode?: ClaudeDefaultLaunchMode;
  claudeHaikuModel?: string;
  claudeSonnetModel?: string;
  claudeOpusModel?: string;
  claudeAlwaysThinkingEnabled?: boolean;
};
```

Update `src/shared/claudeProfileDefaults.ts` with these exported constants and helpers:

```ts
export const ANYROUTER_CLAUDE_PRIMARY_MODEL = 'claude-opus-4-8';
export const ANYROUTER_CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const ANYROUTER_CLAUDE_SONNET_MODEL = 'claude-fable-5';
export const ANYROUTER_CLAUDE_OPUS_MODEL = 'claude-opus-4-8';
export const ANYROUTER_CLAUDE_DEFAULT_MODEL = ANYROUTER_CLAUDE_PRIMARY_MODEL;
export const ANYROUTER_CLAUDE_BETA = 'context-1m-2025-08-07';

const CLAUDE_LAUNCH_MODES = new Set(['default', 'opus', 'sonnet', 'haiku', 'custom']);

function normalizeClaudeDefaultLaunchMode(
  value: ApiProfile['claudeDefaultLaunchMode'],
): ApiProfile['claudeDefaultLaunchMode'] {
  return value && CLAUDE_LAUNCH_MODES.has(value) ? value : 'default';
}

function defaultClaudeModelMapping(
  profile: ApiProfile,
  useAnyRouterDefaults: boolean,
): Pick<
  ApiProfile,
  'defaultModel' | 'claudeHaikuModel' | 'claudeSonnetModel' | 'claudeOpusModel' | 'claudeDefaultLaunchMode'
> {
  if (!useAnyRouterDefaults) {
    return {
      defaultModel: defaultSelectableClaudeModel(profile.defaultModel, profile.availableModels ?? [], false),
      claudeHaikuModel: optionalTrimmedString(profile.claudeHaikuModel),
      claudeSonnetModel: optionalTrimmedString(profile.claudeSonnetModel),
      claudeOpusModel: optionalTrimmedString(profile.claudeOpusModel),
      claudeDefaultLaunchMode: normalizeClaudeDefaultLaunchMode(profile.claudeDefaultLaunchMode),
    };
  }

  return {
    defaultModel: defaultSelectableClaudeModel(
      profile.defaultModel,
      selectableClaudeModels(profile.availableModels),
      true,
    ),
    claudeHaikuModel: optionalTrimmedString(profile.claudeHaikuModel) ?? ANYROUTER_CLAUDE_HAIKU_MODEL,
    claudeSonnetModel: optionalTrimmedString(profile.claudeSonnetModel) ?? ANYROUTER_CLAUDE_SONNET_MODEL,
    claudeOpusModel: optionalTrimmedString(profile.claudeOpusModel) ?? ANYROUTER_CLAUDE_OPUS_MODEL,
    claudeDefaultLaunchMode: normalizeClaudeDefaultLaunchMode(profile.claudeDefaultLaunchMode),
  };
}
```

Then update `normalizeClaudeProfileDefaults(profile)` to spread the returned model mapping:

```ts
const modelMapping = defaultClaudeModelMapping(profile, useAnyRouterDefaults);

return {
  ...profile,
  ...modelMapping,
  availableModels: availableModels && availableModels.length > 0 ? availableModels : undefined,
  anthropicBetas,
  httpProxy,
  httpsProxy,
};
```

- [ ] **Step 4: Update default profile constants**

Update `src/shared/defaultApiProfiles.ts`:

```ts
import {
  ANYROUTER_CLAUDE_BETA,
  ANYROUTER_CLAUDE_HAIKU_MODEL,
  ANYROUTER_CLAUDE_OPUS_MODEL,
  ANYROUTER_CLAUDE_PRIMARY_MODEL,
  ANYROUTER_CLAUDE_SONNET_MODEL,
} from './claudeProfileDefaults.js';

// inside claude-anyrouter:
defaultModel: ANYROUTER_CLAUDE_PRIMARY_MODEL,
claudeHaikuModel: ANYROUTER_CLAUDE_HAIKU_MODEL,
claudeSonnetModel: ANYROUTER_CLAUDE_SONNET_MODEL,
claudeOpusModel: ANYROUTER_CLAUDE_OPUS_MODEL,
claudeDefaultLaunchMode: 'default',
```

- [ ] **Step 5: Run GREEN for default profile tests**

Run:

```bash
npm run test -- tests/app/defaultApiProfiles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add migration/store tests for model mapping**

Update `tests/app/configMigration.test.ts` with:

```ts
it('migrates AnyRouter Claude profiles to explicit Claude model mapping defaults', () => {
  const profile = {
    __version: 4,
    id: 'claude-anyrouter',
    name: 'Claude · AnyRouter A',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.top',
    defaultModel: 'opus[1m]',
    availableModels: ['opus[1m]', 'claude-fable-5', 'claude-opus-4-7'],
    keychainService: 'AgentDock',
    keychainAccount: 'claude-anyrouter',
  };

  const migrated = migrateProfile(profile);

  expect(migrated.defaultModel).toBe('claude-opus-4-8');
  expect(migrated.claudeHaikuModel).toBe('claude-haiku-4-5-20251001');
  expect(migrated.claudeSonnetModel).toBe('claude-fable-5');
  expect(migrated.claudeOpusModel).toBe('claude-opus-4-8');
  expect(migrated.claudeDefaultLaunchMode).toBe('default');
  expect(migrated.availableModels).toEqual(['claude-fable-5', 'claude-opus-4-7']);
});
```

Update `tests/app/metadataStores.test.ts` expected sanitized profile to include:

```ts
defaultModel: 'claude-opus-4-8',
claudeHaikuModel: 'claude-haiku-4-5-20251001',
claudeSonnetModel: 'claude-fable-5',
claudeOpusModel: 'claude-opus-4-8',
claudeDefaultLaunchMode: 'default',
```

- [ ] **Step 7: Run migration/store tests to verify RED**

Run:

```bash
npm run test -- tests/app/configMigration.test.ts tests/app/metadataStores.test.ts
```

Expected: FAIL until `configMigration.ts` and `profileStore.ts` copy the new fields.

- [ ] **Step 8: Persist model mapping in migration and store sanitization**

Update `src/main/stores/configMigration.ts` wherever `ApiProfile` is reconstructed to include:

```ts
claudeDefaultLaunchMode: profile.claudeDefaultLaunchMode as ApiProfile['claudeDefaultLaunchMode'],
claudeHaikuModel: profile.claudeHaikuModel as string | undefined,
claudeSonnetModel: profile.claudeSonnetModel as string | undefined,
claudeOpusModel: profile.claudeOpusModel as string | undefined,
claudeAlwaysThinkingEnabled: profile.claudeAlwaysThinkingEnabled as boolean | undefined,
```

Update `src/main/stores/profileStore.ts` `sanitizeProfile()` to whitelist:

```ts
if (normalizedProfile.claudeDefaultLaunchMode) {
  sanitized.claudeDefaultLaunchMode = normalizedProfile.claudeDefaultLaunchMode;
}
if (normalizedProfile.claudeHaikuModel) {
  sanitized.claudeHaikuModel = normalizedProfile.claudeHaikuModel;
}
if (normalizedProfile.claudeSonnetModel) {
  sanitized.claudeSonnetModel = normalizedProfile.claudeSonnetModel;
}
if (normalizedProfile.claudeOpusModel) {
  sanitized.claudeOpusModel = normalizedProfile.claudeOpusModel;
}
if (typeof normalizedProfile.claudeAlwaysThinkingEnabled === 'boolean') {
  sanitized.claudeAlwaysThinkingEnabled = normalizedProfile.claudeAlwaysThinkingEnabled;
}
```

Update `src/main/main.ts` `sanitizeProfile()` with the same whitelist fields.

- [ ] **Step 9: Run migration/store tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/configMigration.test.ts tests/app/metadataStores.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/shared/agentdockTypes.ts src/shared/claudeProfileDefaults.ts src/shared/defaultApiProfiles.ts src/main/stores/configMigration.ts src/main/stores/profileStore.ts src/main/main.ts tests/app/defaultApiProfiles.test.ts tests/app/configMigration.test.ts tests/app/metadataStores.test.ts
git commit -m "feat: add Claude model mapping metadata"
```

---

## Task 2: Claude Launch Environment and Settings Mapping

**Files:**
- Modify: `src/main/launchEnvironment.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `tests/app/launchEnvironment.test.ts`
- Modify: `tests/app/sessionService.test.ts`

- [ ] **Step 1: Write failing launch environment tests**

Add to `tests/app/launchEnvironment.test.ts`:

```ts
it('adds Claude model mapping environment variables without exposing them for Codex', () => {
  const env = buildLaunchEnvironment({
    profile: {
      ...baseProfile,
      defaultModel: 'claude-opus-4-8',
      claudeHaikuModel: 'claude-haiku-4-5-20251001',
      claudeSonnetModel: 'claude-fable-5',
      claudeOpusModel: 'claude-opus-4-8',
    },
    secret: 'local-development-secret',
    appDataPath: '/Users/example/Library/Application Support/AgentDock',
  });

  expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-8');
  expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-haiku-4-5-20251001');
  expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-fable-5');
  expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
});

it('does not add Claude model mapping variables to Codex environment', () => {
  const env = buildLaunchEnvironment({
    profile: {
      ...baseProfile,
      id: 'codex-openai',
      toolType: 'codex',
      defaultModel: 'gpt-5-codex',
      claudeHaikuModel: 'claude-haiku-4-5-20251001',
      claudeSonnetModel: 'claude-fable-5',
      claudeOpusModel: 'claude-opus-4-8',
    },
    secret: 'local-development-secret',
    appDataPath: '/Users/example/Library/Application Support/AgentDock',
  });

  expect(env.ANTHROPIC_MODEL).toBeUndefined();
  expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
  expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
});
```

- [ ] **Step 2: Run launch env tests to verify RED**

Run:

```bash
npm run test -- tests/app/launchEnvironment.test.ts
```

Expected: FAIL because model mapping env variables are not implemented.

- [ ] **Step 3: Implement non-secret Claude model env**

Update `src/main/launchEnvironment.ts`:

```ts
function buildClaudeModelEnvironment(profile: ApiProfile): Record<string, string> {
  const env: Record<string, string> = {};
  const primaryModel = optionalTrimmedString(profile.defaultModel);
  const haikuModel = optionalTrimmedString(profile.claudeHaikuModel);
  const sonnetModel = optionalTrimmedString(profile.claudeSonnetModel);
  const opusModel = optionalTrimmedString(profile.claudeOpusModel);

  if (primaryModel) {
    env.ANTHROPIC_MODEL = primaryModel;
  }
  if (haikuModel) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;
  }
  if (sonnetModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
  }
  if (opusModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
  }

  return env;
}

export function buildClaudeOptionalEnvironment(profile: ApiProfile): Record<string, string> {
  const env: Record<string, string> = {
    ...buildClaudeModelEnvironment(profile),
  };
  // keep existing optional env assignments below
}
```

- [ ] **Step 4: Run launch env tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/launchEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing Claude settings tests**

Update `tests/app/sessionService.test.ts` existing Claude settings test to include:

```ts
defaultModel: 'claude-opus-4-8',
claudeHaikuModel: 'claude-haiku-4-5-20251001',
claudeSonnetModel: 'claude-fable-5',
claudeOpusModel: 'claude-opus-4-8',
claudeDefaultLaunchMode: 'opus',
claudeAlwaysThinkingEnabled: true,
```

Expected settings content should include:

```ts
model: 'opus',
alwaysThinkingEnabled: true,
env: {
  ANTHROPIC_MODEL: 'claude-opus-4-8',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-fable-5',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8',
  CLAUDE_CODE_RETRY_WATCHDOG: '1',
  CLAUDE_CODE_MAX_RETRIES: '100',
  ANTHROPIC_BETAS: 'context-1m-2025-08-07',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
  DISABLE_INSTALLATION_CHECKS: '1',
},
```

Add a second test for `custom` mode:

```ts
it('writes the full primary model when Claude launch mode is custom', async () => {
  const runtime = createFakeRuntime();
  const writtenFiles: Array<{ filePath: string; content: string }> = [];
  const service = createSessionService({
    clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
    keychain: runtime.keychain,
    pty: runtime.pty,
    appDataPath: '/tmp/agentdock-test-data',
    writeTextFile(filePath, content) {
      writtenFiles.push({ filePath, content });
    },
  });

  await service.launch({
    profile: {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://anyrouter.top',
      defaultModel: 'claude-opus-4-8',
      claudeDefaultLaunchMode: 'custom',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    },
    workspace: { id: 'workspace-a', name: 'AgentDock', path: '/tmp' },
    command: 'claude',
  });

  expect(JSON.parse(writtenFiles[0].content).model).toBe('claude-opus-4-8');
});
```

- [ ] **Step 6: Run settings tests to verify RED**

Run:

```bash
npm run test -- tests/app/sessionService.test.ts
```

Expected: FAIL because settings currently writes `defaultModel` directly and does not support `alwaysThinkingEnabled`.

- [ ] **Step 7: Implement settings model mode mapping**

Update `src/main/sessionService.ts`:

```ts
function claudeSettingsModel(profile: ApiProfile): string | undefined {
  const launchMode = profile.claudeDefaultLaunchMode ?? 'custom';
  if (launchMode === 'default') {
    return undefined;
  }

  if (launchMode === 'custom') {
    return optionalTrimmedString(profile.defaultModel);
  }

  return launchMode;
}
```

Update `buildClaudeSettings(profile)`:

```ts
const model = claudeSettingsModel(profile);

if (model) {
  settings.model = model;
}

if (profile.claudeAlwaysThinkingEnabled === true) {
  settings.alwaysThinkingEnabled = true;
}
```

Update settings type:

```ts
Record<string, string | number | boolean | Record<string, string>>
```

- [ ] **Step 8: Run settings tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/sessionService.test.ts tests/app/launchEnvironment.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/main/launchEnvironment.ts src/main/sessionService.ts tests/app/launchEnvironment.test.ts tests/app/sessionService.test.ts
git commit -m "feat: apply Claude model mapping on launch"
```

---

## Task 3: API Config UI for Claude Model Mapping

**Files:**
- Modify: `src/renderer/components/ApiConfigPanel.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/app/App.test.tsx`

- [ ] **Step 1: Write failing UI tests for Claude model mapping**

Add to `tests/app/App.test.tsx`:

```ts
it('edits and saves Claude model mapping fields', async () => {
  const api = installAgentDockApi({
    listProfiles: vi.fn().mockResolvedValue([
      {
        id: 'claude-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-opus-4-8',
        availableModels: [
          'claude-haiku-4-5-20251001',
          'claude-fable-5',
          'claude-opus-4-8',
        ],
        keychainService: 'AgentDock',
        keychainAccount: 'claude-a',
        claudeDefaultLaunchMode: 'default',
      },
    ]),
  });

  render(<App />);
  await openApiConfigPage();
  fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

  expect(screen.getByText('模型映射')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('主模型'), {
    target: { value: 'claude-opus-4-8' },
  });
  fireEvent.change(screen.getByLabelText('Haiku 默认模型'), {
    target: { value: 'claude-haiku-4-5-20251001' },
  });
  fireEvent.change(screen.getByLabelText('Sonnet 默认模型'), {
    target: { value: 'claude-fable-5' },
  });
  fireEvent.change(screen.getByLabelText('Opus 默认模型'), {
    target: { value: 'claude-opus-4-8' },
  });
  fireEvent.change(screen.getByLabelText('默认启动选项'), {
    target: { value: 'opus' },
  });

  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => {
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'claude-a',
        defaultModel: 'claude-opus-4-8',
        claudeHaikuModel: 'claude-haiku-4-5-20251001',
        claudeSonnetModel: 'claude-fable-5',
        claudeOpusModel: 'claude-opus-4-8',
        claudeDefaultLaunchMode: 'opus',
      }),
    );
  });
});

it('does not show Claude model mapping fields for Codex profiles', async () => {
  installAgentDockApi({
    listProfiles: vi.fn().mockResolvedValue([
      {
        id: 'codex-b',
        name: 'Codex B',
        toolType: 'codex',
        baseUrl: 'https://anyrouter.top/v1',
        defaultModel: 'gpt-5-codex',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-b',
      },
    ]),
  });

  render(<App />);
  await openApiConfigPage();
  fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

  expect(screen.queryByText('模型映射')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Haiku 默认模型')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: FAIL because the model mapping fields do not exist.

- [ ] **Step 3: Add Claude model mapping editor**

In `src/renderer/components/ApiConfigPanel.tsx`, add helpers:

```ts
const claudeLaunchModes = [
  { label: 'Default', value: 'default' },
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
  { label: 'Custom', value: 'custom' },
] as const;
```

Add a local input component near the profile form:

```tsx
function ModelValueInput({
  label,
  value,
  models,
  onChange,
}: {
  label: string;
  value: string;
  models: string[];
  onChange(value: string): void;
}): React.JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        list={`${label.replace(/\s+/g, '-')}-models`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${label.replace(/\s+/g, '-')}-models`}>
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </label>
  );
}
```

Inside the profile editor, render this only for Claude:

```tsx
{draft.toolType === 'claude' ? (
  <fieldset className="model-mapping-panel wide-field">
    <legend>模型映射</legend>
    <div className="model-mapping-grid">
      <ModelValueInput
        label="主模型"
        value={draft.defaultModel ?? ''}
        models={defaultModelOptions}
        onChange={(value) => updateDraft('defaultModel', value)}
      />
      <ModelValueInput
        label="Haiku 默认模型"
        value={draft.claudeHaikuModel ?? ''}
        models={defaultModelOptions}
        onChange={(value) => updateDraft('claudeHaikuModel', value)}
      />
      <ModelValueInput
        label="Sonnet 默认模型"
        value={draft.claudeSonnetModel ?? ''}
        models={defaultModelOptions}
        onChange={(value) => updateDraft('claudeSonnetModel', value)}
      />
      <ModelValueInput
        label="Opus 默认模型"
        value={draft.claudeOpusModel ?? ''}
        models={defaultModelOptions}
        onChange={(value) => updateDraft('claudeOpusModel', value)}
      />
      <label>
        <span>默认启动选项</span>
        <select
          aria-label="默认启动选项"
          value={draft.claudeDefaultLaunchMode ?? 'default'}
          onChange={(event) =>
            updateDraft('claudeDefaultLaunchMode', event.target.value as ApiProfile['claudeDefaultLaunchMode'])
          }
        >
          {claudeLaunchModes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  </fieldset>
) : null}
```

Update submit payload for Claude:

```ts
claudeDefaultLaunchMode:
  draft.toolType === 'claude' ? draft.claudeDefaultLaunchMode ?? 'default' : undefined,
claudeHaikuModel:
  draft.toolType === 'claude' ? normalizeOptionalString(draft.claudeHaikuModel) : undefined,
claudeSonnetModel:
  draft.toolType === 'claude' ? normalizeOptionalString(draft.claudeSonnetModel) : undefined,
claudeOpusModel:
  draft.toolType === 'claude' ? normalizeOptionalString(draft.claudeOpusModel) : undefined,
claudeAlwaysThinkingEnabled:
  draft.toolType === 'claude' ? draft.claudeAlwaysThinkingEnabled : undefined,
```

Add the Thinking checkbox in Claude advanced settings:

```tsx
<label className="checkbox-label">
  <input
    type="checkbox"
    checked={draft.claudeAlwaysThinkingEnabled ?? false}
    onChange={(event) => updateDraft('claudeAlwaysThinkingEnabled', event.target.checked)}
  />
  <span>启用 Thinking 模式</span>
  <small className="field-help">写入 Claude settings 的 alwaysThinkingEnabled。</small>
</label>
```

- [ ] **Step 4: Add CSS**

Add to `src/renderer/styles.css`:

```css
.model-mapping-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  margin: 0;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #fff;
  padding: 14px;
}

.model-mapping-panel legend {
  padding: 0 6px;
  color: #111827;
  font-size: 13px;
  font-weight: 900;
}

.model-mapping-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 900px) {
  .model-mapping-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run UI tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/renderer/components/ApiConfigPanel.tsx src/renderer/styles.css tests/app/App.test.tsx
git commit -m "feat: add Claude model mapping UI"
```

---

## Task 4: Main-Process Per-Window Session Isolation

**Files:**
- Create: `src/main/windowSessionRegistry.ts`
- Modify: `src/main/sessionService.ts`
- Modify: `src/main/main.ts`
- Create: `tests/app/windowSessionRegistry.test.ts`
- Modify: `tests/app/sessionServiceTerminal.test.ts`
- Modify: `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: Write failing SessionService dispose test**

Update `tests/app/sessionServiceTerminal.test.ts`:

```ts
it('disposes all running PTY sessions owned by the service', async () => {
  const runtime = createTerminalRuntime();
  const service = createSessionService({
    keychain: runtime.keychain,
    pty: runtime.pty,
    appDataPath: '/tmp/agentdock-test-data',
  });
  const first = await launchTestSession(service);
  const second = await launchTestSession(service);

  await service.dispose();
  runtime.emit('ignored after dispose');

  expect(runtime.killedSessionIds).toEqual([first.id, second.id]);
  await expect(
    service.writeTerminal({ sessionId: first.id, input: 'help\n' }),
  ).rejects.toThrow('未找到指定的终端会话');
  await expect(service.list()).resolves.toEqual([
    { ...first, status: 'stopped' },
    { ...second, status: 'stopped' },
  ]);
});
```

Update the local `createTerminalRuntime()` helper in the same file so each fake PTY records its own killed session id:

```ts
const killedSessionIds: string[] = [];

// inside pty.spawn(request)
kill() {
  killedSessionIds.push(request.sessionId);
},

// returned runtime object
get killedSessionIds() {
  return killedSessionIds;
},
```

- [ ] **Step 2: Run SessionService dispose test to verify RED**

Run:

```bash
npm run test -- tests/app/sessionServiceTerminal.test.ts
```

Expected: FAIL because `SessionService.dispose()` does not exist yet.

- [ ] **Step 3: Implement SessionService dispose**

Update `src/main/sessionService.ts` `SessionService` type:

```ts
dispose(): Promise<void>;
```

Add this method to the returned service object:

```ts
async dispose(): Promise<void> {
  for (const [sessionId, ptySession] of ptySessions.entries()) {
    ptySession.kill();
    ptyUnsubscribers.get(sessionId)?.();
    const session = findSession(sessionId);
    if (session) {
      session.status = 'stopped';
    }
  }

  ptySessions.clear();
  ptyUnsubscribers.clear();
  terminalOutputListeners.clear();
}
```

- [ ] **Step 4: Run SessionService dispose test to verify GREEN**

Run:

```bash
npm run test -- tests/app/sessionServiceTerminal.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing registry tests**

Create `tests/app/windowSessionRegistry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createWindowSessionRegistry } from '../../src/main/windowSessionRegistry';
import type { SessionService } from '../../src/main/sessionService';

function createFakeSessionService(label: string): SessionService {
  return {
    launch: vi.fn(),
    list: vi.fn().mockResolvedValue([{ id: `${label}-session` }]),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    readTerminalBuffer: vi.fn(),
    onTerminalOutput: vi.fn(() => () => undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionService;
}

describe('windowSessionRegistry', () => {
  it('returns a separate session service for each window id', async () => {
    const created: string[] = [];
    const registry = createWindowSessionRegistry((windowId) => {
      created.push(`create:${windowId}`);
      return createFakeSessionService(String(windowId));
    });

    const first = registry.getOrCreate(1);
    const second = registry.getOrCreate(2);

    expect(first).not.toBe(second);
    expect(await first.list()).toEqual([{ id: '1-session' }]);
    expect(await second.list()).toEqual([{ id: '2-session' }]);
    expect(created).toEqual(['create:1', 'create:2']);
  });

  it('disposes only the target window service', async () => {
    const registry = createWindowSessionRegistry((windowId) => createFakeSessionService(String(windowId)));

    const first = registry.getOrCreate(1);
    const second = registry.getOrCreate(2);

    await registry.delete(1);

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(registry.getOrCreate(1)).not.toBe(first);
  });
});
```

- [ ] **Step 6: Run registry tests to verify RED**

Run:

```bash
npm run test -- tests/app/windowSessionRegistry.test.ts
```

Expected: FAIL because the file does not exist.

- [ ] **Step 7: Implement registry**

Create `src/main/windowSessionRegistry.ts`:

```ts
import type { SessionService } from './sessionService.js';

export type WindowSessionRegistry = {
  getOrCreate(windowId: number): SessionService;
  delete(windowId: number): Promise<void>;
};

export function createWindowSessionRegistry(
  createService: (windowId: number) => SessionService,
): WindowSessionRegistry {
  const services = new Map<number, SessionService>();

  return {
    getOrCreate(windowId: number): SessionService {
      const existing = services.get(windowId);
      if (existing) {
        return existing;
      }

      const service = createService(windowId);
      services.set(windowId, service);
      return service;
    },

    async delete(windowId: number): Promise<void> {
      const service = services.get(windowId);
      services.delete(windowId);
      await service?.dispose();
    },
  };
}
```

- [ ] **Step 8: Run registry tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/windowSessionRegistry.test.ts
```

Expected: PASS.

- [ ] **Step 9: Refactor main to create per-window SessionService**

In `src/main/main.ts`, remove global `sessionService`. Add:

```ts
const sessionRegistry = createWindowSessionRegistry(() =>
  createSessionService({
    keychain: secretAdapter,
    pty: createNodePtyAdapter(),
    appDataPath: userDataPath,
    workspaceExists: fs.existsSync,
  }),
);

function sessionServiceForWebContents(contents: Electron.WebContents) {
  return sessionRegistry.getOrCreate(contents.id);
}
```

Route session/terminal IPC by `event.sender`:

```ts
ipcMain.handle('sessions:list', (event) => sessionServiceForWebContents(event.sender).list());
ipcMain.handle('terminal:write', (event, request: TerminalWriteRequest) =>
  sessionServiceForWebContents(event.sender).writeTerminal(request),
);
ipcMain.handle('terminal:resize', (event, request: TerminalResizeRequest) =>
  sessionServiceForWebContents(event.sender).resizeTerminal(request),
);
ipcMain.handle('terminal:kill', (event, request: TerminalKillRequest) =>
  sessionServiceForWebContents(event.sender).killTerminal(request),
);
ipcMain.handle('terminal:buffer', (event, request: TerminalBufferRequest) =>
  sessionServiceForWebContents(event.sender).readTerminalBuffer(request),
);
```

In `createMainWindow()`, subscribe only that window to its service:

```ts
const windowSessionService = sessionRegistry.getOrCreate(window.webContents.id);
const webContentsId = window.webContents.id;
const unsubscribeTerminalOutput = windowSessionService.onTerminalOutput((event) => {
  if (!window.isDestroyed()) {
    window.webContents.send('terminal:output', event);
  }
});
window.on('closed', () => {
  unsubscribeTerminalOutput();
  void sessionRegistry.delete(webContentsId);
});
```

Update launch IPC:

```ts
return sessionServiceForWebContents(event.sender).launch({
  profile,
  workspace,
  command: request.command,
});
```

- [ ] **Step 10: Add multi-window metadata IPC and new-window API**

In `src/shared/preloadTypes.ts` add:

```ts
openNewWindow(): Promise<void>;
onMetadataChanged(listener: () => void): () => void;
```

In `AGENT_DOCK_API_METHODS`, add:

```ts
'openNewWindow',
'onMetadataChanged',
```

In `src/preload/preload.cts`:

```ts
openNewWindow: () => ipcRenderer.invoke('windows:new'),
onMetadataChanged: (listener) => {
  const handler = () => listener();
  ipcRenderer.on('metadata:changed', handler);
  return () => ipcRenderer.off('metadata:changed', handler);
},
```

In `src/main/main.ts`:

```ts
function broadcastMetadataChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('metadata:changed');
    }
  }
}

ipcMain.handle('windows:new', () => {
  createMainWindow();
});
```

Call `broadcastMetadataChanged()` after `saveProfile`, profile delete, and workspace save in `chooseWorkspace`.

- [ ] **Step 11: Run main/preload related tests**

Run:

```bash
npm run test -- tests/app/windowSessionRegistry.test.ts tests/app/preloadTypes.test.ts tests/app/sessionServiceTerminal.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit Task 4**

```bash
git add src/main/windowSessionRegistry.ts src/main/sessionService.ts src/main/main.ts src/preload/preload.cts src/shared/preloadTypes.ts tests/app/windowSessionRegistry.test.ts tests/app/sessionServiceTerminal.test.ts tests/app/preloadTypes.test.ts
git commit -m "feat: isolate sessions per AgentDock window"
```

---

## Task 5: Renderer New Window and Metadata Refresh

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/AppHeader.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/app/App.test.tsx`

- [ ] **Step 1: Write failing renderer tests**

Add to `tests/app/App.test.tsx`:

```ts
it('opens a new AgentDock window from the header action', async () => {
  const api = installAgentDockApi({
    openNewWindow: vi.fn().mockResolvedValue(undefined),
  });

  render(<App />);

  fireEvent.click(screen.getByRole('button', { name: '新窗口' }));

  await waitFor(() => {
    expect(api.openNewWindow).toHaveBeenCalled();
  });
});

it('refreshes profile and workspace metadata when another window changes it', async () => {
  let metadataListener: (() => void) | undefined;
  const api = installAgentDockApi({
    listProfiles: vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://a.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'profile-b',
          name: 'Claude B',
          toolType: 'claude',
          baseUrl: 'https://b.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-b',
        },
      ]),
    onMetadataChanged: vi.fn((listener: () => void) => {
      metadataListener = listener;
      return () => undefined;
    }),
  });

  render(<App />);
  expect(await screen.findByText('Claude A')).toBeInTheDocument();

  metadataListener?.();

  await waitFor(() => {
    expect(api.listProfiles).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Claude B')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Update App test API helper defaults**

In `tests/app/App.test.tsx`, extend `TestAgentDockApi` and `installAgentDockApi()` before running the new renderer tests:

```ts
type TestAgentDockApi = AgentDockApi & {
  openNewWindow: ReturnType<typeof vi.fn<() => Promise<void>>>;
  onMetadataChanged: ReturnType<typeof vi.fn<[(listener: () => void) => () => void]>>;
  // keep existing typed vi.fn entries
};

// inside installAgentDockApi()
openNewWindow: vi.fn().mockResolvedValue(undefined),
onMetadataChanged: vi.fn(() => () => undefined),
```

- [ ] **Step 3: Run renderer tests to verify RED**

Run:

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: FAIL because `openNewWindow` and metadata refresh are not wired.

- [ ] **Step 4: Add header action**

Update `src/renderer/components/AppHeader.tsx`:

```tsx
type AppHeaderProps = {
  onShowApiConfig(): void;
  onOpenNewWindow?(): void;
};

export function AppHeader({ onShowApiConfig, onOpenNewWindow }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="app-header">
      <div>
        <h1>AgentDock 代理坞</h1>
        <p>一个窗口收纳多个 Claude / Codex；每个标签页使用独立端点和 API Key。</p>
      </div>
      <div className="header-actions">
        {onOpenNewWindow ? (
          <button type="button" className="secondary-button" onClick={onOpenNewWindow}>
            新窗口
          </button>
        ) : null}
        <button type="button" onClick={onShowApiConfig}>
          接口配置
        </button>
      </div>
    </header>
  );
}
```

Update `src/renderer/App.tsx`:

```ts
const refreshMetadata = React.useCallback(async (): Promise<void> => {
  if (!api) {
    return;
  }

  const [nextProfiles, nextWorkspaces] = await Promise.all([
    api.listProfiles(),
    api.listWorkspaces(),
  ]);
  setProfiles(nextProfiles);
  setWorkspaces(nextWorkspaces);
  setSelectedProfileId((current) =>
    current && nextProfiles.some((profile) => profile.id === current) ? current : nextProfiles[0]?.id,
  );
  setSelectedWorkspaceId((current) =>
    current && nextWorkspaces.some((workspace) => workspace.id === current)
      ? current
      : nextWorkspaces[0]?.id,
  );
}, [api]);
```

Subscribe:

```ts
React.useEffect(() => {
  if (!api?.onMetadataChanged) {
    return undefined;
  }

  return api.onMetadataChanged(() => {
    void refreshMetadata().catch((error: unknown) => {
      setLaunchError(safeLaunchError(error));
    });
  });
}, [api, refreshMetadata]);
```

Pass:

```tsx
<AppHeader
  onShowApiConfig={showApiConfig}
  onOpenNewWindow={api ? () => void api.openNewWindow() : undefined}
/>
```

- [ ] **Step 5: Add CSS**

Add:

```css
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.secondary-button {
  border: 1px solid #d1d5db;
  border-radius: 10px;
  background: #fff;
  color: #374151;
  padding: 8px 12px;
  font-weight: 800;
}
```

- [ ] **Step 6: Run renderer tests to verify GREEN**

Run:

```bash
npm run test -- tests/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/renderer/App.tsx src/renderer/components/AppHeader.tsx src/renderer/styles.css tests/app/App.test.tsx
git commit -m "feat: add multi-window renderer controls"
```

---

## Task 6: Timestamped macOS Packaging Script

**Files:**
- Create: `scripts/package-mac.mjs`
- Modify: `package.json`
- Create: `tests/app/packageMacScript.test.ts`

- [ ] **Step 1: Write failing script tests**

Create `tests/app/packageMacScript.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS package script', () => {
  it('uses timestamped package output and does not use electron-packager overwrite', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = readFileSync('scripts/package-mac.mjs', 'utf8');

    expect(packageJson.scripts['package:mac']).toBe('npm run build && node scripts/package-mac.mjs');
    expect(script).toContain('release/packages');
    expect(script).toContain('AGENTDOCK_PACKAGE_OUT');
    expect(script).toContain('codesign');
    expect(script).toContain('--no-install');
    expect(script).not.toContain('--overwrite');
    expect(script).not.toContain('release/AgentDock-darwin-arm64/AgentDock.app');
  });
});
```

- [ ] **Step 2: Run packaging script test to verify RED**

Run:

```bash
npm run test -- tests/app/packageMacScript.test.ts
```

Expected: FAIL because `scripts/package-mac.mjs` does not exist and `package:mac` is still inline.

- [ ] **Step 3: Implement packaging script**

Create `scripts/package-mac.mjs`:

```js
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const outputRoot = process.env.AGENTDOCK_PACKAGE_OUT || path.join('release', 'packages');
const outputDirectory = path.join(outputRoot, timestamp());
const appPath = path.join(outputDirectory, 'AgentDock-darwin-arm64', 'AgentDock.app');

if (existsSync(outputDirectory)) {
  throw new Error(`Package output directory already exists: ${outputDirectory}`);
}

mkdirSync(outputDirectory, { recursive: true });

run('npx', [
  '--no-install',
  'electron-packager',
  '.',
  'AgentDock',
  '--platform=darwin',
  '--arch=arm64',
  `--out=${outputDirectory}`,
  '--prune=true',
  '--asar.unpack=**/{*.node,spawn-helper}',
  '--ignore=^/(src|tests|docs|scripts|release|\\.agent-workflow|\\.git)(/|$)',
]);

run('codesign', ['--force', '--deep', '--sign', '-', appPath]);

console.log(`AgentDock app packaged at: ${appPath}`);
```

Update `package.json`:

```json
"package:mac": "npm run build && node scripts/package-mac.mjs"
```

- [ ] **Step 4: Run packaging script test to verify GREEN**

Run:

```bash
npm run test -- tests/app/packageMacScript.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add package.json scripts/package-mac.mjs tests/app/packageMacScript.test.ts
git commit -m "build: package mac app into timestamped output"
```

---

## Task 7: Integration, Documentation, and Delivery

**Files:**
- Modify: `.agent-workflow/state.md`
- Create: `.agent-workflow/verification/2026-07-04-agentdock-batch-a-claude-models-multiwindow-package.md`
- Create: `.agent-workflow/delivery/2026-07-04-agentdock-batch-a-delivery-report.md`
- Modify: `README.md`
- Modify: `PROJECT_PROFILE.md`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run test && npm run workflow:doctor && npm run test:workflow && npm run typecheck && npm run build
```

Expected: exit code 0. Build may show the existing Vite chunk-size warning.

- [ ] **Step 2: Run packaging verification**

Run:

```bash
npm run package:mac
```

Expected: prints `AgentDock app packaged at: release/packages/<timestamp>/AgentDock-darwin-arm64/AgentDock.app`.

Copy the printed path into:

```bash
codesign --verify --deep --strict --verbose=2 "<printed-app-path>"
```

Expected: PASS.

- [ ] **Step 3: Perform manual multi-window smoke**

Open the printed App path. Verify:

1. First window appears.
2. Click “新窗口”; second window appears.
3. In each window, select a workspace and start `zsh`.
4. Type `echo agentdock-window-a` in window A and `echo agentdock-window-b` in window B.
5. Confirm terminal output does not cross windows.
6. Close window A.
7. Confirm window B remains open and terminal stays interactive.

Record exact results in `.agent-workflow/verification/2026-07-04-agentdock-batch-a-claude-models-multiwindow-package.md`.

- [ ] **Step 4: Verify Claude settings without real API call**

Use a fake Keychain/vault secret only if needed. Launch a Claude profile far enough to create settings, then inspect the generated settings file under userData `claude-settings/<profile-id>.json`.

Record:

```text
model: expected mode or absent for default
alwaysThinkingEnabled: present only when enabled
env.ANTHROPIC_MODEL: expected primary model
env.ANTHROPIC_DEFAULT_HAIKU_MODEL: expected Haiku model
env.ANTHROPIC_DEFAULT_SONNET_MODEL: expected Sonnet model
env.ANTHROPIC_DEFAULT_OPUS_MODEL: expected Opus model
secret scan: no API key present
```

- [ ] **Step 5: Update README and PROJECT_PROFILE package notes**

Update `README.md`:

````md
## macOS 打包

`npm run package:mac` 会构建并输出到新的时间戳目录，例如：

```text
release/packages/20260704-153000/AgentDock-darwin-arm64/AgentDock.app
```

默认不会覆盖 `release/AgentDock-darwin-arm64/AgentDock.app`。
````

Update `PROJECT_PROFILE.md` command table for `package:mac`:

```md
| macOS 打包 | `npm run package:mac` | 输出到 `release/packages/<timestamp>/...`，默认不覆盖固定 App |
```

- [ ] **Step 6: Run diff and secret checks**

Run:

```bash
git diff --check
rg -n --pcre2 "(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})" $(git diff --name-only) $(git ls-files --others --exclude-standard)
```

Expected:

- `git diff --check`: no output, exit code 0.
- `rg`: no output, exit code 1.

- [ ] **Step 7: Commit integration documentation**

```bash
git add README.md PROJECT_PROFILE.md .agent-workflow/state.md .agent-workflow/verification/2026-07-04-agentdock-batch-a-claude-models-multiwindow-package.md .agent-workflow/delivery/2026-07-04-agentdock-batch-a-delivery-report.md
git commit -m "docs: record AgentDock batch A verification"
```

---

## Self-Review Checklist

- Spec coverage:
  - Claude model mapping metadata: Task 1.
  - Claude settings/env launch behavior: Task 2.
  - API config UI: Task 3.
  - Multi-window isolation: Tasks 4 and 5.
  - Timestamped package output: Task 6.
  - L3 verification and docs: Task 7.
- Security:
  - API Key remains in secret adapter / PTY env only.
  - settings file tests must assert no secret.
  - UI keeps default hidden key behavior unchanged.
- Scope:
  - Codex model mapping is not expanded.
  - Slash command driving is not implemented.
  - Workspace shared context is not implemented.
- Verification:
  - Every feature task starts with failing tests.
  - Every task ends with focused test command and commit.
  - Final integration includes package and manual multi-window smoke.
