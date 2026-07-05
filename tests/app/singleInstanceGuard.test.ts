import { describe, expect, it, vi } from 'vitest';
import { installSingleInstanceGuard } from '../../src/main/singleInstanceGuard';

describe('singleInstanceGuard', () => {
  it('quits the second app instance before it can write shared state', () => {
    const quit = vi.fn();
    const app = {
      requestSingleInstanceLock: vi.fn(() => false),
      quit,
      on: vi.fn(),
    };

    const installed = installSingleInstanceGuard({
      app,
      getAllWindows: () => [],
    });

    expect(installed).toBe(false);
    expect(quit).toHaveBeenCalled();
    expect(app.on).not.toHaveBeenCalled();
  });

  it('focuses the existing window when a second instance is opened', () => {
    let secondInstanceListener: (() => void) | undefined;
    const restore = vi.fn();
    const focus = vi.fn();
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((_event: string, listener: () => void) => {
        secondInstanceListener = listener;
      }),
    };

    const installed = installSingleInstanceGuard({
      app,
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          isMinimized: () => true,
          restore,
          focus,
        },
      ],
    });

    expect(installed).toBe(true);
    secondInstanceListener?.();

    expect(restore).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('opens a new window for a second instance when the primary app has no windows', () => {
    let secondInstanceListener: (() => void) | undefined;
    const openWindow = vi.fn();
    const app = {
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn((_event: string, listener: () => void) => {
        secondInstanceListener = listener;
      }),
    };

    const installed = installSingleInstanceGuard({
      app,
      getAllWindows: () => [],
      openWindow,
    });

    expect(installed).toBe(true);
    secondInstanceListener?.();

    expect(openWindow).toHaveBeenCalledTimes(1);
  });
});
