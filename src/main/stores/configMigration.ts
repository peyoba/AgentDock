import type { ApiProfile, ToolType, Workspace } from '../../shared/agentdockTypes.js';
import { normalizeClaudeProfileDefaults } from '../../shared/claudeProfileDefaults.js';

/**
 * 配置版本化和迁移系统
 *
 * 当配置格式发生变化时，通过版本号和迁移函数自动升级用户数据
 * 不支持的较旧版本会被跳过，最新版本才会被使用
 */

export type ConfigVersion = 1 | 2 | 3 | 4;

export type VersionedApiProfile = ApiProfile & {
  __version: ConfigVersion;
};

export type VersionedWorkspace = Workspace & {
  __version: ConfigVersion;
};

/**
 * 当前配置版本
 * 每当配置结构变化时，递增此值
 */
export const CURRENT_CONFIG_VERSION: ConfigVersion = 4;

/**
 * Profile 配置版本迁移函数
 * v1 -> v2: 添加权限参数 (skipPermissions, bypassApprovals)
 * v2 -> v3: 添加 Claude Code / AnyRouter 可选参数
 */
export function migrateProfile(data: unknown): ApiProfile {
  if (!data || typeof data !== 'object') {
    throw new Error('配置数据格式无效');
  }

  const profile = data as Record<string, unknown>;
  const version = (profile.__version as number) ?? 1;

  if (version === 1 || version === 2) {
    return migrateProfileToCurrent(profile);
  }

  // 已是最新版本
  if (version === 3 || version === 4) {
    return normalizeClaudeProfileDefaults({
      id: profile.id as string,
      name: profile.name as string,
      toolType: profile.toolType as ToolType,
      baseUrl: profile.baseUrl as string,
      defaultModel: profile.defaultModel as string | undefined,
      availableModels: profile.availableModels as string[] | undefined,
      keychainService: profile.keychainService as string,
      keychainAccount: profile.keychainAccount as string,
      codexHome: profile.codexHome as string | undefined,
      skipPermissions: profile.skipPermissions as boolean | undefined,
      bypassApprovals: profile.bypassApprovals as boolean | undefined,
      claudeCodeRetryWatchdog: profile.claudeCodeRetryWatchdog as boolean | undefined,
      claudeCodeMaxRetries: profile.claudeCodeMaxRetries as number | undefined,
      anthropicBetas: profile.anthropicBetas as string | undefined,
      httpProxy: profile.httpProxy as string | undefined,
      httpsProxy: profile.httpsProxy as string | undefined,
      claudeCodeDisableNonessentialTraffic:
        profile.claudeCodeDisableNonessentialTraffic as boolean | undefined,
      claudeCodeAttributionHeader: profile.claudeCodeAttributionHeader as string | undefined,
      disableInstallationChecks: profile.disableInstallationChecks as boolean | undefined,
      claudeCleanupPeriodDays: profile.claudeCleanupPeriodDays as number | undefined,
      claudeDefaultLaunchMode:
        profile.claudeDefaultLaunchMode as ApiProfile['claudeDefaultLaunchMode'],
      claudeHaikuModel: profile.claudeHaikuModel as string | undefined,
      claudeSonnetModel: profile.claudeSonnetModel as string | undefined,
      claudeOpusModel: profile.claudeOpusModel as string | undefined,
      claudeAlwaysThinkingEnabled: profile.claudeAlwaysThinkingEnabled as boolean | undefined,
    });
  }

  throw new Error(`不支持的配置版本: ${version}`);
}

/**
 * 旧版本迁移到当前版本：新字段采用 undefined，让业务层使用默认值处理。
 */
function migrateProfileToCurrent(profile: Record<string, unknown>): ApiProfile {
  return normalizeClaudeProfileDefaults({
    id: profile.id as string,
    name: profile.name as string,
    toolType: profile.toolType as ToolType,
    baseUrl: profile.baseUrl as string,
    defaultModel: profile.defaultModel as string | undefined,
    availableModels: profile.availableModels as string[] | undefined,
    keychainService: profile.keychainService as string,
    keychainAccount: profile.keychainAccount as string,
    codexHome: profile.codexHome as string | undefined,
    skipPermissions: profile.skipPermissions as boolean | undefined,
    bypassApprovals: profile.bypassApprovals as boolean | undefined,
    claudeCodeRetryWatchdog: undefined,
    claudeCodeMaxRetries: undefined,
    anthropicBetas: undefined,
    httpProxy: undefined,
    httpsProxy: undefined,
    claudeCodeDisableNonessentialTraffic: undefined,
    claudeCodeAttributionHeader: undefined,
    disableInstallationChecks: undefined,
    claudeCleanupPeriodDays: undefined,
    claudeDefaultLaunchMode: undefined,
    claudeHaikuModel: undefined,
    claudeSonnetModel: undefined,
    claudeOpusModel: undefined,
    claudeAlwaysThinkingEnabled: undefined,
  });
}

/**
 * Workspace 配置版本迁移函数
 * 目前 Workspace 没有版本变化，保持为 v2
 */
export function migrateWorkspace(data: unknown): Workspace {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid workspace data');
  }

  const workspace = data as Record<string, unknown>;
  const version = (workspace.__version as number) ?? 1;

  // 从 v1/v2/v3/v4 迁移到当前版本（没有实际变化，但保持一致性）
  if (version === 1 || version === 2 || version === 3 || version === 4) {
    return {
      id: workspace.id as string,
      name: workspace.name as string,
      path: workspace.path as string,
    };
  }

  throw new Error(`Unsupported workspace version: ${version}`);
}

/**
 * 为配置对象添加版本号
 * 用于保存时标记当前版本
 */
export function addVersionToProfile(profile: ApiProfile): VersionedApiProfile {
  return {
    ...profile,
    __version: CURRENT_CONFIG_VERSION,
  };
}

export function addVersionToWorkspace(workspace: Workspace): VersionedWorkspace {
  return {
    ...workspace,
    __version: CURRENT_CONFIG_VERSION,
  };
}
