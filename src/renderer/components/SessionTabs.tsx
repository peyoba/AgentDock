import React from 'react';
import type { SessionTab } from '../App';

type SessionTabsProps = {
  tabs: SessionTab[];
  detailsOpen: boolean;
  onToggleDetails(): void;
  onSelectSession?(sessionId: string): void;
  onAddSession?(): void;
  onCloseSession?(sessionId: string): void;
};

export function SessionTabs({
  tabs,
  detailsOpen,
  onToggleDetails,
  onSelectSession,
  onAddSession,
  onCloseSession,
}: SessionTabsProps): React.JSX.Element {
  return (
    <nav className="session-tabs" aria-label="运行中的会话">
      {tabs.map((tab) => (
        <span key={tab.id} className={tab.active ? 'session-tab active' : 'session-tab'}>
          <button type="button" title={tab.title} onClick={() => onSelectSession?.(tab.id)}>
            <span className="live-dot" />
            {tab.title}
          </button>
          <button
            type="button"
            className="close-mark"
            aria-label={`关闭 ${tab.title}`}
            title={`关闭 ${tab.title}`}
            onClick={() => onCloseSession?.(tab.id)}
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
    </nav>
  );
}
