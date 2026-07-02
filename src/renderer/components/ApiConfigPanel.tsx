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
  onBackToWorkbench?: () => void;
};

function toolLabel(toolType: ToolType): string {
  return toolTypes.find((item) => item.value === toolType)?.label ?? toolType;
}

function createDraft(profile?: ApiProfile): ApiProfile | undefined {
  if (!profile) {
    return undefined;
  }

  return { ...profile };
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
  onBackToWorkbench,
}: ApiConfigPanelProps): React.JSX.Element {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const [draft, setDraft] = React.useState<ApiProfile | undefined>(() => createDraft(selectedProfile));
  const [secretDraft, setSecretDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft(createDraft(selectedProfile));
    setSecretDraft('');
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

  const startNewProfile = (): void => {
    const nextDraft = createNewProfileDraft({ filter, profiles, selectedProfile });
    setDraft(nextDraft);
    setSecretDraft('');
    setSaveMessage(null);
    setSaveError(null);
    setAdvancedOpen(false);
    onFilterChange(nextDraft.toolType);
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
      const savedProfile = await onSaveProfile({
        ...draft,
        name: draft.name.trim(),
        baseUrl: draft.baseUrl.trim(),
        defaultModel: draft.defaultModel?.trim() || undefined,
        keychainService: draft.keychainService.trim(),
        keychainAccount: draft.keychainAccount.trim(),
        codexHome: draft.codexHome?.trim() || undefined,
      });
      if (secretDraft.trim()) {
        await onSaveProfileSecret({
          keychainService: savedProfile.keychainService,
          keychainAccount: savedProfile.keychainAccount,
          secret: secretDraft,
        });
        setDraft(savedProfile);
        setSecretDraft('');
        setSaveMessage('API Key 已写入 Keychain');
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
              <p>每个配置使用独立密钥槽位；不会读取或显示完整 API Key。</p>
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
              <label>
                <span>默认模型</span>
                <input
                  value={draft.defaultModel ?? ''}
                  onChange={(event) => updateDraft('defaultModel', event.target.value)}
                />
              </label>
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
              <label className="wide-field">
                <span>API Key（保存到 macOS 钥匙串）</span>
                <small className="field-help">填写后保存到 macOS 钥匙串；留空则保留当前 Key。</small>
                <input
                  type="password"
                  aria-label="API Key（保存到 macOS 钥匙串）"
                  value={secretDraft}
                  autoComplete="off"
                  placeholder="粘贴 API Key，保存后不会显示明文"
                  onChange={(event) => setSecretDraft(event.target.value)}
                />
              </label>
              <div className="profile-editor-actions wide-field">
                <button type="button" onClick={() => setDraft(createDraft(selectedProfile))}>
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
