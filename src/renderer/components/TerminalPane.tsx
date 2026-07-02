import React from 'react';
import { Terminal } from '@xterm/xterm';

type TerminalPaneProps = {
  sessionId?: string;
};

export function TerminalPane({ sessionId }: TerminalPaneProps): React.JSX.Element {
  const terminalElementRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!sessionId || !terminalElementRef.current || !window.agentDock) {
      return undefined;
    }

    let disposed = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Consolas, monospace',
      fontSize: 13,
    });

    terminal.open(terminalElementRef.current);
    void window.agentDock
      .readTerminalBuffer({ sessionId })
      .then((buffer) => {
        if (!disposed && buffer) {
          terminal.write(buffer);
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
        terminal.write(event.data);
      }
    });

    return () => {
      disposed = true;
      dataSubscription.dispose();
      resizeSubscription.dispose();
      unsubscribeOutput();
      terminal.dispose();
    };
  }, [sessionId]);

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
