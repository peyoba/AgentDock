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

    open = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    private dataListeners = new Set<DataListener>();
    private resizeListeners = new Set<ResizeListener>();

    constructor() {
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

  beforeEach(() => {
    FakeTerminal.instances = [];
    outputListener = undefined;
    unsubscribeOutput = vi.fn();
    agentDock = {
      version: '0.1.0',
      listProfiles: vi.fn().mockResolvedValue([]),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      launchSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      writeTerminal: vi.fn().mockResolvedValue(undefined),
      resizeTerminal: vi.fn().mockResolvedValue(undefined),
      killTerminal: vi.fn(),
      onTerminalOutput: vi.fn((listener) => {
        outputListener = listener;
        return unsubscribeOutput;
      }),
    };
    window.agentDock = agentDock;
  });

  afterEach(() => {
    vi.clearAllMocks();
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
