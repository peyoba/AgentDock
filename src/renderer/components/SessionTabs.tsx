import React from 'react';
import type { SessionTab } from '../App';

type SessionTabsProps = {
  tabs: SessionTab[];
  detailsOpen: boolean;
  onToggleDetails(): void;
  onSelectSession?(sessionId: string): void;
};

export function SessionTabs({
  tabs,
  detailsOpen,
  onToggleDetails,
  onSelectSession,
}: SessionTabsProps): React.JSX.Element {
  return (
    <nav className="session-tabs" aria-label="运行中的会话">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={tab.active ? 'active' : ''}
          onClick={() => onSelectSession?.(tab.id)}
        >
          <span className="live-dot" />
          {tab.title}
          <span className="close-mark">×</span>
        </button>
      ))}
      <button type="button" className="add-tab">＋</button>
      <button type="button" className="details-toggle" onClick={onToggleDetails}>
        会话详情 {detailsOpen ? '⌄' : '›'}
      </button>
    </nav>
  );
}
