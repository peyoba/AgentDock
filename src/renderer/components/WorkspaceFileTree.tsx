import React from 'react';
import type { WorkspaceFileTreeEntry } from '../../shared/agentdockTypes';

type WorkspaceFileTreeProps = {
  entries: WorkspaceFileTreeEntry[];
  selectedRelativePath?: string;
  onSelect(entry: WorkspaceFileTreeEntry): void;
};

function typeLabel(entry: WorkspaceFileTreeEntry): string {
  return entry.type === 'directory' ? 'DIR' : 'FILE';
}

function treeItemLabel(entry: WorkspaceFileTreeEntry): string {
  return [
    entry.name,
    entry.gitStatus,
    entry.touchedInSession ? '本会话期间发生变化' : undefined,
  ].filter(Boolean).join(' ');
}

export function WorkspaceFileTree({
  entries,
  selectedRelativePath,
  onSelect,
}: WorkspaceFileTreeProps): React.JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="workspace-file-tree-empty" role="tree" aria-label="项目文件树">
        暂无文件
      </div>
    );
  }

  return (
    <ul className="workspace-file-tree" role="tree" aria-label="项目文件树">
      {entries.map((entry) => {
        const selected = entry.relativePath === selectedRelativePath;
        return (
          <li key={entry.relativePath} role="none">
            <button
              type="button"
              role="treeitem"
              aria-selected={selected}
              aria-label={treeItemLabel(entry)}
              className={selected ? 'workspace-file-tree-item selected' : 'workspace-file-tree-item'}
              onClick={() => onSelect(entry)}
            >
              <span className="workspace-file-tree-type">{typeLabel(entry)}</span>
              <span className="workspace-file-tree-name">{entry.name}</span>
              {entry.gitStatus ? (
                <span className={`workspace-file-git-status status-${entry.gitStatus}`}>
                  {entry.gitStatus}
                </span>
              ) : null}
              {entry.touchedInSession ? (
                <span className="workspace-file-touched" title="本会话期间发生变化">
                  本会话期间发生变化
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
