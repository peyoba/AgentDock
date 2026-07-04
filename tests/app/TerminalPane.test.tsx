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

    cols = 80;
    rows = 24;
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
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    refresh = vi.fn();
    scrollLines = vi.fn();
    write = vi.fn();
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

describe('TerminalPane xterm binding', () => {
  let outputListener: ((event: TerminalOutputEvent) => void) | undefined;
  let unsubscribeOutput: ReturnType<typeof vi.fn>;
  let agentDock: AgentDockApi;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    FakeTerminal.instances = [];
    FakeTerminal.constructorOptions = [];
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
      expect(terminal.write).toHaveBeenCalledWith('restored prompt % ');
    });
  });

  it('keeps a large terminal scrollback so previous context is not wiped by new output', () => {
    render(<TerminalPane sessionId="session-1" />);

    expect(FakeTerminal.constructorOptions[0]).toMatchObject({
      scrollback: 50_000,
    });
  });

  it('only strips alternate-screen and scrollback-clear output in history-preserving agent sessions', () => {
    render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[HOLD CONTEXT\n\u001b[3J\u001b[32mNEW CONTEXT\u001b[0m',
      }),
    );

    expect(terminal.write).toHaveBeenCalledWith(
      '\u001b[2J\u001b[HOLD CONTEXT\n\u001b[32mNEW CONTEXT\u001b[0m',
    );
  });

  it('keeps raw terminal control sequences for local shell sessions', () => {
    render(<TerminalPane sessionId="session-1" preserveHistory={false} />);
    const terminal = FakeTerminal.instances[0];
    const rawOutput = '\u001b[?1049h\u001b[2J\u001b[Hvim screen';

    act(() =>
      outputListener?.({
        sessionId: 'session-1',
        data: rawOutput,
      }),
    );

    expect(terminal.write).toHaveBeenCalledWith(rawOutput);
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

  it('creates an xterm instance and bridges input, resize, and scoped output through IPC', () => {
    const { unmount } = render(<TerminalPane sessionId="session-1" />);
    const terminal = FakeTerminal.instances[0];

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
    expect(terminal.write).toHaveBeenCalledWith('hello from pty');

    unmount();
    expect(unsubscribeOutput).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });
});
