import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter } from '../../src/main/adapters/ptyAdapter';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';

const secret = 'test-openai-secret-that-must-not-reach-renderer';

function createService() {
  const keychain: KeychainAdapter = {
    async readSecret() {
      return secret;
    },
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn() {
      return {
        id: 'pty-session-1',
        write() {},
        resize() {},
        kill() {},
        onData() {
          return () => {};
        },
      };
    },
  };

  return createSessionService({
    clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
    keychain,
    pty,
    appDataPath: '/tmp/agentdock-test-data',
  });
}

describe('sessionService security boundary', () => {
  it('does not return complete secrets or complete env snapshots to callers', async () => {
    const service = createService();

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Codex A',
        toolType: 'codex',
        baseUrl: 'https://openai.example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'codex',
    });

    const returnedPayload = JSON.stringify({ session, sessions: await service.list() });

    expect(returnedPayload).not.toContain(secret);
    expect(returnedPayload).not.toContain('OPENAI_API_KEY');
    expect(returnedPayload).not.toContain('OPENAI_BASE_URL');
    expect(returnedPayload).not.toContain('CODEX_HOME');
    expect(session).not.toHaveProperty('env');
    expect(session).not.toHaveProperty('secret');
  });

  it('does not expose compat proxy secrets in session payloads', async () => {
    const keychain: KeychainAdapter = {
      async readSecret() {
        return secret;
      },
      async writeSecret() {},
      async deleteSecret() {},
    };
    const pty: PtyAdapter = {
      async spawn() {
        return {
          id: 'pty-session-1',
          write() {},
          resize() {},
          kill() {},
          onData() {
            return () => {};
          },
        };
      },
    };
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain,
      pty,
      appDataPath: '/tmp/agentdock-test-data',
      startClaudeCompatProxy: async () => ({
        baseUrl: 'http://127.0.0.1:43000',
        close: async () => undefined,
      }),
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://upstream.example',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeAnthropicCompatProxyEnabled: true,
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    const returnedPayload = JSON.stringify({ session, sessions: await service.list() });
    expect(returnedPayload).not.toContain(secret);
    expect(returnedPayload).not.toContain('ANTHROPIC_AUTH_TOKEN');
    expect(returnedPayload).not.toContain('Authorization');
    expect(returnedPayload).not.toContain('Bearer');
  });

  it('does not expose restore context body, instruction, or secrets in session metadata', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-security-'));
    const historyStore = createSessionHistoryStore(tempDir);
    const spawnCommands: string[] = [];
    const writes: string[] = [];
    const dataHandlers = new Map<string, (data: string) => void>();
    const exitHandlers = new Map<string, (event: { exitCode: number }) => void>();
    const pty: PtyAdapter = {
      async spawn(request) {
        spawnCommands.push(request.command);
        return {
          id: request.sessionId,
          write(input) {
            writes.push(input);
          },
          resize() {},
          kill() {},
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

    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: {
          async readSecret() {
            return secret;
          },
          async writeSecret() {},
          async deleteSecret() {},
        },
        pty,
        appDataPath: tempDir,
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };
      const fakeOpenAiKey = ['sk', 'test-session-security-redaction-token'].join('-');

      const session = await service.launch({ profile, workspace, command: 'claude' });
      dataHandlers.get(session.id)?.([
        'Current task relies on short memory restore.',
        `OPENAI_API_KEY=${fakeOpenAiKey}`,
        `Provider authentication marker: ${secret}`,
      ].join('\n'));
      await historyStore.readBuffer(session.id);
      exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restartPromise = service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });
      const restoreContextFile = path.join(tempDir, '.agentdock/context/restores/session-1.md');

      await vi.waitFor(() => expect(spawnCommands).toHaveLength(2));
      expect(spawnCommands.at(-1)).toBe('claude --resume c4bf-b857');
      expect(spawnCommands.at(-1)).not.toContain('--append-system-prompt');
      expect(spawnCommands.at(-1)).not.toContain('<agentdock-restored-memory>');
      expect(spawnCommands.at(-1)).not.toContain('Current task relies on short memory restore.');
      expect(writes).toEqual([]);

      const restarted = await restartPromise;
      expect(writes).toEqual([]);
      dataHandlers.get(session.id)?.('╭─── Claude Code v-test\n❯ ');
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      const returnedPayload = JSON.stringify({ restarted, sessions: await service.list() });
      expect(restarted.memoryRestore).toMatchObject({
        status: 'loaded',
        summary: '记忆已恢复',
        contextFile: restoreContextFile,
      });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('<agentdock-restored-memory>');
      expect(writes[0]).toContain('Current task relies on short memory restore.');
      expect(writes[0]).not.toContain(secret);
      expect(writes[0]).not.toContain(fakeOpenAiKey);
      expect(writes[0]).not.toContain('OPENAI_API_KEY');
      dataHandlers.get(session.id)?.('❯ ');
      expect(writes).toHaveLength(1);
      expect(returnedPayload).not.toContain('Read the AgentDock restore context file');
      expect(returnedPayload).not.toContain('AgentDock Restore Context');
      expect(returnedPayload).not.toContain('Transcript Tail');
      expect(returnedPayload).not.toContain(secret);
      expect(returnedPayload).not.toContain(fakeOpenAiKey);
      expect(returnedPayload).not.toContain('OPENAI_API_KEY');

      const restoreContext = await readFile(restoreContextFile, 'utf-8');
      expect(restoreContext).toContain('Current task relies on short memory restore.');
      expect(restoreContext).not.toContain('OPENAI_API_KEY');
      expect(restoreContext).not.toContain(fakeOpenAiKey);
      expect(restoreContext).not.toContain(secret);
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });
});
