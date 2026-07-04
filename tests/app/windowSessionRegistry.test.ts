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
    const registry = createWindowSessionRegistry((windowId) =>
      createFakeSessionService(String(windowId)),
    );

    const first = registry.getOrCreate(1);
    const second = registry.getOrCreate(2);

    await registry.delete(1);

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(registry.getOrCreate(1)).not.toBe(first);
  });
});
