import React from 'react';
import { createPortal } from 'react-dom';

type WorkspaceContextDialogProps = {
  workspaceName: string;
  filePath: string;
  content: string;
  loading: boolean;
  error: string;
  onClose(): void;
  onRefresh(): Promise<void>;
  onOpenFolder?(): Promise<void>;
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list-item'; text: string }
  | { type: 'code'; text: string }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let codeLines: string[] | undefined;

  for (const sourceLine of markdown.split(/\r?\n/u)) {
    if (sourceLine.trim().startsWith('```')) {
      if (codeLines) {
        blocks.push({ type: 'code', text: codeLines.join('\n') });
        codeLines = undefined;
      } else {
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(sourceLine);
      continue;
    }

    const trimmedLine = sourceLine.trim();
    if (!trimmedLine) {
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.+)$/u.exec(trimmedLine);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      continue;
    }
    const listItemMatch = /^[-*+]\s+(.+)$/u.exec(trimmedLine);
    if (listItemMatch) {
      blocks.push({ type: 'list-item', text: listItemMatch[1] });
      continue;
    }
    blocks.push({ type: 'paragraph', text: trimmedLine });
  }

  if (codeLines) {
    blocks.push({ type: 'code', text: codeLines.join('\n') });
  }
  return blocks;
}

function MarkdownContent({ content, query }: { content: string; query: string }): React.JSX.Element {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBlocks = parseMarkdownBlocks(content).filter(
    (block) => !normalizedQuery || block.text.toLocaleLowerCase().includes(normalizedQuery),
  );

  if (!content.trim()) {
    return <p className="workspace-context-empty">共享上下文尚无内容。</p>;
  }
  if (visibleBlocks.length === 0) {
    return <p className="workspace-context-empty">没有找到匹配内容。</p>;
  }

  return (
    <div className="workspace-context-markdown">
      {visibleBlocks.map((block, index) => {
        const blockKey = `${block.type}-${index}-${block.text.slice(0, 24)}`;
        if (block.type === 'heading') {
          const HeadingTag = `h${Math.min(block.level + 1, 6)}` as keyof React.JSX.IntrinsicElements;
          return <HeadingTag key={blockKey}>{block.text}</HeadingTag>;
        }
        if (block.type === 'list-item') {
          return <div className="workspace-context-list-item" key={blockKey}>{block.text}</div>;
        }
        if (block.type === 'code') {
          return <pre key={blockKey}><code>{block.text}</code></pre>;
        }
        return <p key={blockKey}>{block.text}</p>;
      })}
    </div>
  );
}

export function WorkspaceContextDialog({
  workspaceName,
  filePath,
  content,
  loading,
  error,
  onClose,
  onRefresh,
  onOpenFolder,
}: WorkspaceContextDialogProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [copyStatus, setCopyStatus] = React.useState('');
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const copyContent = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(content);
      setCopyStatus('已复制');
    } catch {
      setCopyStatus('复制失败');
    }
  };

  return createPortal(
    <div
      className="workspace-context-dialog-backdrop"
      data-testid="workspace-context-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-label="共享上下文"
        aria-modal="true"
        className="workspace-context-dialog"
        role="dialog"
      >
        <header className="workspace-context-dialog-header">
          <div>
            <h2>共享上下文</h2>
            <p>{workspaceName} · 同一 Workspace 的所有窗口和会话共享</p>
          </div>
          <div className="workspace-context-dialog-actions">
            <button type="button" onClick={() => void onRefresh()} disabled={loading}>刷新</button>
            <button type="button" onClick={() => void copyContent()} disabled={!content}>复制全文</button>
            <button
              ref={closeButtonRef}
              aria-label="关闭共享上下文"
              className="workspace-context-close-button"
              type="button"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="workspace-context-search-row">
          <input
            aria-label="搜索共享上下文"
            type="search"
            placeholder="搜索上下文..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {copyStatus ? <span role="status">{copyStatus}</span> : null}
        </div>

        <div className="workspace-context-dialog-body">
          {loading && !content ? <p className="workspace-context-empty">正在读取共享上下文...</p> : null}
          {error ? <p className="workspace-context-dialog-error" role="alert">{error}</p> : null}
          {!loading || content ? <MarkdownContent content={content} query={searchQuery} /> : null}
        </div>

        <footer className="workspace-context-dialog-footer">
          <code title={filePath}>{filePath || '尚未创建共享上下文文件'}</code>
          {onOpenFolder ? (
            <button type="button" onClick={() => void onOpenFolder()}>在 Finder 中打开</button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
