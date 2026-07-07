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
        setEntries(result.entries);
        setSelectedEntry((current) =>
          result.entries.find((entry) => entry.relativePath === current?.relativePath) ??
          firstSelectableEntry(result.entries),
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
  }, [listDirectory, refreshNonce, relativePath, session?.id, workspace]);

  const handleSelectEntry = (entry: WorkspaceFileTreeEntry): void => {
    setSelectedEntry(entry);
    if (entry.type === 'directory') {
      setRelativePath(entry.relativePath);
    }
  };

  const startResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = infoHeight;

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const nextHeight = startHeight - (moveEvent.clientY - startY);
      setInfoHeight(Math.min(320, Math.max(120, nextHeight)));
    };
    const onMouseUp = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
          </div>
          {loading ? <p className="project-tree-status">正在读取文件树</p> : null}
          {error ? <p role="alert" className="project-tree-error">{error}</p> : null}
          {!loading && !error ? (
            <WorkspaceFileTree
              entries={entries}
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
          tabIndex={0}
          onMouseDown={startResize}
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
