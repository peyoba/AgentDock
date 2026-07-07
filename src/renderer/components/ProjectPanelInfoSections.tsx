import React from 'react';
import type {
  AgentSession,
  ApiProfile,
  Workspace,
  WorkspaceFileTreeEntry,
} from '../../shared/agentdockTypes';
import { terminalOutputToPlainText } from '../../shared/terminalText';

type ProjectPanelInfoSectionsProps = {
  selectedEntry?: WorkspaceFileTreeEntry;
  session?: AgentSession;
  profile?: ApiProfile;
  workspace?: Workspace;
};

function absolutePath(workspace: Workspace | undefined, relativePath: string | undefined): string {
  if (!workspace || !relativePath) {
    return '';
  }

  return `${workspace.path.replace(/\/+$/, '')}/${relativePath}`;
}

function sessionStatusLabel(session: AgentSession | undefined): string {
  if (!session) {
    return '未选择';
  }

  const labels: Record<AgentSession['status'], string> = {
    starting: '启动中',
    running: '运行中',
    stopped: '已停止',
    exited: '已退出',
    interrupted: '已中断',
    failed: '失败',
  };
  return labels[session.status];
}

function restoreMethodLabel(session: AgentSession | undefined): string {
  if (!session?.memoryRestore) {
    return '无恢复材料';
  }
  if (session.memoryRestore.method === 'native') {
    return '原生 resume';
  }
  if (session.memoryRestore.method === 'agentdock') {
    return 'AgentDock 恢复材料';
  }
  if (session.memoryRestore.status === 'loaded') {
    return 'AgentDock 恢复材料';
  }
  if (session.memoryRestore.status === 'failed') {
    return '恢复失败';
  }
  return '普通重新启动';
}

function restoreSummary(session: AgentSession | undefined): string {
  const summary = session?.memoryRestore?.summary;
  if (!summary) {
    return '未找到可恢复上下文';
  }

  return terminalOutputToPlainText(summary)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? '恢复摘要不可读';
}

function statLabel(entry: WorkspaceFileTreeEntry | undefined): string {
  if (typeof entry?.additions === 'number' || typeof entry?.deletions === 'number') {
    return `+${entry.additions ?? 0} / -${entry.deletions ?? 0}`;
  }
  return '未计算';
}

export function ProjectPanelInfoSections({
  selectedEntry,
  session,
  profile,
  workspace,
}: ProjectPanelInfoSectionsProps): React.JSX.Element {
  const [fileOpen, setFileOpen] = React.useState(true);
  const [sessionOpen, setSessionOpen] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const selectedAbsolutePath = absolutePath(workspace, selectedEntry?.relativePath);

  const copySelectedPath = (): void => {
    if (selectedAbsolutePath) {
      void navigator.clipboard?.writeText(selectedAbsolutePath).catch(() => undefined);
    }
  };

  return (
    <section className="project-info-sections" aria-label="项目信息区">
      <section className="project-info-section">
        <button
          type="button"
          className="project-info-section-toggle"
          aria-expanded={fileOpen}
          onClick={() => setFileOpen((open) => !open)}
        >
          选中文件
        </button>
        {fileOpen ? (
          <div className="project-info-section-body">
            {selectedEntry ? (
              <>
                <strong>{selectedEntry.name}</strong>
                <span>{selectedEntry.relativePath}</span>
                <dl>
                  <div>
                    <dt>Git</dt>
                    <dd>{selectedEntry.gitStatus ?? 'clean'}</dd>
                  </div>
                  <div>
                    <dt>变化</dt>
                    <dd>{selectedEntry.touchedInSession ? '本会话期间发生变化' : '未标记'}</dd>
                  </div>
                  <div>
                    <dt>统计</dt>
                    <dd>{statLabel(selectedEntry)}</dd>
                  </div>
                </dl>
                <div className="project-info-actions">
                  <button type="button" onClick={copySelectedPath}>
                    复制路径
                  </button>
                </div>
              </>
            ) : (
              <span>未选择文件</span>
            )}
          </div>
        ) : null}
      </section>

      <section className="project-info-section">
        <button
          type="button"
          className="project-info-section-toggle"
          aria-expanded={sessionOpen}
          onClick={() => setSessionOpen((open) => !open)}
        >
          当前会话
        </button>
        {sessionOpen ? (
          <div className="project-info-section-body">
            <dl>
              <div>
                <dt>状态</dt>
                <dd>{sessionStatusLabel(session)}</dd>
              </div>
              <div>
                <dt>配置</dt>
                <dd>{profile?.name ?? session?.profileId ?? '未选择'}</dd>
              </div>
              <div>
                <dt>工作区</dt>
                <dd>{workspace?.name ?? session?.workspaceId ?? '未选择'}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>

      <section className="project-info-section">
        <button
          type="button"
          className="project-info-section-toggle"
          aria-expanded={restoreOpen}
          onClick={() => setRestoreOpen((open) => !open)}
        >
          恢复摘要
        </button>
        {restoreOpen ? (
          <div className="project-info-section-body">
            <dl>
              <div>
                <dt>方式</dt>
                <dd>{restoreMethodLabel(session)}</dd>
              </div>
              <div>
                <dt>摘要</dt>
                <dd>{restoreSummary(session)}</dd>
              </div>
              <div>
                <dt>安全</dt>
                <dd>{session?.memoryRestore ? '已脱敏' : '无恢复材料'}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>
    </section>
  );
}
