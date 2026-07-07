import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalPane } from '../../src/renderer/components/TerminalPane';
import type { AgentDockApi } from '../../src/shared/preloadTypes';
import type { TerminalOutputEvent } from '../../src/shared/agentdockTypes';

type DataListener = (data: string) => void;
type ResizeListener = (size: { cols: number; rows: number }) => void;

const { FakeTerminal } = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = [];
    static constructorOptions: unknown[] = [];
    static oscHandlers: Array<{
      ident: number;
      callback: (data: string) => boolean | Promise<boolean>;
      dispose: ReturnType<typeof vi.fn>;
    }> = [];

    cols = 80;
    rows = 24;
    buffer = {
      active: {
        baseY: 0,
        viewportY: 0,
      },
    };
    open = vi.fn((container: HTMLElement) => {
      const viewport = document.createElement('div');
      viewport.className = 'xterm-viewport';
      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, value: 100 },
        scrollHeight: { configurable: true, value: 1000 },
      });
      viewport.getBoundingClientRect = () => ({
        width: 10,
        height: 100,
        top: 0,
        right: 100,
        bottom: 100,
        left: 90,
        x: 90,
        y: 0,
        toJSON: () => undefined,
      });
      container.appendChild(viewport);
    });
    parser = {
      registerOscHandler: vi.fn((
        ident: number,
        callback: (data: string) => boolean | Promise<boolean>,
      ) => {
        const dispose = vi.fn();
        FakeTerminal.oscHandlers.push({ ident, callback, dispose });
        return { dispose };
      }),
    };
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    refresh = vi.fn();
    scrollLines = vi.fn();
    scrollToBottom = vi.fn();
    scrollToTop = vi.fn();
    write = vi.fn((_data: string, callback?: () => void) => {
      callback?.();
    });
    dispose = vi.fn();
    private dataListeners = new Set<DataListener>();
    private resizeListeners = new Set<ResizeListener>();

    constructor(options?: unknown) {
      FakeTerminal.constructorOptions.push(options);
      FakeTerminal.instances.push(this);
    }

    onData(listener: DataListener) {
      this.dataListeners.add(listener);
      return { dispose: () => this.dataListeners.delete(listener) };
    }

    onResize(listener: ResizeListener) {
      this.resizeListeners.add(listener);
      return { dispose: () => this.resizeListeners.delete(listener) };
    }

    emitData(data: string) {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    }

    emitResize(cols: number, rows: number) {
      for (const listener of this.resizeListeners) {
        listener({ cols, rows });
      }
    }
  }

  return { FakeTerminal };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: FakeTerminal,
}));

function expectTerminalWriteData(terminal: { write: ReturnType<typeof vi.fn> }, data: string): void {
  expect(terminal.write.mock.calls.map(([written]) => written)).toContain(data);
}

describe('TerminalPane xterm binding', () => {
  let outputListener: ((event: TerminalOutputEvent) => void) | undefined;
  let unsubscribeOutput: ReturnType<typeof vi.fn>;
  let agentDock: AgentDockApi;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    FakeTerminal.instances = [];
    FakeTerminal.constructorOptions = [];
    FakeTerminal.oscHandlers = [];
    outputListener = undefined;
    unsubscribeOutput = vi.fn();
    originalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      paddingLeft: '20px',
      paddingRight: '20px',
      paddingTop: '10px',
      paddingBottom: '10px',
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth() {
      return this.classList.contains('terminal-surface') ? 1000 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getClientHeight() {
      return this.classList.contains('terminal-surface') ? 620 : 0;
    });
    agentDock = {
      version: '0.1.0',
      listProfiles: vi.fn().mockResolvedValue([]),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      saveProfile: vi.fn(),
      launchSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      writeTerminal: vi.fn().mockResolvedValue(undefined),
      resizeTerminal: vi.fn().mockResolvedValue(undefined),
      killTerminal: vi.fn(),
      readTerminalBuffer: vi.fn().mockResolvedValue(''),
      onTerminalOutput: vi.fn((listener) => {
        outputListener = listener;
        return unsubscribeOutput;
      }),
    };
    window.agentDock = agentDock;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
  });



  it('shows a clear empty state instead of a fake terminal transcript when no session is running', () => {
    render(<TerminalPane />);

    expect(document.body).toHaveTextContent('尚未启动真实终端');
    expect(document.body).not.toHaveTextContent('Claude Code 正在启动');
    expect(FakeTerminal.instances).toHaveLength(0);
  });

  it('replays buffered PTY output when the real terminal mounts', async () => {
    agentDock.readTerminalBuffer = vi.fn().mockResolvedValue('restored prompt % ');

    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expect(agentDock.readTerminalBuffer).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expectTerminalWriteData(terminal, 'restored prompt % ');
    });
  });

  it('does not duplicate live output that raced the buffer replay', async () => {
    let resolveBuffer: ((value: string) => void) | undefined;
    agentDock.readTerminalBuffer = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveBuffer = resolve;
        }),
    );

    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    act(() => outputListener?.({ sessionId: 'session-1', data: 'early chunk' }));
    expect(terminal.write).not.toHaveBeenCalled();

    await act(async () => {
      resolveBuffer?.('replayed early chunk');
    });

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expectTerminalWriteData(terminal, 'replayed early chunk');

    act(() => outputListener?.({ sessionId: 'session-1', data: ' later chunk' }));
    expectTerminalWriteData(terminal, ' later chunk');
  });

  it('flushes queued live output when the buffer replay fails', async () => {
    let rejectBuffer: ((error: Error) => void) | undefined;
    agentDock.readTerminalBuffer = vi.fn().mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectBuffer = reject;
        }),
    );

    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    act(() => outputListener?.({ sessionId: 'session-1', data: 'queued chunk' }));
    expect(terminal.write).not.toHaveBeenCalled();

    await act(async () => {
      rejectBuffer?.(new Error('buffer unavailable'));
    });

    expectTerminalWriteData(terminal, 'queued chunk');
  });

  it('keeps a large terminal scrollback so previous context is not wiped by new output', () => {
    render(<TerminalPane sessionId="session-1" />);

    expect(FakeTerminal.constructorOptions[0]).toMatchObject({
      scrollback: 50_000,
    });
  });

  it('strips terminal control output when replaying read-only preserved history', async () => {
    agentDock.readTerminalBuffer = vi.fn().mockResolvedValue(
      '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[HOLD CONTEXT\n\u001b[3J\u001b[32mNEW CONTEXT\u001b[0m',
    );

    render(<TerminalPane sessionId="session-1" readOnly />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expectTerminalWriteData(
        terminal,
        'OLD CONTEXT\nNEW CONTEXT',
      );
    });
  });

  it('collapses TUI spinner redraws before replaying an exited agent history', async () => {
    agentDock.readTerminalBuffer = vi.fn().mockResolvedValue(
      [
        '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[H',
        'Working(9s • esc to interrupt)\r\u001b[2K',
        '\u001b[38;5;244m> 你好\u001b[0m\r\n',
        '\u001b[39m用户确认：保留最近对话。\u001b[0m',
      ].join(''),
    );

    render(<TerminalPane sessionId="session-1" readOnly />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expectTerminalWriteData(terminal, '> 你好\n用户确认：保留最近对话。');
    });
  });

  it('keeps raw terminal control sequences for live agent output', async () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    await act(async () => {});
    const liveOutput =
      '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[HWorking(9s • esc to interrupt)\r\u001b[2KDone';

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: liveOutput,
      }),
    );

    expectTerminalWriteData(terminal, liveOutput);
  });

  it('suppresses xterm color query replies for live agent sessions only', async () => {
    render(<TerminalPane sessionId="session-1" preserveHistory />);

    const registeredIdents = FakeTerminal.oscHandlers.map((handler) => handler.ident);
    expect(registeredIdents).toEqual(expect.arrayContaining([4, 10, 11, 12]));

    const foregroundHandler = FakeTerminal.oscHandlers.find((handler) => handler.ident === 10);
    expect(foregroundHandler?.callback('?')).toBe(true);
    expect(foregroundHandler?.callback('rgb:ffff/ffff/ffff')).toBe(false);
  });

  it('does not install agent-only OSC query guards for local shell sessions', async () => {
    render(<TerminalPane sessionId="session-1" preserveHistory={false} />);

    expect(FakeTerminal.oscHandlers).toHaveLength(0);
  });

  it('strips echoed terminal color replies from live agent output', async () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    await act(async () => {});

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: 'ready ^[]10;rgb:ffff/ffff/ffff^[\\^[]11;rgb:0000/0000/0000^[\\ next',
      }),
    );

    expectTerminalWriteData(terminal, 'ready  next');
  });

  it('strips raw terminal color replies from replayed agent output', async () => {
    agentDock.readTerminalBuffer = vi
      .fn()
      .mockResolvedValue('old\u001b]10;rgb:ffff/ffff/ffff\u001b\\ output');

    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expectTerminalWriteData(terminal, 'old output');
    });
  });

  it('keeps an agent session pinned to the bottom when live redraw output moves the viewport', async () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    terminal.buffer.active.baseY = 200;
    terminal.buffer.active.viewportY = 200;
    terminal.write.mockImplementation((_data: string, callback?: () => void) => {
      terminal.buffer.active.viewportY = 0;
      callback?.();
    });
    await act(async () => {});

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: '\u001b[2J\u001b[Hredrawn screen',
      }),
    );

    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('does not force the terminal to the bottom while the user is reading earlier output', async () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    terminal.buffer.active.baseY = 200;
    terminal.buffer.active.viewportY = 12;
    await act(async () => {});

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: 'background update',
      }),
    );

    expect(terminal.scrollToBottom).not.toHaveBeenCalled();
  });

  it('keeps raw terminal control sequences when replaying a live agent session', async () => {
    const replayedOutput =
      '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[HWorking(9s • esc to interrupt)\r\u001b[2KDone';
    agentDock.readTerminalBuffer = vi.fn().mockResolvedValue(replayedOutput);

    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expectTerminalWriteData(terminal, replayedOutput);
    });
  });

  it('keeps raw terminal control sequences for local shell sessions', async () => {
    render(<TerminalPane sessionId="session-1" preserveHistory={false} />);
    const terminal = FakeTerminal.instances[0];
    await act(async () => {});
    const rawOutput ='\u001b[?1049h\u001b[2J\u001b[Hvim screen';

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: rawOutput,
      }),
    );

    expectTerminalWriteData(terminal, rawOutput);
  });

  it('fits xterm columns to the full terminal surface and syncs the PTY size', async () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    await vi.waitFor(() => {
      expect(terminal.resize).toHaveBeenCalled();
    });

    const [cols, rows] = terminal.resize.mock.calls[0];
    expect(cols).toBeGreaterThan(80);
    expect(rows).toBeGreaterThan(24);
    expect(terminal.refresh).toHaveBeenCalledWith(0, rows - 1);
    expect(agentDock.resizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cols,
      rows,
    });
  });

  it('keeps mouse wheel scrolling attached to terminal history for agent sessions', () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    const terminalSurface = document.querySelector('.terminal-surface');

    expect(terminalSurface).not.toBeNull();
    act(() => {
      terminalSurface?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true }));
    });

    expect(terminal.scrollLines).toHaveBeenCalledWith(3);
  });

  it('lets users drag the terminal scrollbar thumb to jump through long output', async () => {
    render(<TerminalPane sessionId="session-1" />);

    const scrollbar = await vi.waitFor(() => {
      const element = document.querySelector('[aria-label="终端滚动条"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    Object.defineProperties(scrollbar, {
      clientHeight: { configurable: true, value: 100 },
    });
    scrollbar.getBoundingClientRect = () => ({
      width: 10,
      height: 100,
      top: 0,
      right: 100,
      bottom: 100,
      left: 90,
      x: 90,
      y: 0,
      toJSON: () => undefined,
    });

    const thumb = scrollbar.querySelector('.terminal-drag-scrollbar-thumb') as HTMLElement;
    expect(thumb).not.toBeNull();
    thumb.getBoundingClientRect = () => ({
      width: 10,
      height: 32,
      top: 0,
      right: 100,
      bottom: 32,
      left: 90,
      x: 90,
      y: 0,
      toJSON: () => undefined,
    });

    act(() => {
      thumb.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientY: 0, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 100, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 100, bubbles: true }));
    });

    const viewport = document.querySelector('.xterm-viewport') as HTMLElement;
    expect(viewport.scrollTop).toBe(900);
  });

  it('lets users jump directly to the top or bottom of terminal history', () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="滚到顶部"]')?.click();
    });
    expect(terminal.scrollToTop).toHaveBeenCalledTimes(1);

    act(() => {
      document.querySelector<HTMLButtonElement>('[aria-label="滚到底部"]')?.click();
    });
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('reveals the scrollbar while scrolling and fades it out after scrolling stops', () => {
    vi.useFakeTimers();
    try {
      render(<TerminalPane sessionId="session-1" />);
      const scrollbar = document.querySelector('[aria-label="终端滚动条"]') as HTMLElement;
      const viewport = document.querySelector('.xterm-viewport') as HTMLElement;

      expect(scrollbar).not.toBeNull();
      expect(scrollbar.classList.contains('is-active')).toBe(false);

      act(() => {
        viewport.dispatchEvent(new Event('scroll'));
      });
      expect(scrollbar.classList.contains('is-active')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(scrollbar.classList.contains('is-active')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the scrollbar visible while hovering and hides it after the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      render(<TerminalPane sessionId="session-1" />);
      const scrollbar = document.querySelector('[aria-label="终端滚动条"]') as HTMLElement;

      act(() => {
        scrollbar.dispatchEvent(new PointerEvent('pointerenter', { pointerId: 1 }));
        vi.advanceTimersByTime(5000);
      });
      expect(scrollbar.classList.contains('is-active')).toBe(true);

      act(() => {
        scrollbar.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }));
        vi.advanceTimersByTime(1500);
      });
      expect(scrollbar.classList.contains('is-active')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates an xterm instance and bridges input, resize, and scoped output through IPC', async () => {
    const { unmount } = render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];
    await act(async () => {});

    expect(terminal.open).toHaveBeenCalledTimes(1);
    expect(agentDock.onTerminalOutput).toHaveBeenCalledTimes(1);

    act(() => terminal.emitData('help\n'));
    expect(agentDock.writeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      input: 'help\n',
    });

    act(() => terminal.emitResize(120, 32));
    expect(agentDock.resizeTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cols: 120,
      rows: 32,
    });

    act(() => outputListener?.({ sessionId: 'other-session', data: 'ignore me' }));
    act(() => outputListener?.({ sessionId: 'session-1', data: 'hello from pty' }));
    expect(terminal.write).toHaveBeenCalledTimes(1);
    expectTerminalWriteData(terminal, 'hello from pty');

    unmount();
    expect(unsubscribeOutput).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });

  it('replays output but does not bridge user input when the terminal is read-only', async () => {
    agentDock.readTerminalBuffer = vi.fn().mockResolvedValue('restored interrupted output');

    render(<TerminalPane sessionId="session-1" readOnly />);
    const terminal = FakeTerminal.instances[0];
    await vi.waitFor(() => {
      expectTerminalWriteData(terminal, 'restored interrupted output');
    });

    expect(FakeTerminal.constructorOptions[0]).toMatchObject({
      disableStdin: true,
    });

    act(() => terminal.emitData('help\n'));

    expect(agentDock.writeTerminal).not.toHaveBeenCalled();
  });
});
