import React from 'react';

export function TerminalPane(): React.JSX.Element {
  return (
    <pre className="terminal-preview">{`# 会话环境预览
✓ 已从 macOS 钥匙串读取 API Key：••••••A7f
✓ 已注入 ANTHROPIC_BASE_URL=https://anyrouter.example.com/v1
✓ 工作目录：~/Documents/Obsidian Vault/项目/AgentDock

peyoba@MacBook AgentDock % claude
Claude Code 正在启动...
当前配置：Claude · AnyRouter A / sonnet-4
当前目录：/Users/peyoba/Documents/Obsidian Vault/项目/AgentDock

这个终端标签页使用独立 endpoint 和 API key，不会影响其他 Claude / Codex 会话。`}</pre>
  );
}
