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
    expect(session.startedAt).toBe('2026-07-01T00:00:00.000Z');
    await expect(service.list()).resolves.toEqual([session]);
  });
});
