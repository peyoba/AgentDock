import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import { createNodePtyAdapter } from '../../src/main/adapters/ptyAdapter';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('grok real pty smoke', () => {
  it('launches grok models with isolated GROK_HOME and disables conflicting auth.json', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdock-grok-real-'));
    tempRoots.push(tempDir);
    const grokHome = path.join(tempDir, 'grok-profiles', 'smoke');
    await fs.mkdir(grokHome, { recursive: true });
    await fs.writeFile(
      path.join(grokHome, 'auth.json'),
      `${JSON.stringify({ access_token: 'fake-session-token' })}\n`,
      'utf8',
    );

    const outputs: string[] = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-19T01:00:00.000Z') },
      keychain: {
        async readSecret() {
          return 'xai-smoke-not-a-real-key';
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: createNodePtyAdapter(),
      appDataPath: tempDir,
      homeDir: tempDir,
    });

    // SessionService may not expose onTerminalOutput; poll list + buffer
    const profile = {
      id: 'smoke-grok',
      name: 'Grok Smoke',
      toolType: 'grok' as const,
      baseUrl: 'https://api.x.ai/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'smoke-grok',
      grokAuthMode: 'api-key' as const,
      grokHome,
      defaultModel: 'grok-build',
    };
    const workspace = { id: 'ws', name: 'Smoke', path: tempDir };

    try {
      const session = await service.launch({
        profile,
        workspace,
        command: 'grok models',
      });
      expect(['starting', 'running', 'exited']).toContain(session.status);

      const deadline = Date.now() + 10_000;
      let final = session;
      while (Date.now() < deadline) {
        const listed = await service.list();
        final = listed.find((item) => item.id === session.id) ?? final;
        if (final.status === 'exited' || final.status === 'failed' || final.status === 'stopped') {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const buffer = await service.readTerminalBuffer?.({ sessionId: session.id }).catch(() => undefined);
      const files = await fs.readdir(grokHome);
      expect(files.some((name) => name.startsWith('auth.json.agentdock-disabled-'))).toBe(true);
      expect(files.includes('auth.json')).toBe(false);
      const config = await fs.readFile(path.join(grokHome, 'config.toml'), 'utf8');
      expect(config).toContain('default = "grok-build"');
      expect(config).toContain('alt_screen = "never"');
      // process should at least have been spawnable; exit code may be non-zero without real network auth
      expect(['running', 'exited', 'failed', 'stopped']).toContain(final.status);
      if (typeof buffer === 'string') {
        outputs.push(buffer);
      }
      const joined = outputs.join('');
      expect(joined.toLowerCase()).not.toContain('xai-smoke-not-a-real-key');
    } finally {
      await service.dispose();
    }
  }, 20_000);
});
