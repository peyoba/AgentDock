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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
  const [modelFetching, setModelFetching] = React.useState(false);
  const [modelMessage, setModelMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft(createDraft(selectedProfile));
    setSecretDraft('');
    setSecretVisible(false);
    setSecretDirty(false);
    setSecretLoading(false);
    setNewModelDraft('');
    setModelFetching(false);
    setModelMessage(null);
    setSaveMessage(null);
    setSaveError(null);
    setAdvancedOpen(false);
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

  const modelOptions = normalizeModelList(draft?.availableModels);

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
        defaultModel:
          nextDefault && (nextModels.length === 0 || nextModels.includes(nextDefault))
            ? nextDefault
            : nextModels[0],
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
      setModelOptions(models, models.includes(draft.defaultModel ?? '') ? draft.defaultModel : models[0]);
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
                        value={draft.defaultModel ?? modelOptions[0] ?? ''}
                        onChange={(event) => updateDraft('defaultModel', event.target.value)}
                      >
                        {modelOptions.map((model) => (
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
                  <div className="model-chip-list" aria-label="可选模型列表">
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
                  内部标识、密钥存储位置和 Codex 隔离目录由 AgentDock 自动管理。
                </small>
              </div>
              {advancedOpen ? (
                <>
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
                </>
              ) : null}
              <div className="api-key-editor wide-field">
                <label>
                  <span>API Key（本机加密保存）</span>
                  <small className="field-help">
                    填写后本机加密保存；留空则保留当前 Key。
                  </small>
                  <small className="field-help">点击显示才会读取当前配置的 Key。</small>
                  <input
                    type={secretVisible ? 'text' : 'password'}
                    aria-label="API Key（本机加密保存）"
                    value={secretDraft}
                    autoComplete="off"
                    placeholder="粘贴 API Key；留空则保留当前 Key"
                    onChange={(event) => updateSecretDraft(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secret-visibility-button"
                  disabled={secretLoading || (!secretDraft && !onReadProfileSecret)}
                  onClick={() => void toggleSecretVisibility()}
                >
                  {secretLoading
                    ? '读取中…'
                    : secretVisible
                      ? '隐藏 API Key'
                      : secretDraft
                        ? '显示 API Key'
                        : '显示已保存 API Key'}
                </button>
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
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving ? '保存中…' : '保存配置'}
                </button>
              </div>
            </div>
          ) : (
            <p className="empty-state">请选择一个配置后编辑。</p>
          )}
        </form>
      </div>
    </section>
  );
}
