import React from 'react';
import { Terminal } from '@xterm/xterm';
import { preserveTerminalHistoryOutput } from '../terminalOutput';

type TerminalPaneProps = {
  sessionId?: string;
  preserveHistory?: boolean;
};

const TERMINAL_FONT_FAMILY = 'SFMono-Regular, Consolas, monospace';
const TERMINAL_FONT_SIZE = 13;
const FALLBACK_CELL_WIDTH = 8;
const FALLBACK_CELL_HEIGHT = 18;
const MIN_COLS = 20;
const MIN_ROWS = 8;

function numberFromCssPixel(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureTerminalCell(container: HTMLElement): { width: number; height: number } {
  const probe = document.createElement('span');
  probe.textContent = 'W';
  probe.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    'white-space:pre',
    `font-family:${TERMINAL_FONT_FAMILY}`,
    `font-size:${TERMINAL_FONT_SIZE}px`,
    'line-height:1.4',
  ].join(';');

  container.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  return {
    width: Math.max(7, rect.width || FALLBACK_CELL_WIDTH),
    height: Math.max(15, rect.height || FALLBACK_CELL_HEIGHT),
  };
}

function calculateTerminalFit(container: HTMLElement): { cols: number; rows: number } {
  const style = window.getComputedStyle(container);
  const horizontalPadding =
    numberFromCssPixel(style.paddingLeft) + numberFromCssPixel(style.paddingRight);
  const verticalPadding =
    numberFromCssPixel(style.paddingTop) + numberFromCssPixel(style.paddingBottom);
  const containerRect = container.getBoundingClientRect();
  const availableWidth = Math.max(
    0,
    Math.max(container.clientWidth, containerRect.width) - horizontalPadding,
  );
  const availableHeight = Math.max(
    0,
    Math.max(container.clientHeight, containerRect.height) - verticalPadding,
  );
  const cell = measureTerminalCell(container);

  return {
    cols: Math.max(MIN_COLS, Math.floor(availableWidth / cell.width)),
    rows: Math.max(MIN_ROWS, Math.floor(availableHeight / cell.height)),
  };
}

export function TerminalPane({
  sessionId,
  preserveHistory = true,
}: TerminalPaneProps): React.JSX.Element {
  const terminalElementRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!sessionId || !terminalElementRef.current || !window.agentDock) {
      return undefined;
    }

    let disposed = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      scrollback: 50_000,
    });

    terminal.open(terminalElementRef.current);

    const fitTerminal = (): void => {
      const container = terminalElementRef.current;
      if (!container) {
        return;
      }

      const { cols, rows } = calculateTerminalFit(container);
      if (cols === terminal.cols && rows === terminal.rows) {
        return;
      }

      terminal.resize(cols, rows);
      terminal.refresh(0, rows - 1);
      void window.agentDock
        .resizeTerminal({ sessionId, cols, rows })
        .catch(() => undefined);
    };

    fitTerminal();
    const fitFrame = window.requestAnimationFrame?.(fitTerminal);
    const fitTimers = [0, 120, 360].map((delay) => window.setTimeout(fitTerminal, delay));
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            fitTerminal();
          });
    resizeObserver?.observe(terminalElementRef.current);

    const wheelListener = (event: WheelEvent): void => {
      if (!preserveHistory || event.deltaY === 0) {
        return;
      }

      terminal.scrollLines(Math.sign(event.deltaY) * Math.max(1, Math.ceil(Math.abs(event.deltaY) / 40)));
      event.preventDefault();
      event.stopPropagation();
    };
    terminalElementRef.current.addEventListener('wheel', wheelListener, {
      capture: true,
      passive: false,
    });

    const writeOutput = (data: string): void => {
      terminal.write(preserveHistory ? preserveTerminalHistoryOutput(data) : data);
    };
    void window.agentDock
      .readTerminalBuffer({ sessionId })
      .then((buffer) => {
        if (!disposed && buffer) {
          writeOutput(buffer);
        }
      })
      .catch(() => undefined);

    const dataSubscription = terminal.onData((input) => {
      void window.agentDock.writeTerminal({ sessionId, input }).catch(() => undefined);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      void window.agentDock
        .resizeTerminal({ sessionId, cols, rows })
        .catch(() => undefined);
    });
    const unsubscribeOutput = window.agentDock.onTerminalOutput((event) => {
      if (event.sessionId === sessionId) {
        writeOutput(event.data);
      }
    });

    return () => {
      disposed = true;
      if (fitFrame !== undefined) {
        window.cancelAnimationFrame?.(fitFrame);
      }
      fitTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
      terminalElementRef.current?.removeEventListener('wheel', wheelListener, true);
      dataSubscription.dispose();
      resizeSubscription.dispose();
      unsubscribeOutput();
      terminal.dispose();
    };
  }, [preserveHistory, sessionId]);

  if (!window.agentDock) {
    return (
      <section className="terminal-preview terminal-empty" aria-label="终端状态">
        <h2>Electron API 未连接</h2>
        <p>请从打包后的 AgentDock App 启动，浏览器预览不会连接真实 PTY。</p>
      </section>
    );
  }

  if (!sessionId) {
    return (
      <section className="terminal-preview terminal-empty" aria-label="终端状态">
        <h2>尚未启动真实终端</h2>
        <p>选择 API 配置、工作区和命令后，点击“启动终端”会创建真实 node-pty 会话。</p>
        <p>如果只是想验证终端输入输出，请在命令下拉里选择 zsh。</p>
      </section>
    );
  }

  return (
    <div
      ref={terminalElementRef}
      aria-label="终端输出"
      className="terminal-preview terminal-surface"
      role="region"
    />
  );
}
