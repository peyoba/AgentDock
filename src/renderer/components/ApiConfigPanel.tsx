import React from 'react';
import type { ApiProfile, ToolType } from '../../shared/agentdockTypes';

export type ApiConfigFilter = ToolType | 'all';

const toolTypes: Array<{ label: string; value: ApiConfigFilter }> = [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'OpenCode', value: 'opencode' },
  { label: '全部', value: 'all' },
];

const editableToolTypes: Array<{ label: string; value: ToolType }> = [
  { label: 'Claude', value: 'claude' },
  { label: 'Codex', value: 'codex' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'OpenCode', value: 'opencode' },
];

type ApiConfigPanelProps = {
  profiles: ApiProfile[];
  selectedProfileId?: string;
  filter: ApiConfigFilter;
  onFilterChange(filter: ApiConfigFilter): void;
  onSelectProfile(profileId: string): void;
  onSaveProfile(profile: ApiProfile): Promise<ApiProfile>;
  onDeleteProfile?(profileId: string): Promise<void>;
  onSaveProfileSecret(request: {
    keychainService: string;
    keychainAccount: string;
    secret: string;
  }): Promise<void>;
  onReadProfileSecret?(request: {
    keychainService: string;
    keychainAccount: string;
  }): Promise<string>;
  onFetchProfileModels?(request: { profileId: string }): Promise<string[]>;
  onBackToWorkbench?: () => void;
};

function toolLabel(toolType: ToolType): string {
  return toolTypes.find((item) => item.value === toolType)?.label ?? toolType;
}

function createDraft(profile?: ApiProfile): ApiProfile | undefined {
  if (!profile) {
    return undefined;
  }

  return { ...profile, availableModels: profile.availableModels ? [...profile.availableModels] : undefined };
}

function normalizeModelList(models: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalizedModels: string[] = [];

  for (const model of models ?? []) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    normalizedModels.push(normalized);
  }

  return normalizedModels;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
  if (/Unable to decrypt local API key vault entry/.test(message)) {
    return '无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。';
  }

  return message;
}

function createUniqueProfileId(toolType: ToolType, profiles: ApiProfile[]): string {
  const usedIdentifiers = new Set(
    profiles.flatMap((profile) => [profile.id, profile.keychainAccount]),
  );
  let index = 1;
  let candidate = `${toolType}-custom-${index}`;

  while (usedIdentifiers.has(candidate)) {
    index += 1;
    candidate = `${toolType}-custom-${index}`;
  }

  return candidate;
}

function defaultNewProfileToolType(
  filter: ApiConfigFilter,
  selectedProfile?: ApiProfile,
): ToolType {
  if (filter !== 'all') {
    return filter;
  }

  return selectedProfile?.toolType ?? 'claude';
}

function createNewProfileDraft({
  filter,
  profiles,
  selectedProfile,
}: {
  filter: ApiConfigFilter;
  profiles: ApiProfile[];
  selectedProfile?: ApiProfile;
}): ApiProfile {
  const toolType = defaultNewProfileToolType(filter, selectedProfile);
  const id = createUniqueProfileId(toolType, profiles);
  const label = toolLabel(toolType);

  return {
    id,
    name: `${label} 自定义 ${id.split('-').at(-1) ?? '1'}`,
    toolType,
    baseUrl: '',
    keychainService: selectedProfile?.keychainService || 'AgentDock',
    keychainAccount: id,
    codexHome: toolType === 'codex' ? `~/.agentdock/codex-profiles/${id}` : undefined,
  };
}

export function ApiConfigPanel({
  profiles,
  selectedProfileId,
  filter,
  onFilterChange,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
  onSaveProfileSecret,
  onReadProfileSecret,
  onFetchProfileModels,
  onBackToWorkbench,
}: ApiConfigPanelProps): React.JSX.Element {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const [draft, setDraft] = React.useState<ApiProfile | undefined>(() => createDraft(selectedProfile));
  const [secretDraft, setSecretDraft] = React.useState('');
  const [secretVisible, setSecretVisible] = React.useState(false);
  const [secretDirty, setSecretDirty] = React.useState(false);
  const [secretLoading, setSecretLoading] = React.useState(false);
  const [newModelDraft, setNewModelDraft] = React.useState('');
  const [fetchedModels, setFetchedModels] = React.useState<string[]>([]);
  const [modelFetching, setModelFetching] = React.useState(false);
  const [modelMessage, setModelMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(createDraft(selectedProfile));
    setSecretDraft('');
    setSecretVisible(false);
    setSecretDirty(false);
    setSecretLoading(false);
    setNewModelDraft('');
    setFetchedModels([]);
    setModelFetching(false);
    setModelMessage(null);
    setSaveMessage(null);
    setSaveError(null);
    setAdvancedOpen(false);
    setDeleteError(null);
  }, [selectedProfile?.id]);

  const visibleProfiles =
    filter === 'all' ? profiles : profiles.filter((profile) => profile.toolType === filter);
  const isNewDraft = draft ? !profiles.some((profile) => profile.id === draft.id) : false;

  const updateDraft = <Key extends keyof ApiProfile>(key: Key, value: ApiProfile[Key]): void => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateSecretDraft = (value: string): void => {
    setSecretDraft(value);
    setSecretDirty(true);
  };

  const updateClaudeCodeMaxRetries = (value: string): void => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      updateDraft('claudeCodeMaxRetries', undefined);
      return;
    }

    const parsedValue = Number(trimmedValue);
    updateDraft(
      'claudeCodeMaxRetries',
      Number.isFinite(parsedValue) ? parsedValue : undefined,
    );
  };

  const updateClaudeCleanupPeriodDays = (value: string): void => {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      updateDraft('claudeCleanupPeriodDays', undefined);
      return;
    }

    const parsedValue = Number(trimmedValue);
    updateDraft(
      'claudeCleanupPeriodDays',
      Number.isFinite(parsedValue) ? parsedValue : undefined,
    );
  };

  const modelOptions = normalizeModelList(draft?.availableModels);
  const defaultModelOptions = normalizeModelList([
    draft?.defaultModel ?? '',
    ...modelOptions,
  ]);

  const setModelOptions = (models: string[], defaultModel?: string): void => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextModels = normalizeModelList(models);
      const nextDefault = defaultModel ?? current.defaultModel;

      return {
        ...current,
        availableModels: nextModels.length > 0 ? nextModels : undefined,
        defaultModel: nextDefault || nextModels[0],
      };
    });
  };

  const startNewProfile = (): void => {
    const nextDraft = createNewProfileDraft({ filter, profiles, selectedProfile });
    setDraft(nextDraft);
    setSecretDraft('');
    setSecretVisible(false);
    setSecretDirty(false);
    setNewModelDraft('');
    setFetchedModels([]);
    setModelMessage(null);
    setSaveMessage(null);
    setSaveError(null);
    setAdvancedOpen(false);
    onFilterChange(nextDraft.toolType);
  };

  const toggleSecretVisibility = async (): Promise<void> => {
    if (!draft) {
      return;
    }

    if (secretVisible) {
      setSecretVisible(false);
      return;
    }

    if (!secretDraft && !secretDirty && onReadProfileSecret) {
      setSecretLoading(true);
      setSaveError(null);
      try {
        const secret = await onReadProfileSecret({
          keychainService: draft.keychainService,
          keychainAccount: draft.keychainAccount,
        });
        setSecretDraft(secret);
        setSecretDirty(false);
      } catch (error) {
        setSaveError(errorMessage(error, '读取 API Key 失败'));
        return;
      } finally {
        setSecretLoading(false);
      }
    }

    setSecretVisible(true);
  };

  const fetchModels = async (): Promise<void> => {
    if (!draft || !onFetchProfileModels) {
      return;
    }

    setModelFetching(true);
    setModelMessage(null);
    setSaveError(null);
    try {
      const models = normalizeModelList(await onFetchProfileModels({ profileId: draft.id }));
      setFetchedModels(models);
      if (!draft.defaultModel && models[0]) {
        updateDraft('defaultModel', models[0]);
      }
      setModelMessage(`已拉取 ${models.length} 个模型`);
    } catch (error) {
      setSaveError(errorMessage(error, '模型拉取失败'));
    } finally {
      setModelFetching(false);
    }
  };

  const addModel = (): void => {
    if (!draft) {
      return;
    }

    const nextModel = newModelDraft.trim();
    if (!nextModel) {
      return;
    }

    setModelOptions([...modelOptions, nextModel], draft.defaultModel || nextModel);
    setNewModelDraft('');
  };

  const toggleFetchedModel = (model: string): void => {
    if (!draft) {
      return;
    }

    if (modelOptions.includes(model)) {
      removeModel(model);
      return;
    }

    setModelOptions([...modelOptions, model], draft.defaultModel || model);
  };

  const removeModel = (model: string): void => {
    if (!draft) {
      return;
    }

    const nextModels = modelOptions.filter((item) => item !== model);
    setModelOptions(nextModels, draft.defaultModel === model ? nextModels[0] : draft.defaultModel);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!draft) {
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const availableModels = normalizeModelList(draft.availableModels);
      const savedProfile = await onSaveProfile({
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        defaultModel: draft.defaultModel?.trim() || undefined,
        availableModels: availableModels.length > 0 ? availableModels : undefined,
        keychainService: draft.keychainService.trim(),
        keychainAccount: draft.keychainAccount.trim(),
        codexHome: draft.codexHome?.trim() || undefined,
        claudeCodeRetryWatchdog:
          draft.toolType === 'claude' ? draft.claudeCodeRetryWatchdog : undefined,
        claudeCodeMaxRetries:
          draft.toolType === 'claude'
            ? normalizePositiveInteger(draft.claudeCodeMaxRetries)
            : undefined,
        anthropicBetas:
          draft.toolType === 'claude' ? normalizeOptionalString(draft.anthropicBetas) : undefined,
        httpProxy:
          draft.toolType === 'claude' ? normalizeOptionalString(draft.httpProxy) : undefined,
        httpsProxy:
          draft.toolType === 'claude' ? normalizeOptionalString(draft.httpsProxy) : undefined,
        claudeCodeDisableNonessentialTraffic:
          draft.toolType === 'claude'
            ? draft.claudeCodeDisableNonessentialTraffic
            : undefined,
        claudeCodeAttributionHeader:
          draft.toolType === 'claude'
            ? normalizeOptionalString(draft.claudeCodeAttributionHeader)
            : undefined,
        disableInstallationChecks:
          draft.toolType === 'claude' ? draft.disableInstallationChecks : undefined,
        claudeCleanupPeriodDays:
          draft.toolType === 'claude'
            ? normalizePositiveInteger(draft.claudeCleanupPeriodDays)
            : undefined,
      });
      if (secretDraft.trim() && secretDirty) {
        await onSaveProfileSecret({
          keychainService: savedProfile.keychainService,
          keychainAccount: savedProfile.keychainAccount,
          secret: secretDraft.trim(),
        });
        setDraft(savedProfile);
        setSecretDraft('');
        setSecretVisible(false);
        setSecretDirty(false);
        setSaveMessage('API Key 已本机加密保存');
        return;
      }
      setDraft(savedProfile);
      setSaveMessage('配置已保存');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '配置保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!draft || !onDeleteProfile) {
      return;
    }

    const confirmed = window.confirm(`确定要删除配置 "${draft.name}" 吗？此操作无法撤销。`);
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteProfile(draft.id);
      // 删除成功后清空当前选择和编辑状态
      setDraft(undefined);
      setSecretDraft('');
      setSecretVisible(false);
      setSecretDirty(false);
      setNewModelDraft('');
      setFetchedModels([]);
      setModelMessage(null);
      setSaveMessage(null);
      setSaveError(null);
    } catch (error) {
      setDeleteError(errorMessage(error, '删除配置失败'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="api-config-panel" aria-label="API 配置">
      <div className="api-config-heading">
        <div>
          <h2>接口配置</h2>
          <p>按工具类型管理 endpoint、模型和独立密钥存储。</p>
        </div>
        <div className="api-config-heading-actions">
          {onBackToWorkbench ? (
            <button type="button" className="back-to-workbench-button" onClick={onBackToWorkbench}>
              返回终端工作台
            </button>
          ) : null}
          <nav className="tool-type-tabs" aria-label="API 配置工具类型">
            {toolTypes.map((toolType) => (
              <button
                key={toolType.value}
                type="button"
                className={filter === toolType.value ? 'active' : ''}
                onClick={() => onFilterChange(toolType.value)}
              >
                {toolType.label}
              </button>
            ))}
          </nav>
          <button type="button" className="add-profile-button" onClick={startNewProfile}>
            新增配置
          </button>
        </div>
      </div>
      <div className="api-config-layout">
        <div className="profile-card-grid" aria-label="API 配置列表">
          {visibleProfiles.length === 0 ? (
            <p className="empty-state">当前类型还没有配置。</p>
          ) : (
            visibleProfiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className={profile.id === selectedProfileId ? 'profile-card active' : 'profile-card'}
                onClick={() => onSelectProfile(profile.id)}
              >
                <strong>{profile.name}</strong>
                <span>{toolLabel(profile.toolType)} · {profile.defaultModel ?? '默认模型'}</span>
                <small>{profile.baseUrl}</small>
              </button>
            ))
          )}
        </div>

        <form className="profile-editor" aria-label="编辑接口配置" onSubmit={(event) => void submit(event)}>
          <div className="editor-title-row">
            <div>
              <h3>{isNewDraft ? '新增接口配置' : '编辑接口配置'}</h3>
              <p>每个配置使用独立密钥槽位；默认不会读取或显示完整 API Key。</p>
            </div>
            {saveMessage ? <span className="save-status success">{saveMessage}</span> : null}
            {saveError ? <span className="save-status error" role="alert">{saveError}</span> : null}
          </div>

          {draft ? (
            <div className="profile-editor-grid">
              <label>
                <span>接口名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft('name', event.target.value)}
                />
              </label>
              <label>
                <span>工具类型</span>
                <select
                  value={draft.toolType}
                  onChange={(event) => updateDraft('toolType', event.target.value as ToolType)}
                >
                  {editableToolTypes.map((toolType) => (
                    <option key={toolType.value} value={toolType.value}>{toolType.label}</option>
                  ))}
                </select>
              </label>
              <label className="wide-field">
                <span>Base URL</span>
                <input
                  value={draft.baseUrl}
                  onChange={(event) => updateDraft('baseUrl', event.target.value)}
                />
              </label>
              <div className="model-config wide-field">
                <div className="model-config-header">
                  <label className="model-default-field">
                    <span>默认模型</span>
                    {modelOptions.length > 0 ? (
                      <select
                        value={draft.defaultModel ?? defaultModelOptions[0] ?? ''}
                        onChange={(event) => updateDraft('defaultModel', event.target.value)}
                      >
                        {defaultModelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={draft.defaultModel ?? ''}
                        onChange={(event) => updateDraft('defaultModel', event.target.value)}
                      />
                    )}
                  </label>
                  <button
                    type="button"
                    className="model-fetch-button"
                    disabled={modelFetching || !onFetchProfileModels}
                    onClick={() => void fetchModels()}
                  >
                    {modelFetching ? '拉取中…' : '拉取模型'}
                  </button>
                </div>
                {modelMessage ? <small className="field-help">{modelMessage}</small> : null}
                {fetchedModels.length > 0 ? (
                  <div className="fetched-model-group" role="group" aria-label="拉取到的模型">
                    <div className="model-preset-title">
                      <span>拉取到的模型</span>
                      <small>勾选后加入常用模型；默认模型可以从常用模型中选择。</small>
                    </div>
                    <div className="fetched-model-list">
                      {fetchedModels.map((model) => (
                        <label key={model} className="fetched-model-option">
                          <input
                            type="checkbox"
                            checked={modelOptions.includes(model)}
                            onChange={() => toggleFetchedModel(model)}
                          />
                          <span>{model}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="model-add-row">
                  <label>
                    <span>自定义模型 ID</span>
                    <input
                      value={newModelDraft}
                      onChange={(event) => setNewModelDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addModel();
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={addModel}>
                    添加模型
                  </button>
                </div>
                {modelOptions.length > 0 ? (
                  <div className="model-chip-list" aria-label="常用模型列表">
                    {modelOptions.map((model) => (
                      <span key={model} className="model-chip">
                        {model}
                        <button
                          type="button"
                          aria-label={`删除模型 ${model}`}
                          onClick={() => removeModel(model)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="advanced-settings wide-field">
                <button
                  type="button"
                  className="advanced-toggle-button"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {advancedOpen ? '隐藏高级设置' : '显示高级设置'}
                </button>
                <small className="field-help">
                  权限和隔离目录配置。
                </small>
              </div>
              {advancedOpen ? (
                <div className="advanced-config-panel wide-field">
                  {draft.toolType === 'claude' ? (
                    <>
                      <fieldset className="advanced-config-section">
                        <legend>启动参数</legend>
                        <div className="advanced-option-list">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.skipPermissions ?? true}
                              onChange={(e) => updateDraft('skipPermissions', e.target.checked)}
                            />
                            <span>启动时跳过权限检查</span>
                            <small className="field-help">
                              添加 --dangerously-skip-permissions
                            </small>
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.claudeCodeRetryWatchdog ?? false}
                              onChange={(e) =>
                                updateDraft('claudeCodeRetryWatchdog', e.target.checked)
                              }
                            />
                            <span>启用 Claude Code Retry Watchdog</span>
                            <small className="field-help">
                              注入 CLAUDE_CODE_RETRY_WATCHDOG=1
                            </small>
                          </label>
                        </div>
                        <div className="advanced-field-grid advanced-field-grid-compact">
                          <label>
                            <span>Claude Code 最大重试次数</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              aria-label="Claude Code 最大重试次数"
                              value={draft.claudeCodeMaxRetries ?? ''}
                              onChange={(event) => updateClaudeCodeMaxRetries(event.target.value)}
                            />
                            <small className="field-help">
                              填写后注入 CLAUDE_CODE_MAX_RETRIES。
                            </small>
                          </label>
                        </div>
                      </fieldset>

                      <fieldset className="advanced-config-section">
                        <legend>网络与请求</legend>
                        <div className="advanced-field-grid">
                          <label>
                            <span>ANTHROPIC_BETAS</span>
                            <input
                              aria-label="ANTHROPIC_BETAS"
                              value={draft.anthropicBetas ?? ''}
                              onChange={(event) =>
                                updateDraft('anthropicBetas', event.target.value)
                              }
                            />
                            <small className="field-help">
                              AnyRouter 长上下文配置，例如 context-1m-2025-08-07。
                            </small>
                          </label>
                          <label>
                            <span>CLAUDE_CODE_ATTRIBUTION_HEADER</span>
                            <input
                              aria-label="CLAUDE_CODE_ATTRIBUTION_HEADER"
                              value={draft.claudeCodeAttributionHeader ?? ''}
                              onChange={(event) =>
                                updateDraft('claudeCodeAttributionHeader', event.target.value)
                              }
                            />
                            <small className="field-help">
                              文档示例为 0。
                            </small>
                          </label>
                          <label>
                            <span>HTTPS_PROXY</span>
                            <input
                              aria-label="HTTPS_PROXY"
                              value={draft.httpsProxy ?? ''}
                              onChange={(event) => updateDraft('httpsProxy', event.target.value)}
                            />
                            <small className="field-help">
                              Claude Code HTTPS 代理地址。
                            </small>
                          </label>
                          <label>
                            <span>HTTP_PROXY</span>
                            <input
                              aria-label="HTTP_PROXY"
                              value={draft.httpProxy ?? ''}
                              onChange={(event) => updateDraft('httpProxy', event.target.value)}
                            />
                            <small className="field-help">
                              Claude Code HTTP 代理地址。
                            </small>
                          </label>
                        </div>
                        <div className="advanced-option-list">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.claudeCodeDisableNonessentialTraffic ?? false}
                              onChange={(e) =>
                                updateDraft('claudeCodeDisableNonessentialTraffic', e.target.checked)
                              }
                            />
                            <span>禁用非必要流量</span>
                            <small className="field-help">
                              注入 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
                            </small>
                          </label>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={draft.disableInstallationChecks ?? false}
                              onChange={(e) =>
                                updateDraft('disableInstallationChecks', e.target.checked)
                              }
                            />
                            <span>禁用安装检查</span>
                            <small className="field-help">
                              注入 DISABLE_INSTALLATION_CHECKS=1
                            </small>
                          </label>
                        </div>
                      </fieldset>

                      <fieldset className="advanced-config-section">
                        <legend>本地配置</legend>
                        <div className="advanced-field-grid advanced-field-grid-compact">
                          <label>
                            <span>Claude 配置清理保留天数</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              aria-label="Claude 配置清理保留天数"
                              value={draft.claudeCleanupPeriodDays ?? ''}
                              onChange={(event) =>
                                updateClaudeCleanupPeriodDays(event.target.value)
                              }
                            />
                            <small className="field-help">
                              写入 Claude settings 的 cleanupPeriodDays。
                            </small>
                          </label>
                        </div>
                        <fieldset className="advanced-readonly-fields">
                          <legend>只读字段（由 AgentDock 自动管理）</legend>
                          <label>
                            <span>配置 ID</span>
                            <input value={draft.id} readOnly />
                          </label>
                          <label>
                            <span>Keychain Service</span>
                            <input value={draft.keychainService} readOnly />
                          </label>
                          <label>
                            <span>Keychain Account</span>
                            <input value={draft.keychainAccount} readOnly />
                          </label>
                        </fieldset>
                      </fieldset>
                    </>
                  ) : (
                    <>
                      {draft.toolType === 'codex' ? (
                        <fieldset className="advanced-config-section">
                          <legend>启动参数</legend>
                          <div className="advanced-option-list">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={draft.bypassApprovals ?? true}
                                onChange={(e) => updateDraft('bypassApprovals', e.target.checked)}
                              />
                              <span>启动时跳过批准和沙箱</span>
                              <small className="field-help">
                                添加 --dangerously-bypass-approvals-and-sandbox
                              </small>
                            </label>
                          </div>
                        </fieldset>
                      ) : null}
                      <fieldset className="advanced-config-section">
                        <legend>本地配置</legend>
                        <fieldset className="advanced-readonly-fields">
                          <legend>只读字段（由 AgentDock 自动管理）</legend>
                          <label>
                            <span>配置 ID</span>
                            <input value={draft.id} readOnly />
                          </label>
                          <label>
                            <span>Keychain Service</span>
                            <input value={draft.keychainService} readOnly />
                          </label>
                          <label>
                            <span>Keychain Account</span>
                            <input value={draft.keychainAccount} readOnly />
                          </label>
                          {draft.toolType === 'codex' ? (
                            <label>
                              <span>Codex Home</span>
                              <input value={draft.codexHome ?? ''} readOnly />
                            </label>
                          ) : null}
                        </fieldset>
                      </fieldset>
                    </>
                  )}
                </div>
              ) : null}
              <div className="api-key-editor wide-field">
                <label>
                  <span>API Key（本机加密保存）</span>
                  <small className="field-help">
                    填写后本机加密保存；留空则保留当前 Key。
                  </small>
                  <small className="field-help">点击显示才会读取当前配置的 Key。</small>
                  <span className="secret-input-wrap">
                    <input
                      type={secretVisible ? 'text' : 'password'}
                      aria-label="API Key（本机加密保存）"
                      value={secretDraft}
                      autoComplete="off"
                      placeholder="粘贴 API Key；留空则保留当前 Key"
                      onChange={(event) => updateSecretDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="secret-eye-button"
                      aria-label={secretVisible ? '隐藏 API Key' : '显示 API Key'}
                      title={secretVisible ? '隐藏 API Key' : '显示 API Key'}
                      disabled={secretLoading || (!secretDraft && !onReadProfileSecret)}
                      onClick={() => void toggleSecretVisibility()}
                    >
                      {secretLoading ? '…' : secretVisible ? '🙈' : '👁'}
                    </button>
                  </span>
                </label>
              </div>
              <div className="profile-editor-actions wide-field">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(createDraft(selectedProfile));
                    setSecretDraft('');
                    setSecretVisible(false);
                    setSecretDirty(false);
                    setNewModelDraft('');
                    setModelMessage(null);
                  }}
                >
                  重置
                </button>
                {!isNewDraft && onDeleteProfile ? (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={deleting}
                    onClick={() => void handleDelete()}
                  >
                    {deleting ? '删除中…' : '删除配置'}
                  </button>
                ) : null}
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? '保存中…' : '保存配置'}
                </button>
              </div>
              {deleteError ? <span className="save-status error" role="alert">{deleteError}</span> : null}
            </div>
          ) : (
            <p className="empty-state">请选择一个配置后编辑。</p>
          )}
        </form>
      </div>
    </section>
  );
}
