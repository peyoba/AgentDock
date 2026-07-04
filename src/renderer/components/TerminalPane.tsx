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
const SCROLLBAR_HIDE_DELAY_MS = 900;

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
    const cleanupScrollbar = installTerminalDragScrollbar(terminalElementRef.current);

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
      cleanupScrollbar();
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
