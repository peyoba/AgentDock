import React, { useEffect, useRef, useState } from 'react';
import type { SessionTab } from '../App';

type SessionTabsProps = {
  tabs: SessionTab[];
  detailsOpen: boolean;
  onToggleDetails(): void;
  onSelectSession?(sessionId: string): void;
  onAddSession?(): void;
  onCloseSession?(sessionId: string): void;
};

// 原生 title 提示要悬停 1~2 秒才出现，这里用自绘 tooltip 缩短到 300ms。
const TOOLTIP_SHOW_DELAY_MS = 300;
// 与 styles.css 中 .tab-tooltip 的 max-width 保持一致，用于贴边标签的位置钳制。
const TOOLTIP_MAX_WIDTH_PX = 320;

type TooltipState = {
  text: string;
  left: number;
  top: number;
};

export function SessionTabs({
  tabs,
  detailsOpen,
  onToggleDetails,
  onSelectSession,
  onAddSession,
  onCloseSession,
}: SessionTabsProps): React.JSX.Element {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(showTimerRef.current), []);

  function scheduleTooltip(event: React.MouseEvent<HTMLElement>, text: string): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_MAX_WIDTH_PX - 8));
    const top = rect.bottom + 8;
    window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(
      () => setTooltip({ text, left, top }),
      TOOLTIP_SHOW_DELAY_MS,
    );
  }

  function hideTooltip(): void {
    window.clearTimeout(showTimerRef.current);
    setTooltip(null);
  }

  return (
    <nav className="session-tabs" aria-label="运行中的会话" onScroll={hideTooltip}>
      {tabs.map((tab) => (
        <span key={tab.id} className={tab.active ? 'session-tab active' : 'session-tab'}>
          <button
            type="button"
            onMouseEnter={(event) => scheduleTooltip(event, tab.title)}
            onMouseLeave={hideTooltip}
            onClick={() => {
              hideTooltip();
              onSelectSession?.(tab.id);
            }}
          >
            <span className="live-dot" />
            {tab.title}
          </button>
          <button
            type="button"
            className="close-mark"
            aria-label={`关闭 ${tab.title}`}
            onMouseEnter={(event) => scheduleTooltip(event, `关闭 ${tab.title}`)}
            onMouseLeave={hideTooltip}
            onClick={() => {
              hideTooltip();
              onCloseSession?.(tab.id);
            }}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="add-tab" onClick={onAddSession}>
        ＋
      </button>
      <button type="button" className="details-toggle" onClick={onToggleDetails}>
        会话详情 {detailsOpen ? '⌄' : '›'}
      </button>
      {tooltip ? (
        <div className="tab-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          {tooltip.text}
        </div>
      ) : null}
    </nav>
  );
}
