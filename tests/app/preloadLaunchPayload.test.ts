import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

const requireForTest = createRequire(import.meta.url);
const ts = requireForTest('typescript') as typeof import('typescript');

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    off: electronMocks.off,
  },
}));

async function importExposedApi(): Promise<AgentDockApi> {
  const electron = await import('electron');
  const source = readFileSync('src/preload/preload.cts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'src/preload/preload.cts',
  }).outputText;
  const preloadModule = { exports: {} };
  const requireFromPreload = (specifier: string) => {
    if (specifier === 'electron') {
      return electron;
    }
    throw new Error(`Unexpected preload runtime import: ${specifier}`);
  };
  new Function('require', 'module', 'exports', compiled)(
    requireFromPreload,
    preloadModule,
    preloadModule.exports,
  );
  expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1);
  expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith(
    'agentDock',
    expect.any(Object),
  );
  return electronMocks.exposeInMainWorld.mock.calls[0][1] as AgentDockApi;
}

beforeEach(() => {
  vi.resetModules();
  electronMocks.exposeInMainWorld.mockClear();
  electronMocks.invoke.mockClear();
  electronMocks.on.mockClear();
  electronMocks.off.mockClear();
});

describe('preload session launch payload whitelist', () => {
  it('forwards only allowed launch fields and drops extra or invalid tool modes', async () => {
    const api = await importExposedApi();
    const unsafeRequest = {
      profileId: 'profile-codex',
      workspaceId: 'workspace-a',
      command: 'codex --no-alt-screen',
      codexLaunchMode: 'newapi-tool-compatible',
      claudeLaunchMode: 'native-responses',
      extraField: 'must-not-cross-preload',
    } as unknown as Parameters<AgentDockApi['launchSession']>[0];

    await api.launchSession(unsafeRequest);

    expect(electronMocks.invoke).toHaveBeenCalledWith('sessions:launch', {
      profileId: 'profile-codex',
      workspaceId: 'workspace-a',
      command: 'codex --no-alt-screen',
      codexLaunchMode: 'newapi-tool-compatible',
    });
    expect(JSON.stringify(electronMocks.invoke.mock.calls)).not.toContain('extraField');
    expect(JSON.stringify(electronMocks.invoke.mock.calls)).not.toContain('native-responses');
  });

  it('preserves restart strategy while stripping extra fields and an invalid Codex mode', async () => {
    const api = await importExposedApi();
    const unsafeRequest = {
      sessionId: 'session-a',
      strategy: 'resume',
      command: 'claude --resume test-session-id',
      claudeLaunchMode: 'full',
      codexLaunchMode: 'invalid-codex-mode',
      extraField: 'must-not-cross-preload',
    } as unknown as Parameters<AgentDockApi['restartSession']>[0];

    await api.restartSession(unsafeRequest);

    expect(electronMocks.invoke).toHaveBeenCalledWith('sessions:restart', {
      sessionId: 'session-a',
      strategy: 'resume',
      command: 'claude --resume test-session-id',
      claudeLaunchMode: 'full',
    });
    expect(JSON.stringify(electronMocks.invoke.mock.calls)).not.toContain('extraField');
    expect(JSON.stringify(electronMocks.invoke.mock.calls)).not.toContain('invalid-codex-mode');
  });
});
