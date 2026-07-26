import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter, PtySpawnRequest } from '../../src/main/adapters/ptyAdapter';
import type { SessionRecordSyncService } from '../../src/main/sessionRecordSyncService';
import {
  createRuntimeOwnerRegistry,
  createSessionService,
} from '../../src/main/sessionService';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';
import { createSessionTranscriptStore } from '../../src/main/stores/sessionTranscriptStore';
import type { SessionRecordSnapshot } from '../../src/shared/agentdockTypes';

function snapshot(sessionId: string): SessionRecordSnapshot {
  return {
    sessionId,
    status: 'ready',
    events: [],
    eventCount: 0,
    truncated: false,
    hasMore: false,
  };
}

function deferred<Value>() {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value: Value) => resolvePromise?.(value) };
}

function createRecordSync(overrides: Partial<SessionRecordSyncService> = {}) {
  const service: SessionRecordSyncService = {
    bind: vi.fn().mockResolvedValue(undefined),
    appendStatus: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn(),
    syncNow: vi.fn(async (sessionId) => snapshot(sessionId)),
    finalSync: vi.fn(async (sessionId) => snapshot(sessionId)),
    getSnapshot: vi.fn(async (sessionId) => snapshot(sessionId)),
    buildRestoreMaterial: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return service;
}

function createRuntime() {
  const spawnRequests: PtySpawnRequest[] = [];
  const writes: string[] = [];
  const killedSessionIds: string[] = [];
  const dataHandlers = new Map<string, (data: string) => void>();
  const exitHandlers = new Map<string, (event: { exitCode: number; signal?: number }) => void>();
  const keychain: KeychainAdapter = {
    async readSecret() { return 'record-sync-test-secret'; },
    async writeSecret() {},
    async deleteSecret() {},
  };
  const pty: PtyAdapter = {
    async spawn(request) {
      spawnRequests.push(request);
      return {
        id: request.sessionId,
        write(input) { writes.push(input); },
        resize() {},
        kill() { killedSessionIds.push(request.sessionId); },
        onData(listener) {
          dataHandlers.set(request.sessionId, listener);
          return () => dataHandlers.delete(request.sessionId);
        },
        onExit(listener) {
          exitHandlers.set(request.sessionId, listener);
          return () => exitHandlers.delete(request.sessionId);
        },
      };
    },
  };
  return { dataHandlers, exitHandlers, keychain, killedSessionIds, pty, spawnRequests, writes };
}

const workspace = (workspacePath: string) => ({
  id: 'workspace-a',
  name: 'AgentDock',
  path: workspacePath,
});

const profile = (toolType: 'claude' | 'codex' | 'grok', home?: string) => ({
  id: `${toolType}-a`,
  name: `${toolType} A`,
  toolType,
  baseUrl: toolType === 'grok' ? 'https://api.x.ai/v1' : 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: `${toolType}-a`,
  ...(toolType === 'codex' && home ? { codexHome: home } : {}),
  ...(toolType === 'grok' && home ? { grokHome: home, grokAuthMode: 'api-key' as const } : {}),
});

describe('sessionService clear record lifecycle', () => {
  it('binds each native source to the actual launch home and schedules PTY output only', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-bind-'));
    const runIds: string[] = [];
    try {
      for (const tool of ['claude', 'codex', 'grok'] as const) {
        const runtime = createRuntime();
        const recordSync = createRecordSync();
        const customHome = path.join(tempDir, `${tool}-home`);
        const service = createSessionService({
          clock: { now: () => new Date('2026-07-25T01:02:03.000Z') },
          keychain: runtime.keychain,
          pty: runtime.pty,
          appDataPath: tempDir,
          homeDir: tempDir,
          recordSync,
          ensureDirectory() {},
          writeTextFile() {},
        });
        const session = await service.launch({
          profile: profile(tool, customHome),
          workspace: workspace(tempDir),
          command: tool,
        });
        const expectedHome = tool === 'claude' ? path.join(tempDir, '.claude') : customHome;
        expect(recordSync.bind).toHaveBeenCalledWith(expect.objectContaining({
          sessionId: session.id,
          source: tool,
          recordHome: expectedHome,
          workspacePath: tempDir,
          startedAt: '2026-07-25T01:02:03.000Z',
          runId: expect.stringMatching(/^run-[a-f0-9]+$/),
        }));
        runIds.push(vi.mocked(recordSync.bind).mock.calls[0][0].runId);
        await vi.waitFor(() => {
          expect(recordSync.appendStatus).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: session.id,
            code: 'started',
          }));
          expect(recordSync.syncNow).toHaveBeenCalledWith(session.id, 'launch');
        });
        runtime.dataHandlers.get(session.id)?.('terminal redraw only');
        expect(recordSync.schedule).toHaveBeenCalledWith(session.id, 'pty-output');
        expect(recordSync.appendStatus).toHaveBeenCalledTimes(1);
        await service.dispose();
      }
      expect(new Set(runIds).size).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each(['stop', 'exit', 'dispose'] as const)(
    'waits for %s final sync before removing a compatibility CODEX_HOME',
    async (lifecycle) => {
      const runtime = createRuntime();
      const final = deferred<SessionRecordSnapshot>();
      const recordSync = createRecordSync({
        finalSync: vi.fn(() => final.promise),
      });
      const removed: string[] = [];
      const service = createSessionService({
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-record-cleanup-order',
        recordSync,
        startCodexToolCompatibilityProxy: vi.fn().mockResolvedValue({
          baseUrl: 'http://127.0.0.1:43101/v1',
          localApiKey: 'compatibility-test-token',
          internalModel: 'agentdock-tool-runtime-session-1',
          close: vi.fn().mockResolvedValue(undefined),
        }),
        ensureDirectory() {},
        writeTextFile() {},
        ensurePrivateDirectory() {},
        writePrivateTextFile() {},
        removeDirectory: async (directoryPath) => { removed.push(directoryPath); },
      });
      let lifecyclePromise: Promise<unknown> | undefined;
      try {
        const session = await service.launch({
          profile: profile('codex', '/tmp/shared-codex-home'),
          workspace: workspace('/tmp/agentdock-workspace'),
          command: 'codex',
          codexLaunchMode: 'newapi-tool-compatible',
        });
        if (lifecycle === 'stop') {
          lifecyclePromise = service.killTerminal({ sessionId: session.id });
        } else if (lifecycle === 'dispose') {
          lifecyclePromise = service.dispose();
        } else {
          runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
        }
        await vi.waitFor(() => expect(recordSync.finalSync).toHaveBeenCalledWith(
          session.id,
          lifecycle === 'stop' ? 'stop' : lifecycle,
        ));
        expect(removed).toEqual([]);
        final.resolve(snapshot(session.id));
        await lifecyclePromise;
        await vi.waitFor(() => expect(removed).toEqual([
          '/tmp/agentdock-record-cleanup-order/codex-session-runtimes/session-1',
        ]));
      } finally {
        final.resolve(snapshot('session-1'));
        await lifecyclePromise?.catch(() => undefined);
        await service.dispose();
      }
    },
  );

  it('disposes only sessions owned by this service and never disposes the shared sync service', async () => {
    const recordSync = createRecordSync();
    const firstRuntime = createRuntime();
    const secondRuntime = createRuntime();
    const firstService = createSessionService({
      keychain: firstRuntime.keychain,
      pty: firstRuntime.pty,
      appDataPath: '/tmp/agentdock-owner-a',
      sessionIdPrefix: 'a-',
      recordSync,
    });
    const secondService = createSessionService({
      keychain: secondRuntime.keychain,
      pty: secondRuntime.pty,
      appDataPath: '/tmp/agentdock-owner-b',
      sessionIdPrefix: 'b-',
      recordSync,
    });
    const first = await firstService.launch({
      profile: profile('claude'),
      workspace: workspace('/tmp/agentdock-workspace-a'),
      command: 'claude',
    });
    const second = await secondService.launch({
      profile: profile('claude'),
      workspace: workspace('/tmp/agentdock-workspace-b'),
      command: 'claude',
    });
    vi.mocked(recordSync.finalSync).mockClear();

    await firstService.dispose();

    expect(recordSync.finalSync).toHaveBeenCalledTimes(1);
    expect(recordSync.finalSync).toHaveBeenCalledWith(first.id, 'dispose');
    expect(recordSync.finalSync).not.toHaveBeenCalledWith(second.id, 'dispose');
    expect(recordSync.dispose).not.toHaveBeenCalled();
    await secondService.dispose();
  });

  it('rejects observer mutations before shared owner, record, history, or PTY side effects', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-owner-guard-'));
    const ownerRegistry = createRuntimeOwnerRegistry();
    const ownerRuntime = createRuntime();
    const observerRuntime = createRuntime();
    const reloadedObserverRuntime = createRuntime();
    const recordSync = createRecordSync();
    const historyStore = createSessionHistoryStore(tempDir);
    const saveSession = vi.spyOn(historyStore, 'saveSession');
    const archiveSession = vi.spyOn(historyStore, 'archiveSession');
    const archiveBuffer = vi.spyOn(historyStore, 'archiveBuffer');
    const deleteRecord = vi.spyOn(historyStore, 'deleteRecord');
    const ownerProxyClose = vi.fn().mockResolvedValue(undefined);
    const removedOwnerRuntimeHomes: string[] = [];
    const sharedProfile = profile('codex', path.join(tempDir, 'codex-profile-home'));
    const sharedWorkspace = workspace(path.join(tempDir, 'workspace'));
    const ownerService = createSessionService({
      keychain: ownerRuntime.keychain,
      pty: ownerRuntime.pty,
      appDataPath: tempDir,
      homeDir: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-owner',
      runtimeOwnerRegistry: ownerRegistry,
      startCodexToolCompatibilityProxy: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:43103/v1',
        localApiKey: 'owner-guard-compatibility-test-token',
        internalModel: 'agentdock-owner-guard-runtime',
        close: ownerProxyClose,
      }),
      removeDirectory: async (directoryPath) => { removedOwnerRuntimeHomes.push(directoryPath); },
    });
    const observerService = createSessionService({
      keychain: observerRuntime.keychain,
      pty: observerRuntime.pty,
      appDataPath: tempDir,
      homeDir: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-observer',
      runtimeOwnerRegistry: ownerRegistry,
    });
    let reloadedObserverService: ReturnType<typeof createSessionService> | undefined;

    try {
      const session = await ownerService.launch({
        profile: sharedProfile,
        workspace: sharedWorkspace,
        command: 'codex',
        codexLaunchMode: 'newapi-tool-compatible',
      });
      await expect(observerService.list()).resolves.toEqual([
        expect.objectContaining({
          id: session.id,
          status: 'running',
          runtimeOwner: expect.objectContaining({ ownerId: 'window-owner' }),
        }),
      ]);
      vi.mocked(recordSync.finalSync).mockClear();
      vi.mocked(recordSync.deleteSession).mockClear();
      saveSession.mockClear();
      archiveSession.mockClear();
      archiveBuffer.mockClear();
      deleteRecord.mockClear();

      const ownerError = '该会话正在另一窗口运行';
      await expect(observerService.restart({
        sessionId: session.id,
        profile: sharedProfile,
        workspace: sharedWorkspace,
        command: 'codex',
        codexLaunchMode: 'newapi-tool-compatible',
        strategy: 'fresh',
      })).rejects.toThrow(ownerError);
      await expect(observerService.killTerminal({ sessionId: session.id }))
        .rejects.toThrow(ownerError);
      await expect(observerService.deleteSessionRecord({ sessionId: session.id }))
        .rejects.toThrow(ownerError);
      await expect(observerService.archiveSessionRecord({ sessionId: session.id }))
        .rejects.toThrow(ownerError);
      await expect(observerService.archiveSessionHistory({ sessionId: session.id }))
        .rejects.toThrow(ownerError);

      expect(recordSync.finalSync).not.toHaveBeenCalled();
      expect(recordSync.deleteSession).not.toHaveBeenCalled();
      expect(ownerRuntime.killedSessionIds).toEqual([]);
      expect(observerRuntime.killedSessionIds).toEqual([]);
      expect(ownerProxyClose).not.toHaveBeenCalled();
      expect(removedOwnerRuntimeHomes).toEqual([]);
      expect(saveSession).not.toHaveBeenCalled();
      expect(archiveSession).not.toHaveBeenCalled();
      expect(archiveBuffer).not.toHaveBeenCalled();
      expect(deleteRecord).not.toHaveBeenCalled();
      await expect(ownerService.list()).resolves.toEqual([
        expect.objectContaining({
          id: session.id,
          status: 'running',
          runtimeOwner: expect.objectContaining({ ownerId: 'window-owner' }),
        }),
      ]);
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({
          id: session.id,
          status: 'running',
          runtimeOwner: expect.objectContaining({ ownerId: 'window-owner' }),
        }),
      ]);

      await ownerService.killTerminal({ sessionId: session.id });
      await observerService.dispose();
      reloadedObserverService = createSessionService({
        keychain: reloadedObserverRuntime.keychain,
        pty: reloadedObserverRuntime.pty,
        appDataPath: tempDir,
        homeDir: tempDir,
        historyStore,
        recordSync,
        runtimeOwnerId: 'window-observer-reloaded',
        runtimeOwnerRegistry: ownerRegistry,
      });
      await expect(reloadedObserverService.list()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      const archived = await reloadedObserverService.archiveSessionRecord({ sessionId: session.id });
      expect(archived).toMatchObject({ id: session.id, status: 'stopped', archived: true });
      await expect(reloadedObserverService.deleteSessionRecord({ sessionId: session.id }))
        .resolves.toBeUndefined();
      await expect(historyStore.listSessions()).resolves.toEqual([]);
    } finally {
      await reloadedObserverService?.dispose();
      await observerService.dispose();
      await ownerService.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    { deleteOutcome: 'success' as const },
    { deleteOutcome: 'failure' as const },
  ])(
    'holds a shared mutation lease across delete $deleteOutcome and releases it afterward',
    async ({ deleteOutcome }) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-mutation-lease-'));
      const sessionId = `session-delete-${deleteOutcome}`;
      const historyStore = createSessionHistoryStore(tempDir);
      await historyStore.saveSession({
        id: sessionId,
        title: 'Claude A · AgentDock',
        profileId: 'claude-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'stopped',
        startedAt: '2026-07-25T00:00:00.000Z',
      });

      const ownerRegistry = createRuntimeOwnerRegistry();
      const firstRuntime = createRuntime();
      const secondRuntime = createRuntime();
      const retryMetadataStarted = deferred<void>();
      const allowRetryMetadata = deferred<void>();
      const removedDirectories: string[] = [];
      const recordSync = createRecordSync({
        deleteSession: deleteOutcome === 'failure'
          ? vi.fn().mockRejectedValueOnce(new Error('synthetic private delete detail'))
          : vi.fn().mockResolvedValue(undefined),
      });
      const originalSaveSession = historyStore.saveSession.bind(historyStore);
      let pauseRetryMetadata = true;
      const saveSession = vi.spyOn(historyStore, 'saveSession').mockImplementation(async (session) => {
        if (
          pauseRetryMetadata
          && session.id === sessionId
          && session.status === 'stopped'
          && session.runtimeOwner === undefined
        ) {
          pauseRetryMetadata = false;
          retryMetadataStarted.resolve();
          await allowRetryMetadata.promise;
        }
        await originalSaveSession(session);
      });
      const archiveSession = vi.spyOn(historyStore, 'archiveSession');
      const archiveBuffer = vi.spyOn(historyStore, 'archiveBuffer');
      const deleteRecord = vi.spyOn(historyStore, 'deleteRecord');
      const sharedOptions = {
        appDataPath: tempDir,
        homeDir: tempDir,
        historyStore,
        recordSync,
        runtimeOwnerRegistry: ownerRegistry,
        removeDirectory: async (directoryPath: string) => {
          removedDirectories.push(directoryPath);
        },
      };
      const firstService = createSessionService({
        ...sharedOptions,
        keychain: firstRuntime.keychain,
        pty: firstRuntime.pty,
        runtimeOwnerId: 'window-a',
      });
      const secondService = createSessionService({
        ...sharedOptions,
        keychain: secondRuntime.keychain,
        pty: secondRuntime.pty,
        runtimeOwnerId: 'window-b',
      });
      let deletePromise: Promise<void> | undefined;

      try {
        await Promise.all([firstService.list(), secondService.list()]);
        deletePromise = firstService.deleteSessionRecord({ sessionId });
        await retryMetadataStarted.promise;

        const ownerError = '该会话正在另一窗口运行';
        const restartInput = {
          sessionId,
          profile: profile('claude'),
          workspace: workspace(tempDir),
          command: 'claude',
          strategy: 'fresh' as const,
        };
        await expect(secondService.restart(restartInput)).rejects.toThrow(ownerError);
        await expect(firstService.restart(restartInput)).rejects.toThrow(ownerError);
        await expect(firstService.archiveSessionRecord({ sessionId })).rejects.toThrow(ownerError);

        expect(ownerRegistry.get(sessionId)).toBeUndefined();
        expect(firstRuntime.spawnRequests).toEqual([]);
        expect(secondRuntime.spawnRequests).toEqual([]);
        expect(recordSync.bind).not.toHaveBeenCalled();
        expect(recordSync.finalSync).not.toHaveBeenCalled();
        expect(recordSync.deleteSession).not.toHaveBeenCalled();
        expect(deleteRecord).not.toHaveBeenCalled();
        expect(archiveSession).not.toHaveBeenCalled();
        expect(archiveBuffer).not.toHaveBeenCalled();
        expect(removedDirectories).toEqual([]);
        expect(saveSession).toHaveBeenCalledTimes(1);
        await expect(historyStore.listSessions()).resolves.toEqual([
          expect.objectContaining({ id: sessionId, status: 'stopped' }),
        ]);

        allowRetryMetadata.resolve();
        if (deleteOutcome === 'success') {
          await expect(deletePromise).resolves.toBeUndefined();
          expect(ownerRegistry.get(sessionId)).toBeUndefined();
          await expect(historyStore.listSessions()).resolves.toEqual([]);

          await expect(secondService.deleteSessionRecord({ sessionId })).resolves.toBeUndefined();
          expect(recordSync.deleteSession).toHaveBeenCalledTimes(2);
          expect(deleteRecord).toHaveBeenCalledTimes(2);
          expect(ownerRegistry.get(sessionId)).toBeUndefined();
          await expect(historyStore.listSessions()).resolves.toEqual([]);
        } else {
          await expect(deletePromise).rejects.toThrow(/^清晰会话记录删除失败$/);
          expect(recordSync.deleteSession).toHaveBeenCalledTimes(1);
          expect(deleteRecord).not.toHaveBeenCalled();
          expect(ownerRegistry.get(sessionId)).toBeUndefined();
          await expect(historyStore.listSessions()).resolves.toEqual([
            expect.objectContaining({ id: sessionId, status: 'stopped' }),
          ]);

          vi.mocked(recordSync.deleteSession).mockResolvedValue(undefined);
          await expect(secondService.restart(restartInput))
            .rejects.toThrow('该会话正在等待删除完成');
          await expect(secondService.deleteSessionRecord({ sessionId }))
            .resolves.toBeUndefined();
          expect(secondRuntime.spawnRequests).toHaveLength(0);
          expect(recordSync.bind).toHaveBeenCalledTimes(0);
          expect(ownerRegistry.get(sessionId)).toBeUndefined();
          await expect(historyStore.listSessions()).resolves.toEqual([]);
        }
      } finally {
        allowRetryMetadata.resolve();
        await deletePromise?.catch(() => undefined);
        await secondService.dispose();
        await firstService.dispose();
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );

  it('starts disposal for all active sessions before awaiting either final sync', async () => {
    const runtime = createRuntime();
    const firstFinalSync = deferred<SessionRecordSnapshot>();
    const secondFinalSync = deferred<SessionRecordSnapshot>();
    const pendingFinalSyncs = new Map<
      string,
      ReturnType<typeof deferred<SessionRecordSnapshot>>
    >();
    const recordSync = createRecordSync({
      finalSync: vi.fn((sessionId, reason) => {
        expect(reason).toBe('dispose');
        expect(runtime.killedSessionIds).toContain(sessionId);
        const pendingFinalSync = pendingFinalSyncs.get(sessionId);
        if (!pendingFinalSync) {
          throw new Error('缺少测试 final sync deferred');
        }
        return pendingFinalSync.promise;
      }),
    });
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-concurrent-dispose',
      recordSync,
    });
    let disposePromise: Promise<void> | undefined;
    try {
      const firstSession = await service.launch({
        profile: profile('claude'),
        workspace: workspace('/tmp/agentdock-workspace-a'),
        command: 'claude',
      });
      const secondSession = await service.launch({
        profile: profile('claude'),
        workspace: workspace('/tmp/agentdock-workspace-b'),
        command: 'claude',
      });
      pendingFinalSyncs.set(firstSession.id, firstFinalSync);
      pendingFinalSyncs.set(secondSession.id, secondFinalSync);

      let disposeCompleted = false;
      disposePromise = service.dispose().then(() => {
        disposeCompleted = true;
      });

      expect(recordSync.finalSync).toHaveBeenCalledTimes(2);
      expect(recordSync.finalSync).toHaveBeenCalledWith(firstSession.id, 'dispose');
      expect(recordSync.finalSync).toHaveBeenCalledWith(secondSession.id, 'dispose');
      expect(new Set(runtime.killedSessionIds)).toEqual(
        new Set([firstSession.id, secondSession.id]),
      );
      await Promise.resolve();
      expect(disposeCompleted).toBe(false);

      firstFinalSync.resolve(snapshot(firstSession.id));
      await Promise.resolve();
      await Promise.resolve();
      expect(disposeCompleted).toBe(false);

      secondFinalSync.resolve(snapshot(secondSession.id));
      await disposePromise;
      expect(disposeCompleted).toBe(true);
      expect(recordSync.dispose).not.toHaveBeenCalled();
    } finally {
      firstFinalSync.resolve(snapshot('session-1'));
      secondFinalSync.resolve(snapshot('session-2'));
      await disposePromise?.catch(() => undefined);
      await service.dispose();
    }
  });

  it('does not await launch sync and final-sync failure does not block stop', async () => {
    const runtime = createRuntime();
    let releaseLaunchSync: ((value: SessionRecordSnapshot) => void) | undefined;
    const pendingLaunchSync = new Promise<SessionRecordSnapshot>((resolve) => {
      releaseLaunchSync = resolve;
    });
    const recordSync = createRecordSync({
      syncNow: vi.fn(() => pendingLaunchSync),
      finalSync: vi.fn().mockRejectedValue(new Error('private adapter detail')),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-record-sync',
      recordSync,
      ensureDirectory() {},
      writeTextFile() {},
    });
    try {
      const launchPromise = service.launch({
        profile: profile('codex', '/tmp/agentdock-record-sync/codex-home'),
        workspace: workspace('/tmp/agentdock-workspace'),
        command: 'codex',
      });
      const launched = await Promise.race([
        launchPromise,
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
      ]);
      expect(launched).not.toBe('timed-out');
      const session = await launchPromise;
      await expect(service.killTerminal({ sessionId: session.id })).resolves.toMatchObject({
        status: 'stopped',
      });
      expect(recordSync.finalSync).toHaveBeenCalledWith(session.id, 'stop');
      expect(runtime.killedSessionIds).toEqual([session.id]);
    } finally {
      releaseLaunchSync?.(snapshot('session-1'));
      await service.dispose();
      errorSpy.mockRestore();
    }
  });

  it('keeps the PTY usable when record binding fails without exposing adapter details', async () => {
    const runtime = createRuntime();
    const recordSync = createRecordSync({
      bind: vi.fn().mockRejectedValue(new Error('private native log path')),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-record-bind-failure',
      recordSync,
    });
    try {
      const session = await service.launch({
        profile: profile('claude'),
        workspace: workspace('/tmp/agentdock-workspace'),
        command: 'claude',
      });
      expect(session.status).toBe('running');
      expect(runtime.spawnRequests).toHaveLength(1);
      expect(recordSync.syncNow).not.toHaveBeenCalled();
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private native log path');
    } finally {
      await service.dispose();
      errorSpy.mockRestore();
    }
  });

  it.each(['stop', 'exit', 'dispose'] as const)(
    'does not reuse the previous binding for a failed replacement run on %s',
    async (lifecycle) => {
      const runtime = createRuntime();
      const recordSync = createRecordSync({
        bind: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('synthetic recordHome native-id cursor path detail')),
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let now = '2026-07-25T01:00:00.000Z';
      const service = createSessionService({
        clock: { now: () => new Date(now) },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-record-rebind-failure',
        recordSync,
      });
      try {
        const session = await service.launch({
          profile: profile('claude'),
          workspace: workspace('/tmp/agentdock-workspace'),
          command: 'claude',
        });
        await vi.waitFor(() => expect(recordSync.syncNow).toHaveBeenCalledTimes(1));
        await service.killTerminal({ sessionId: session.id });
        vi.mocked(recordSync.finalSync).mockClear();
        vi.mocked(recordSync.appendStatus).mockClear();
        vi.mocked(recordSync.schedule).mockClear();

        now = '2026-07-25T02:00:00.000Z';
        await service.restart({
          sessionId: session.id,
          profile: profile('claude'),
          workspace: workspace('/tmp/agentdock-workspace'),
          command: 'claude',
          strategy: 'fresh',
        });

        const firstRunId = vi.mocked(recordSync.bind).mock.calls[0][0].runId;
        const secondRunId = vi.mocked(recordSync.bind).mock.calls[1][0].runId;
        expect(secondRunId).not.toBe(firstRunId);
        expect(recordSync.finalSync).toHaveBeenCalledTimes(1);
        expect(recordSync.finalSync).toHaveBeenCalledWith(session.id, 'restart');
        expect(recordSync.appendStatus).not.toHaveBeenCalled();
        runtime.dataHandlers.get(session.id)?.('second run remains interactive');
        expect(recordSync.schedule).not.toHaveBeenCalled();
        await expect(service.writeTerminal({ sessionId: session.id, input: 'still usable\n' }))
          .resolves.toBeUndefined();
        expect(runtime.writes).toContain('still usable\n');

        vi.mocked(recordSync.finalSync).mockClear();
        if (lifecycle === 'stop') {
          await service.killTerminal({ sessionId: session.id });
        } else if (lifecycle === 'exit') {
          runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
          await vi.waitFor(async () => {
            await expect(service.list()).resolves.toEqual([
              expect.objectContaining({ id: session.id, status: 'exited' }),
            ]);
          });
        } else {
          await service.dispose();
        }

        expect(recordSync.finalSync).not.toHaveBeenCalled();
        expect(recordSync.appendStatus).not.toHaveBeenCalled();
        expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
          'synthetic recordHome native-id cursor path detail',
        );
      } finally {
        await service.dispose();
        errorSpy.mockRestore();
      }
    },
  );

  it('final-syncs the old run before restart, rebinds a new run, and deletes only records', async () => {
    const runtime = createRuntime();
    const calls: string[] = [];
    const recordSync = createRecordSync({
      bind: vi.fn(async ({ runId }) => { calls.push(`bind:${runId}`); }),
      appendStatus: vi.fn(async ({ runId, code }) => { calls.push(`${code}:${runId}`); }),
      syncNow: vi.fn(async (sessionId) => { calls.push('sync:launch'); return snapshot(sessionId); }),
      finalSync: vi.fn(async (sessionId, reason) => {
        calls.push(`final:${reason}`);
        return snapshot(sessionId);
      }),
      deleteSession: vi.fn(async (sessionId) => { calls.push(`delete:${sessionId}`); }),
    });
    let now = '2026-07-25T01:00:00.000Z';
    const removed: string[] = [];
    const service = createSessionService({
      clock: { now: () => new Date(now) },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-record-restart',
      recordSync,
      removeDirectory: async (directoryPath) => { removed.push(directoryPath); },
      ensureDirectory() {},
      writeTextFile() {},
    });
    const session = await service.launch({
      profile: profile('claude'),
      workspace: workspace('/tmp/agentdock-workspace'),
      command: 'claude',
    });
    await vi.waitFor(() => expect(recordSync.syncNow).toHaveBeenCalledTimes(1));
    await service.killTerminal({ sessionId: session.id });
    const firstRunId = vi.mocked(recordSync.bind).mock.calls[0][0].runId;
    calls.length = 0;
    now = '2026-07-25T02:00:00.000Z';
    await service.restart({
      sessionId: session.id,
      profile: profile('claude'),
      workspace: workspace('/tmp/agentdock-workspace'),
      command: 'claude',
      strategy: 'fresh',
    });
    await vi.waitFor(() => expect(recordSync.syncNow).toHaveBeenCalledTimes(2));
    const secondRunId = vi.mocked(recordSync.bind).mock.calls[1][0].runId;
    expect(secondRunId).not.toBe(firstRunId);
    expect(calls[0]).toBe('final:restart');
    expect(calls.indexOf(`bind:${secondRunId}`)).toBeLessThan(calls.indexOf(`started:${secondRunId}`));
    expect(calls.indexOf(`started:${secondRunId}`)).toBeLessThan(calls.indexOf('sync:launch'));

    await service.killTerminal({ sessionId: session.id });
    await service.deleteSessionRecord({ sessionId: session.id });
    expect(recordSync.deleteSession).toHaveBeenCalledWith(session.id);
    expect(removed).not.toContain('/tmp/agentdock-workspace');
    expect(recordSync.dispose).not.toHaveBeenCalled();
  });

  it('retains a retryable stopped session when clear record deletion fails', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-delete-rejection-'));
    const runtime = createRuntime();
    const recordSync = createRecordSync({
      deleteSession: vi.fn().mockRejectedValueOnce(new Error('private delete detail')),
    });
    const removed: string[] = [];
    const historyStore = createSessionHistoryStore(tempDir);
    const workspacePath = path.join(tempDir, 'workspace');
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      removeDirectory: async (directoryPath) => { removed.push(directoryPath); },
    });
    try {
      const session = await service.launch({
        profile: profile('claude'),
        workspace: workspace(workspacePath),
        command: 'claude',
      });
      const [runningHistorySession] = await historyStore.listSessions();
      expect(runningHistorySession).toMatchObject({ id: session.id, status: 'running' });
      expect(runningHistorySession.runtimeOwner).toMatchObject({ ownerId: 'default-window' });

      await expect(service.deleteSessionRecord({ sessionId: session.id }))
        .rejects.toThrow('清晰会话记录删除失败');

      const [retainedSession] = await service.list();
      expect(retainedSession).toMatchObject({ id: session.id, status: 'stopped' });
      expect(retainedSession).not.toHaveProperty('runtimeOwner');
      const [persistedSession] = await historyStore.listSessions();
      expect(persistedSession).toMatchObject({ id: session.id, status: 'stopped' });
      expect(persistedSession.runtimeOwner).toBeUndefined();

      const diskEntries = JSON.parse(
        await readFile(path.join(tempDir, 'sessions.json'), 'utf8'),
      ) as Array<{ id: string; session: Record<string, unknown> }>;
      const diskSession = diskEntries.find((entry) => entry.id === session.id)?.session;
      expect(diskSession).toMatchObject({ status: 'stopped' });
      expect(diskSession).not.toHaveProperty('runtimeOwner');

      const reloadedHistoryStore = createSessionHistoryStore(tempDir);
      await expect(reloadedHistoryStore.listSessions()).resolves.toEqual([]);
      await expect(reloadedHistoryStore.listPendingDeletionIds()).resolves.toEqual([session.id]);

      await expect(service.writeTerminal({ sessionId: session.id, input: 'still-running?\n' }))
        .rejects.toThrow('未找到指定的终端会话');
      expect(runtime.killedSessionIds).toEqual([session.id]);
      expect(removed).not.toContain(workspacePath);

      vi.mocked(recordSync.deleteSession).mockResolvedValueOnce(undefined);
      await expect(service.deleteSessionRecord({ sessionId: session.id })).resolves.toBeUndefined();
      await expect(service.list()).resolves.toEqual([]);
      await expect(historyStore.listSessions()).resolves.toEqual([]);
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retains a retryable stopped session when history deletion rejects', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-history-delete-rejection-'));
    const runtime = createRuntime();
    const recordSync = createRecordSync();
    const historyStore = createSessionHistoryStore(tempDir);
    const deleteRecord = vi.spyOn(historyStore, 'deleteRecord')
      .mockRejectedValueOnce(new Error('synthetic history path detail'));
    const workspacePath = path.join(tempDir, 'workspace');
    const removed: string[] = [];
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      removeDirectory: async (directoryPath) => { removed.push(directoryPath); },
    });
    try {
      const session = await service.launch({
        profile: profile('claude'),
        workspace: workspace(workspacePath),
        command: 'claude',
      });

      await expect(service.deleteSessionRecord({ sessionId: session.id }))
        .rejects.toThrow(/^清晰会话记录删除失败$/);
      await expect(service.list()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      expect((await service.list())[0]).not.toHaveProperty('runtimeOwner');
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      const diskEntriesAfterFailure = JSON.parse(
        await readFile(path.join(tempDir, 'sessions.json'), 'utf8'),
      ) as Array<{ id: string; session: Record<string, unknown> }>;
      expect(diskEntriesAfterFailure).toEqual([
        expect.objectContaining({
          id: session.id,
          session: expect.objectContaining({ status: 'stopped' }),
        }),
      ]);
      expect(diskEntriesAfterFailure[0].session).not.toHaveProperty('runtimeOwner');
      const reloadedHistoryStore = createSessionHistoryStore(tempDir);
      await expect(reloadedHistoryStore.listSessions()).resolves.toEqual([]);
      await expect(reloadedHistoryStore.listPendingDeletionIds()).resolves.toEqual([session.id]);
      expect(recordSync.deleteSession).toHaveBeenCalledTimes(1);
      expect(removed).not.toContain(workspacePath);

      await expect(service.deleteSessionRecord({ sessionId: session.id })).resolves.toBeUndefined();
      expect(recordSync.deleteSession).toHaveBeenCalledTimes(2);
      expect(deleteRecord).toHaveBeenCalledTimes(2);
      await expect(service.list()).resolves.toEqual([]);
      await expect(historyStore.listSessions()).resolves.toEqual([]);
      expect(JSON.stringify(await service.list())).not.toContain('synthetic history path detail');
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('restores real history metadata after transcript deletion rejects and removes it on retry', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-transcript-delete-rejection-'));
    const runtime = createRuntime();
    const recordSync = createRecordSync();
    const transcriptStore = createSessionTranscriptStore(tempDir);
    const deleteTranscript = vi.spyOn(transcriptStore, 'deleteTranscript')
      .mockRejectedValueOnce(new Error('synthetic transcript private path detail'));
    const historyStore = createSessionHistoryStore(tempDir, { transcriptStore });
    const workspacePath = path.join(tempDir, 'workspace');
    const removed: string[] = [];
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      removeDirectory: async (directoryPath) => { removed.push(directoryPath); },
    });
    try {
      const session = await service.launch({
        profile: profile('claude'),
        workspace: workspace(workspacePath),
        command: 'claude',
      });
      runtime.dataHandlers.get(session.id)?.('synthetic transcript retry marker');
      await expect(historyStore.readBuffer(session.id))
        .resolves.toContain('synthetic transcript retry marke');

      await expect(service.deleteSessionRecord({ sessionId: session.id }))
        .rejects.toThrow(/^清晰会话记录删除失败$/);
      await expect(service.list()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      expect((await service.list())[0]).not.toHaveProperty('runtimeOwner');
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      const diskEntriesAfterFailure = JSON.parse(
        await readFile(path.join(tempDir, 'sessions.json'), 'utf8'),
      ) as Array<{ id: string; session: Record<string, unknown> }>;
      expect(diskEntriesAfterFailure).toEqual([
        expect.objectContaining({
          id: session.id,
          session: expect.objectContaining({ status: 'stopped' }),
        }),
      ]);
      const reloadedHistoryStore = createSessionHistoryStore(tempDir);
      await expect(reloadedHistoryStore.listSessions()).resolves.toEqual([]);
      await expect(reloadedHistoryStore.listPendingDeletionIds()).resolves.toEqual([session.id]);
      await expect(readFile(transcriptStore.transcriptPath(session.id), 'utf8'))
        .resolves.toContain('synthetic transcript retry marker');
      expect(removed).not.toContain(workspacePath);

      await expect(service.deleteSessionRecord({ sessionId: session.id })).resolves.toBeUndefined();
      expect(recordSync.deleteSession).toHaveBeenCalledTimes(2);
      expect(deleteTranscript).toHaveBeenCalledTimes(2);
      await expect(service.list()).resolves.toEqual([]);
      await expect(historyStore.listSessions()).resolves.toEqual([]);
      expect(JSON.parse(await readFile(path.join(tempDir, 'sessions.json'), 'utf8'))).toEqual([]);
      const reloadedAfterRetry = createSessionHistoryStore(tempDir);
      await expect(reloadedAfterRetry.listSessions()).resolves.toEqual([]);
      await expect(readFile(transcriptStore.transcriptPath(session.id), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('waits for exit finalization before deleting persistent session history', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-delete-exit-race-'));
    const runtime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    const closeStarted = deferred<void>();
    const allowClose = deferred<void>();
    const recordDeleteStarted = deferred<void>();
    const recordSync = createRecordSync({
      deleteSession: vi.fn(async () => { recordDeleteStarted.resolve(); }),
    });
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      startClaudeCompatProxy: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:43102',
        close: vi.fn(async () => {
          closeStarted.resolve();
          await allowClose.promise;
        }),
      }),
    });
    try {
      const session = await service.launch({
        profile: {
          ...profile('claude'),
          claudeAnthropicCompatProxyEnabled: true,
        },
        workspace: workspace(tempDir),
        command: 'claude',
      });
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
      await closeStarted.promise;

      const deletePromise = service.deleteSessionRecord({ sessionId: session.id });
      const recordDeleteBeforeFinalization = await Promise.race([
        recordDeleteStarted.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(recordDeleteBeforeFinalization).toBe(false);

      allowClose.resolve();
      await deletePromise;
      expect(recordSync.deleteSession).toHaveBeenCalledWith(session.id);
      await expect(historyStore.listSessions()).resolves.toEqual([]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(historyStore.listSessions()).resolves.toEqual([]);
    } finally {
      allowClose.resolve();
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the shared owner until natural-exit finalization is durable', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-shared-exit-owner-'));
    const ownerRuntime = createRuntime();
    const observerRuntime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    const ownerRegistry = createRuntimeOwnerRegistry();
    const exitFinalSync = deferred<SessionRecordSnapshot>();
    const recordSync = createRecordSync({
      finalSync: vi.fn((sessionId, reason) => (
        reason === 'exit' ? exitFinalSync.promise : Promise.resolve(snapshot(sessionId))
      )),
    });
    const ownerService = createSessionService({
      clock: { now: () => new Date('2026-07-25T01:00:00.000Z') },
      keychain: ownerRuntime.keychain,
      pty: ownerRuntime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-owner',
      runtimeOwnerRegistry: ownerRegistry,
    });
    const observerService = createSessionService({
      clock: { now: () => new Date('2026-07-25T02:00:00.000Z') },
      keychain: observerRuntime.keychain,
      pty: observerRuntime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-observer',
      runtimeOwnerRegistry: ownerRegistry,
    });
    try {
      const session = await ownerService.launch({
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
      });
      await observerService.list();
      ownerRuntime.exitHandlers.get(session.id)?.({ exitCode: 0 });
      await vi.waitFor(() => expect(recordSync.finalSync).toHaveBeenCalledWith(session.id, 'exit'));

      await expect(observerService.restart({
        sessionId: session.id,
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'fresh',
      })).rejects.toThrow('该会话正在另一窗口运行');
      expect(observerRuntime.spawnRequests).toEqual([]);

      exitFinalSync.resolve(snapshot(session.id));
      await vi.waitFor(() => expect(ownerRegistry.get(session.id)).toBeUndefined());
      await expect(observerService.restart({
        sessionId: session.id,
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'fresh',
      })).resolves.toMatchObject({
        id: session.id,
        status: 'running',
        startedAt: '2026-07-25T02:00:00.000Z',
        runtimeOwner: { ownerId: 'window-observer' },
      });
      const persisted = await historyStore.listSessions();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        id: session.id,
        status: 'running',
        startedAt: '2026-07-25T02:00:00.000Z',
        runtimeOwner: { ownerId: 'window-observer' },
      });
    } finally {
      exitFinalSync.resolve(snapshot('session-1'));
      await observerService.dispose();
      await ownerService.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not let another window delete while natural-exit finalization can still save metadata', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-shared-exit-delete-'));
    const ownerRuntime = createRuntime();
    const observerRuntime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    const ownerRegistry = createRuntimeOwnerRegistry();
    const exitFinalSync = deferred<SessionRecordSnapshot>();
    const recordSync = createRecordSync({
      finalSync: vi.fn((sessionId, reason) => (
        reason === 'exit' ? exitFinalSync.promise : Promise.resolve(snapshot(sessionId))
      )),
    });
    const sharedOptions = { appDataPath: tempDir, historyStore, recordSync, runtimeOwnerRegistry: ownerRegistry };
    const ownerService = createSessionService({
      ...sharedOptions,
      keychain: ownerRuntime.keychain,
      pty: ownerRuntime.pty,
      runtimeOwnerId: 'window-owner',
    });
    const observerService = createSessionService({
      ...sharedOptions,
      keychain: observerRuntime.keychain,
      pty: observerRuntime.pty,
      runtimeOwnerId: 'window-observer',
    });
    try {
      const session = await ownerService.launch({
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
      });
      await observerService.list();
      ownerRuntime.exitHandlers.get(session.id)?.({ exitCode: 0 });
      await vi.waitFor(() => expect(recordSync.finalSync).toHaveBeenCalledWith(session.id, 'exit'));

      await expect(observerService.deleteSessionRecord({ sessionId: session.id }))
        .rejects.toThrow('该会话正在另一窗口运行');
      expect(recordSync.deleteSession).not.toHaveBeenCalled();

      exitFinalSync.resolve(snapshot(session.id));
      await vi.waitFor(() => expect(ownerRegistry.get(session.id)).toBeUndefined());
      await expect(observerService.deleteSessionRecord({ sessionId: session.id }))
        .resolves.toBeUndefined();
      await expect(historyStore.listSessions()).resolves.toEqual([]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await expect(historyStore.listSessions()).resolves.toEqual([]);
    } finally {
      exitFinalSync.resolve(snapshot('session-1'));
      await observerService.dispose();
      await ownerService.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the shared owner through dispose cleanup and its final metadata save', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-shared-dispose-owner-'));
    const ownerRuntime = createRuntime();
    const observerRuntime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    const ownerRegistry = createRuntimeOwnerRegistry();
    const closeStarted = deferred<void>();
    const allowClose = deferred<void>();
    const recordSync = createRecordSync();
    const ownerService = createSessionService({
      keychain: ownerRuntime.keychain,
      pty: ownerRuntime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-owner',
      runtimeOwnerRegistry: ownerRegistry,
      startClaudeCompatProxy: vi.fn().mockResolvedValue({
        baseUrl: 'http://127.0.0.1:43103',
        close: vi.fn(async () => {
          closeStarted.resolve();
          await allowClose.promise;
        }),
      }),
    });
    const observerService = createSessionService({
      keychain: observerRuntime.keychain,
      pty: observerRuntime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
      runtimeOwnerId: 'window-observer',
      runtimeOwnerRegistry: ownerRegistry,
    });
    let disposing: Promise<void> | undefined;
    try {
      const session = await ownerService.launch({
        profile: { ...profile('claude'), claudeAnthropicCompatProxyEnabled: true },
        workspace: workspace(tempDir),
        command: 'claude',
      });
      await observerService.list();
      disposing = ownerService.dispose();
      await closeStarted.promise;

      await expect(observerService.restart({
        sessionId: session.id,
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'fresh',
      })).rejects.toThrow('该会话正在另一窗口运行');
      expect(observerRuntime.spawnRequests).toEqual([]);

      allowClose.resolve();
      await disposing;
      await expect(observerService.restart({
        sessionId: session.id,
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'fresh',
      })).resolves.toMatchObject({ status: 'running' });
      const persisted = await historyStore.listSessions();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        id: session.id,
        status: 'running',
        runtimeOwner: { ownerId: 'window-observer' },
      });
    } finally {
      allowClose.resolve();
      await disposing?.catch(() => undefined);
      await observerService.dispose();
      await ownerService.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('recovers a durable cross-store deletion intent before exposing session history', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-delete-recovery-'));
    const historyStore = createSessionHistoryStore(tempDir);
    const sessionId = 'session-pending-delete';
    await historyStore.saveSession({
      id: sessionId,
      title: 'Claude A · AgentDock',
      profileId: 'claude-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'stopped',
      startedAt: '2026-07-25T00:00:00.000Z',
    });
    await historyStore.markDeletionPending(sessionId);

    const runtime = createRuntime();
    const recordSync = createRecordSync();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore: createSessionHistoryStore(tempDir),
      recordSync,
    });
    try {
      await expect(service.list()).resolves.toEqual([]);
      expect(recordSync.deleteSession).toHaveBeenCalledWith(sessionId);
      const reloadedHistoryStore = createSessionHistoryStore(tempDir);
      await expect(reloadedHistoryStore.listPendingDeletionIds()).resolves.toEqual([]);
      await expect(reloadedHistoryStore.listSessions()).resolves.toEqual([]);

      const secondRuntime = createRuntime();
      const secondRecordSync = createRecordSync();
      const secondService = createSessionService({
        keychain: secondRuntime.keychain,
        pty: secondRuntime.pty,
        appDataPath: tempDir,
        historyStore: reloadedHistoryStore,
        recordSync: secondRecordSync,
      });
      try {
        await expect(secondService.list()).resolves.toEqual([]);
        expect(secondRecordSync.deleteSession).not.toHaveBeenCalled();
      } finally {
        await secondService.dispose();
      }
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips session IDs that remain reserved by an incomplete deletion intent', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-delete-id-reservation-'));
    const seededHistoryStore = createSessionHistoryStore(tempDir);
    await seededHistoryStore.saveSession({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'claude-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'stopped',
      startedAt: '2026-07-25T00:00:00.000Z',
    });
    await seededHistoryStore.markDeletionPending('session-1');

    const runtime = createRuntime();
    const recordSync = createRecordSync({
      deleteSession: vi.fn().mockRejectedValue(new Error('record delete is still pending')),
    });
    const historyStore = createSessionHistoryStore(tempDir);
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      historyStore,
      recordSync,
    });
    try {
      await expect(service.list()).resolves.toEqual([]);

      const launched = await service.launch({
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
      });

      expect(launched.id).toBe('session-2');
      expect(runtime.spawnRequests[0]?.sessionId).toBe('session-2');
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: 'session-2', status: 'running' }),
      ]);
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('restores from clear records before transcript fallback and appends only a short restored status', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-clear-restore-'));
    const runtime = createRuntime();
    const clearRecordText = '用户：采用可信清晰记录。\nAgent：已确认恢复优先级。';
    const recordSync = createRecordSync({
      buildRestoreMaterial: vi.fn().mockResolvedValue(clearRecordText),
    });
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: tempDir,
      recordSync,
    });
    try {
      const session = await service.launch({
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
      });
      runtime.dataHandlers.get(session.id)?.('TRANSCRIPT-FALLBACK-MUST-NOT-BE-USED');
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
      await vi.waitFor(() => expect(recordSync.finalSync).toHaveBeenCalledWith(session.id, 'exit'));
      const restartPromise = service.restart({
        sessionId: session.id,
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'resume',
      });
      await vi.waitFor(() => expect(runtime.spawnRequests).toHaveLength(2));
      const restarted = await restartPromise;
      runtime.dataHandlers.get(session.id)?.('╭─── Claude Code v-test\n❯ ');
      await vi.waitFor(() => expect(runtime.writes).toHaveLength(1));
      expect(runtime.writes[0]).toContain(clearRecordText);
      expect(runtime.writes[0]).not.toContain('TRANSCRIPT-FALLBACK-MUST-NOT-BE-USED');
      expect(restarted.memoryRestore?.summary).toBe('记忆已恢复');
      await vi.waitFor(() => expect(recordSync.appendStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'restored', text: undefined }),
      ));
      const restoreFile = await readFile(
        path.join(tempDir, '.agentdock/context/restores/session-1.md'),
        'utf8',
      );
      expect(restoreFile).toContain('## Trusted Session Record');
      expect(restoreFile).not.toContain('TRANSCRIPT-FALLBACK-MUST-NOT-BE-USED');
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps native resume ahead of fallback and records one short restored status', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-native-record-restore-'));
    const runtime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    const recordSync = createRecordSync();
    let service: ReturnType<typeof createSessionService> | undefined;
    try {
      await historyStore.saveSession({
        id: 'session-native',
        title: 'Claude A · AgentDock',
        profileId: 'claude-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-25T00:00:00.000Z',
        nativeResume: {
          tool: 'claude',
          status: 'verified',
          sessionId: '123e4567-e89b-12d3-a456-426614174000',
        },
      });
      service = createSessionService({
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: tempDir,
        historyStore,
        recordSync,
      });
      await service.list();
      const restarted = await service.restart({
        sessionId: 'session-native',
        profile: profile('claude'),
        workspace: workspace(tempDir),
        command: 'claude',
        strategy: 'resume',
      });

      expect(runtime.spawnRequests[0].command).toBe(
        'claude --resume 123e4567-e89b-12d3-a456-426614174000',
      );
      expect(recordSync.buildRestoreMaterial).not.toHaveBeenCalled();
      expect(restarted.memoryRestore?.summary).toBe('记忆已恢复');
      expect(recordSync.appendStatus).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: restarted.id,
        code: 'restored',
        text: undefined,
      }));
    } finally {
      await service?.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
