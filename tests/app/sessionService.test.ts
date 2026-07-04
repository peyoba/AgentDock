import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter, PtySpawnRequest } from '../../src/main/adapters/ptyAdapter';

function createFakeRuntime() {
  const spawnRequests: PtySpawnRequest[] = [];

  const keychain: KeychainAdapter = {
    async readSecret(service, account) {
      expect(service).toBe('AgentDock');
      expect(account).toBe('profile-a');
      return 'local-development-secret';
    },
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn(request) {
      spawnRequests.push(request);
      return {
        id: request.sessionId,
        write() {},
        resize() {},
        kill() {},
        onData() {
          return () => {};
        },
      };
    },
  };

  return { keychain, pty, spawnRequests };
}

describe('sessionService', () => {
  it('launches a session through injected keychain and PTY adapters', async () => {
    const runtime = createFakeRuntime();
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
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

    expect(session).toEqual({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(await service.list()).toEqual([session]);
    expect(runtime.spawnRequests).toEqual([
      {
        sessionId: 'session-1',
        command: 'claude',
        cwd: '/Users/example/Desktop/web/AgentDock',
        env: {
          ANTHROPIC_BASE_URL: 'https://example.invalid/v1',
          ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
        },
      },
    ]);
  });

  it('writes Claude settings without secrets when model, cleanup, or env settings are configured', async () => {
    const runtime = createFakeRuntime();
    const ensuredDirectories: string[] = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      ensureDirectory(directoryPath) {
        ensuredDirectories.push(directoryPath);
      },
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
        claudeHaikuModel: 'claude-haiku-4-5-20251001',
        claudeSonnetModel: 'claude-fable-5',
        claudeOpusModel: 'claude-opus-4-8',
        claudeDefaultLaunchMode: 'opus',
        claudeAlwaysThinkingEnabled: true,
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'http://127.0.0.1:7897',
        httpsProxy: 'http://127.0.0.1:7897',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
        claudeCleanupPeriodDays: 720,
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
    });

    expect(ensuredDirectories).toEqual(['/tmp/agentdock-test-data/claude-settings']);
    expect(writtenFiles).toEqual([
      {
        filePath: '/tmp/agentdock-test-data/claude-settings/profile-a.json',
        content: `${JSON.stringify({
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
          cleanupPeriodDays: 720,
        }, null, 2)}\n`,
      },
    ]);
    expect(writtenFiles[0]?.content).not.toContain('local-development-secret');
    expect(runtime.spawnRequests[0]?.command).toBe(
      "claude --dangerously-skip-permissions --settings '/tmp/agentdock-test-data/claude-settings/profile-a.json'",
    );
  });

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
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(JSON.parse(writtenFiles[0].content).model).toBe('claude-opus-4-8');
  });

  it('launches Claude lite mode with isolated settings and empty strict MCP config without changing model betas or retry settings', async () => {
    const runtime = createFakeRuntime();
    const ensuredDirectories: string[] = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      ensureDirectory(directoryPath) {
        ensuredDirectories.push(directoryPath);
      },
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
        defaultModel: 'claude-fable-5',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
      claudeLaunchMode: 'lite',
    });

    expect(ensuredDirectories).toEqual([
      '/tmp/agentdock-test-data/claude-settings',
      '/tmp/agentdock-test-data/claude-mcp',
    ]);
    expect(writtenFiles).toEqual([
      {
        filePath: '/tmp/agentdock-test-data/claude-settings/profile-a.json',
        content: `${JSON.stringify({
          model: 'claude-fable-5',
          env: {
            ANTHROPIC_MODEL: 'claude-fable-5',
            CLAUDE_CODE_RETRY_WATCHDOG: '1',
            CLAUDE_CODE_MAX_RETRIES: '100',
            ANTHROPIC_BETAS: 'context-1m-2025-08-07',
          },
        }, null, 2)}\n`,
      },
      {
        filePath: '/tmp/agentdock-test-data/claude-mcp/empty.json',
        content: `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
      },
    ]);
    expect(runtime.spawnRequests[0]?.command).toBe(
      "claude --dangerously-skip-permissions --settings '/tmp/agentdock-test-data/claude-settings/profile-a.json' --setting-sources project,local --mcp-config '/tmp/agentdock-test-data/claude-mcp/empty.json' --strict-mcp-config",
    );
  });

  it('launches Claude full mode without strict MCP isolation', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
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
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
      claudeLaunchMode: 'full',
    });

    expect(writtenFiles).toEqual([]);
    expect(runtime.spawnRequests[0]?.command).toBe('claude --dangerously-skip-permissions');
  });
});
