import React from 'react';
import type {
  AgentSession,
  ApiProfile,
  Workspace,
  WorkspaceDirectoryRequest,
  WorkspaceDirectoryResult,
  WorkspaceFileTreeEntry,
} from '../../shared/agentdockTypes';
import { ProjectPanelInfoSections } from './ProjectPanelInfoSections';
import { WorkspaceFileTree } from './WorkspaceFileTree';

type ProjectPanelProps = {
  workspace?: Workspace;
  session?: AgentSession;
  profile?: ApiProfile;
  onCollapse(): void;
  listDirectory?(request: WorkspaceDirectoryRequest): Promise<WorkspaceDirectoryResult>;
};

const MIN_INFO_HEIGHT = 120;
const MAX_INFO_HEIGHT = 320;
const INFO_HEIGHT_KEYBOARD_STEP = 10;

function clampInfoHeight(height: number): number {
  return Math.min(MAX_INFO_HEIGHT, Math.max(MIN_INFO_HEIGHT, height));
}

function parentPath(relativePath: string): string {
  if (!relativePath || relativePath === '.') {
    return '.';
  }

  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? parts.join('/') : '.';
}

function firstSelectableEntry(entries: WorkspaceFileTreeEntry[]): WorkspaceFileTreeEntry | undefined {
  return entries.find((entry) => entry.type === 'file') ?? entries[0];
}

function isHiddenProjectEntry(entry: WorkspaceFileTreeEntry): boolean {
  return entry.name.startsWith('.');
}

export function ProjectPanel({
  workspace,
  session,
  profile,
  onCollapse,
  listDirectory,
}: ProjectPanelProps): React.JSX.Element {
  const [relativePath, setRelativePath] = React.useState('.');
  const [entries, setEntries] = React.useState<WorkspaceFileTreeEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = React.useState<WorkspaceFileTreeEntry | undefined>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [infoHeight, setInfoHeight] = React.useState(180);
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [showHiddenEntries, setShowHiddenEntries] = React.useState(false);

  React.useEffect(() => {
    setRelativePath('.');
    setSelectedEntry(undefined);
  }, [workspace?.id]);

  React.useEffect(() => {
    if (!workspace || !listDirectory) {
      setEntries([]);
      setSelectedEntry(undefined);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void listDirectory({
      workspaceId: workspace.id,
      relativePath,
      sessionId: session?.id,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const visibleEntries = showHiddenEntries
          ? result.entries
          : result.entries.filter((entry) => !isHiddenProjectEntry(entry));
        setEntries(result.entries);
        setSelectedEntry((current) =>
          visibleEntries.find((entry) => entry.relativePath === current?.relativePath) ??
          firstSelectableEntry(visibleEntries),
        );
      })
      .catch((nextError: unknown) => {
        if (cancelled) {
          return;
        }
        setEntries([]);
        setSelectedEntry(undefined);
        setError(nextError instanceof Error ? nextError.message : '无法读取文件树');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // 只依赖 workspace.id：metadata 刷新会产生新的 workspace 对象引用，
    // 若依赖整个对象会导致文件树无关刷新时整棵重拉、界面闪烁。
  }, [listDirectory, refreshNonce, relativePath, session?.id, showHiddenEntries, workspace?.id]);

  const visibleEntries = showHiddenEntries
    ? entries
    : entries.filter((entry) => !isHiddenProjectEntry(entry));

  const handleSelectEntry = (entry: WorkspaceFileTreeEntry): void => {
    setSelectedEntry(entry);
    if (entry.type === 'directory') {
      setRelativePath(entry.relativePath);
    }
  };

  // 拖拽期间组件卸载时兜底移除 window 监听器。
  const resizeCleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => resizeCleanupRef.current?.(), []);

  const startResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = infoHeight;

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      setInfoHeight(clampInfoHeight(nextHeight));
    };
    const stopResize = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      resizeCleanupRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    resizeCleanupRef.current = stopResize;
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let nextHeight: number | undefined;
    if (event.key === 'ArrowUp') {
      nextHeight = infoHeight + INFO_HEIGHT_KEYBOARD_STEP;
    } else if (event.key === 'ArrowDown') {
      nextHeight = infoHeight - INFO_HEIGHT_KEYBOARD_STEP;
    } else if (event.key === 'Home') {
      nextHeight = MIN_INFO_HEIGHT;
    } else if (event.key === 'End') {
      nextHeight = MAX_INFO_HEIGHT;
    }

    if (nextHeight !== undefined) {
      event.preventDefault();
      setInfoHeight(clampInfoHeight(nextHeight));
    }
  };

  return (
    <>
      <header className="project-panel-header">
        <div>
          <h2>{workspace?.name ?? '项目'}</h2>
          <p>{workspace?.path ?? '未选择工作区'}</p>
        </div>
        <span
          className="project-readonly-badge"
          title="项目面板只用于查看文件和状态，AgentDock 不在这里编辑代码。"
        >
          只读
        </span>
        <button
          type="button"
          className="project-panel-collapse"
          aria-label="收起项目面板"
          onClick={onCollapse}
        >
          ›
        </button>
      </header>

      <section
        className="project-panel-body"
        style={{ gridTemplateRows: `minmax(55%, 1fr) 6px ${infoHeight}px` }}
      >
        <section className="project-file-tree-pane" aria-label="项目文件">
          <div className="project-path-row">
            <span className="project-path-chip">{relativePath === '.' ? '根目录' : relativePath}</span>
            {relativePath !== '.' ? (
              <button type="button" onClick={() => setRelativePath(parentPath(relativePath))}>
                上级
              </button>
            ) : null}
            <button type="button" onClick={() => setRefreshNonce((current) => current + 1)}>
              刷新
            </button>
            <button
              type="button"
              aria-pressed={showHiddenEntries}
              onClick={() => setShowHiddenEntries((current) => !current)}
            >
              {showHiddenEntries ? '隐藏隐藏项' : '显示隐藏项'}
            </button>
          </div>
          {loading ? <p className="project-tree-status">正在读取文件树</p> : null}
          {error ? <p role="alert" className="project-tree-error">{error}</p> : null}
          {!loading && !error ? (
            <WorkspaceFileTree
              entries={visibleEntries}
              selectedRelativePath={selectedEntry?.relativePath}
              onSelect={handleSelectEntry}
            />
          ) : null}
        </section>
        <div
          className="project-info-resizer"
          role="separator"
          aria-label="调整项目信息区高度"
          aria-orientation="horizontal"
          aria-valuemin={MIN_INFO_HEIGHT}
          aria-valuemax={MAX_INFO_HEIGHT}
          aria-valuenow={infoHeight}
          tabIndex={0}
          onMouseDown={startResize}
          onKeyDown={resizeWithKeyboard}
        />
        <ProjectPanelInfoSections
          selectedEntry={selectedEntry}
          session={session}
          profile={profile}
          workspace={workspace}
        />
      </section>
    </>
  );
}
