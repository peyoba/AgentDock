import React from 'react';
import { Terminal } from '@xterm/xterm';
import {
  preserveLiveAgentOutput,
  preserveTerminalHistoryOutput,
} from '../terminalOutput';

type TerminalPaneProps = {
  sessionId?: string;
  preserveHistory?: boolean;
  readOnly?: boolean;
};

const TERMINAL_FONT_FAMILY = 'SFMono-Regular, Consolas, monospace';
const TERMINAL_FONT_SIZE = 13;
const FALLBACK_CELL_WIDTH = 8;
const FALLBACK_CELL_HEIGHT = 18;
const MIN_COLS = 20;
const MIN_ROWS = 8;
const SCROLLBAR_HIDE_DELAY_MS = 900;
const AGENT_OSC_QUERY_IDS = [4, 10, 11, 12] as const;

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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTerminalAtScrollbackBottom(terminal: Terminal): boolean {
  const activeBuffer = terminal.buffer.active;
  return activeBuffer.viewportY >= activeBuffer.baseY - 1;
}

function isOscColorQueryPayload(data: string): boolean {
  return data.split(';').some((part) => part.trim() === '?');
}

function installAgentOscQueryGuards(terminal: Terminal): () => void {
  const disposables = AGENT_OSC_QUERY_IDS.map((ident) =>
    terminal.parser.registerOscHandler(ident, (data) => isOscColorQueryPayload(data)),
  );

  return () => {
    disposables.forEach((disposable) => disposable.dispose());
  };
}

function installTerminalDragScrollbar(container: HTMLElement): () => void {
  const viewport = container.querySelector<HTMLElement>('.xterm-viewport');
  if (!viewport) {
    return () => undefined;
  }

  const track = document.createElement('div');
  const thumb = document.createElement('div');
  track.className = 'terminal-drag-scrollbar';
  track.setAttribute('role', 'scrollbar');
  track.setAttribute('aria-label', '终端滚动条');
  track.setAttribute('aria-orientation', 'vertical');
  track.setAttribute('aria-valuemin', '0');
  thumb.className = 'terminal-drag-scrollbar-thumb';
  track.appendChild(thumb);
  container.appendChild(track);

  let dragging = false;
  let dragOffset = 0;
  let hovering = false;
  let hideTimer: number | undefined;

  const showScrollbar = (): void => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
    track.classList.add('is-active');
  };

  const scheduleScrollbarHide = (): void => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined;
      if (!dragging && !hovering) {
        track.classList.remove('is-active');
      }
    }, SCROLLBAR_HIDE_DELAY_MS);
  };

  const scrollbarMetrics = () => {
    const trackHeight =
      track.clientHeight || track.getBoundingClientRect().height || viewport.clientHeight;
    const viewportHeight = viewport.clientHeight;
    const scrollHeight = viewport.scrollHeight;
    const maxScroll = Math.max(0, scrollHeight - viewportHeight);
    const proportionalHeight = scrollHeight > 0 ? (trackHeight * viewportHeight) / scrollHeight : trackHeight;
    const thumbHeight = clampNumber(proportionalHeight, Math.min(32, trackHeight), trackHeight);
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);

    return { maxScroll, maxThumbTop, thumbHeight, trackHeight };
  };

  const updateThumb = (): void => {
    const { maxScroll, maxThumbTop, thumbHeight } = scrollbarMetrics();
    const thumbTop = maxScroll === 0 ? 0 : (viewport.scrollTop / maxScroll) * maxThumbTop;
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
    track.setAttribute('aria-valuemax', String(maxScroll));
    track.setAttribute('aria-valuenow', String(Math.round(viewport.scrollTop)));
    track.classList.toggle('is-disabled', maxScroll === 0);
  };

  const scrollToPointer = (event: PointerEvent, offset: number): void => {
    const { maxScroll, maxThumbTop } = scrollbarMetrics();
    const trackTop = track.getBoundingClientRect().top;
    const thumbTop = clampNumber(event.clientY - trackTop - offset, 0, maxThumbTop);
    viewport.scrollTop = maxThumbTop === 0 ? 0 : (thumbTop / maxThumbTop) * maxScroll;
    updateThumb();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    event.preventDefault();
    scrollToPointer(event, dragOffset);
  };

  const onPointerUp = (): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    track.classList.remove('is-dragging');
    document.body.classList.remove('terminal-scroll-dragging');
    scheduleScrollbarHide();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const { thumbHeight } = scrollbarMetrics();
    dragging = true;
    dragOffset =
      event.target === thumb
        ? event.clientY - thumb.getBoundingClientRect().top
        : thumbHeight / 2;
    track.classList.add('is-dragging');
    document.body.classList.add('terminal-scroll-dragging');
    showScrollbar();
    event.preventDefault();
    scrollToPointer(event, dragOffset);
  };

  const onViewportScroll = (): void => {
    updateThumb();
    showScrollbar();
    scheduleScrollbarHide();
  };

  const onPointerEnter = (): void => {
    hovering = true;
    showScrollbar();
  };

  const onPointerLeave = (): void => {
    hovering = false;
    if (!dragging) {
      scheduleScrollbarHide();
    }
  };

  track.addEventListener('pointerdown', onPointerDown);
  track.addEventListener('pointerenter', onPointerEnter);
  track.addEventListener('pointerleave', onPointerLeave);
  viewport.addEventListener('scroll', onViewportScroll);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  updateThumb();

  return () => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
    }
    track.removeEventListener('pointerdown', onPointerDown);
    track.removeEventListener('pointerenter', onPointerEnter);
    track.removeEventListener('pointerleave', onPointerLeave);
    viewport.removeEventListener('scroll', onViewportScroll);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    document.body.classList.remove('terminal-scroll-dragging');
    track.remove();
  };
}

export function TerminalPane({
  sessionId,
  preserveHistory = true,
  readOnly = false,
}: TerminalPaneProps): React.JSX.Element {
  const terminalElementRef = React.useRef<HTMLDivElement>(null);
  const terminalInstanceRef = React.useRef<Terminal | null>(null);

  const scrollToTop = React.useCallback((): void => {
    terminalInstanceRef.current?.scrollToTop();
  }, []);

  const scrollToBottom = React.useCallback((): void => {
    terminalInstanceRef.current?.scrollToBottom();
  }, []);

  React.useEffect(() => {
    if (!sessionId || !terminalElementRef.current || !window.agentDock) {
      return undefined;
    }

    let disposed = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      disableStdin: readOnly,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      scrollback: 50_000,
    });

    terminal.open(terminalElementRef.current);
    terminalInstanceRef.current = terminal;
    const cleanupScrollbar = installTerminalDragScrollbar(terminalElementRef.current);
    const cleanupOscQueryGuards =
      preserveHistory && !readOnly ? installAgentOscQueryGuards(terminal) : () => undefined;

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
      if (!readOnly) {
        void window.agentDock
          .resizeTerminal({ sessionId, cols, rows })
          .catch(() => undefined);
      }
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

    // 终端右键约定：有选中文本时复制，否则把剪贴板内容粘贴进终端；
    // preventDefault 同时阻止主进程 context-menu 事件，避免弹出编辑菜单
    const contextMenuListener = (event: MouseEvent): void => {
      event.preventDefault();
      const selection = terminal.getSelection();
      if (selection) {
        void navigator.clipboard?.writeText(selection).catch(() => undefined);
        terminal.clearSelection();
        return;
      }
      if (readOnly) {
        return;
      }
      void navigator.clipboard
        ?.readText()
        .then((text) => {
          if (text) {
            terminal.paste(text);
          }
        })
        .catch(() => undefined);
    };
    terminalElementRef.current.addEventListener('contextmenu', contextMenuListener);

    const writeReplayedOutput = (data: string): void => {
      const pinnedToBottom = preserveHistory && isTerminalAtScrollbackBottom(terminal);
      const output = preserveHistory
        ? readOnly
          ? preserveTerminalHistoryOutput(data)
          : preserveLiveAgentOutput(data)
        : data;
      terminal.write(output, () => {
        if (!disposed && pinnedToBottom) {
          terminal.scrollToBottom();
        }
      });
    };

    const writeLiveOutput = (data: string): void => {
      const pinnedToBottom = preserveHistory && isTerminalAtScrollbackBottom(terminal);
      const output = preserveHistory ? preserveLiveAgentOutput(data) : data;
      terminal.write(output, () => {
        if (!disposed && pinnedToBottom) {
          terminal.scrollToBottom();
        }
      });
    };

    // 回放完成前先暂存实时输出：主进程先写入快照缓冲再推送事件（同一 IPC 管道按序到达），
    // 因此快照响应之前收到的实时事件必然已包含在快照里，回放成功后直接丢弃即可避免重复；
    // 仅当快照读取失败时才补写暂存事件，保证不丢实时数据
    let bufferReplayed = false;
    const pendingLiveOutput: string[] = [];
    void window.agentDock
      .readTerminalBuffer({ sessionId })
      .then((buffer) => {
        if (disposed) {
          return;
        }
        if (buffer) {
          writeReplayedOutput(buffer);
        }
        bufferReplayed = true;
        pendingLiveOutput.length = 0;
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        bufferReplayed = true;
        for (const data of pendingLiveOutput.splice(0)) {
          writeLiveOutput(data);
        }
      });

    const dataSubscription = readOnly
      ? undefined
      : terminal.onData((input) => {
          void window.agentDock.writeTerminal({ sessionId, input }).catch(() => undefined);
        });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (!readOnly) {
        void window.agentDock
          .resizeTerminal({ sessionId, cols, rows })
          .catch(() => undefined);
      }
    });
    const unsubscribeOutput = window.agentDock.onTerminalOutput((event) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      if (!bufferReplayed) {
        pendingLiveOutput.push(event.data);
        return;
      }
      writeLiveOutput(event.data);
    });

    return () => {
      disposed = true;
      if (fitFrame !== undefined) {
        window.cancelAnimationFrame?.(fitFrame);
      }
      fitTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
      cleanupScrollbar();
      cleanupOscQueryGuards();
      terminalElementRef.current?.removeEventListener('wheel', wheelListener, true);
      terminalElementRef.current?.removeEventListener('contextmenu', contextMenuListener);
      dataSubscription?.dispose();
      resizeSubscription.dispose();
      unsubscribeOutput();
      if (terminalInstanceRef.current === terminal) {
        terminalInstanceRef.current = null;
      }
      terminal.dispose();
    };
  }, [preserveHistory, readOnly, sessionId]);

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
        <p>选择 API 配置、工作区和命令后，点击“启动”会创建真实 node-pty 会话。</p>
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
    >
      <div className="terminal-jump-controls" aria-label="终端快速跳转">
        <button type="button" aria-label="滚到顶部" title="滚到顶部" onClick={scrollToTop}>
          ↑
        </button>
        <button type="button" aria-label="滚到底部" title="滚到底部" onClick={scrollToBottom}>
          ↓
        </button>
      </div>
    </div>
  );
}
