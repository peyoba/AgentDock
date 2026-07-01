import React from 'react';

const toolTypes = ['Claude', 'Codex', 'Gemini', 'OpenCode', '全部'] as const;

export function ApiConfigPanel(): React.JSX.Element {
  return (
    <section className="api-config-panel" aria-label="API 配置">
      <div>
        <h2>接口配置</h2>
        <p>按工具类型管理 endpoint、模型和钥匙串引用。</p>
      </div>
      <nav className="tool-type-tabs" aria-label="API 配置工具类型">
        {toolTypes.map((toolType) => (
          <button key={toolType} type="button">
            {toolType}
          </button>
        ))}
      </nav>
    </section>
  );
}
