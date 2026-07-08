import { describe, expect, it, vi } from 'vitest';
import type { ApiProfile, Workspace } from '../../src/shared/agentdockTypes';
import {
  CURRENT_CONFIG_VERSION,
  migrateProfile,
  migrateWorkspace,
  addVersionToProfile,
  addVersionToWorkspace,
} from '../../src/main/stores/configMigration';


describe('configMigration', () => {
  describe('Profile migration', () => {
    it('migrates v1 profile to current version fields', () => {
      const v1Profile = {
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        defaultModel: 'claude-3-5-haiku',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
      };

      const migrated = migrateProfile(v1Profile);

      expect(migrated).toMatchObject({
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        defaultModel: 'claude-3-5-haiku',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
        skipPermissions: undefined,
        bypassApprovals: undefined,
        claudeCodeRetryWatchdog: undefined,
        claudeCodeMaxRetries: undefined,
        anthropicBetas: undefined,
        httpProxy: undefined,
        httpsProxy: undefined,
        claudeCodeDisableNonessentialTraffic: undefined,
        claudeCodeAttributionHeader: undefined,
        disableInstallationChecks: undefined,
        claudeCleanupPeriodDays: undefined,
        claudeCclineStatusLineEnabled: true,
      });
    });

    it('preserves existing fields during migration', () => {
      const v1Profile = {
        id: 'codex-test',
        name: 'Codex Test',
        toolType: 'codex',
        baseUrl: 'https://api.example.com/v1',
        defaultModel: 'gpt-5-codex',
        availableModels: ['gpt-5-codex', 'gpt-4o'],
        keychainService: 'AgentDock',
        keychainAccount: 'codex-test',
        codexHome: '~/.agentdock/codex-profiles/codex-test',
      };

      const migrated = migrateProfile(v1Profile);

      expect(migrated).toEqual({
        id: 'codex-test',
        name: 'Codex Test',
        toolType: 'codex',
        baseUrl: 'https://api.example.com/v1',
        defaultModel: 'gpt-5-codex',
        availableModels: ['gpt-5-codex', 'gpt-4o'],
        keychainService: 'AgentDock',
        keychainAccount: 'codex-test',
        codexHome: '~/.agentdock/codex-profiles/codex-test',
        skipPermissions: undefined,
        bypassApprovals: undefined,
        claudeCodeRetryWatchdog: undefined,
        claudeCodeMaxRetries: undefined,
        anthropicBetas: undefined,
        httpProxy: undefined,
        httpsProxy: undefined,
        claudeCodeDisableNonessentialTraffic: undefined,
        claudeCodeAttributionHeader: undefined,
        disableInstallationChecks: undefined,
        claudeCleanupPeriodDays: undefined,
      });
    });

    it('handles v2 profile (already migrated)', () => {
      const v2ProfileWithVersion = {
        __version: 2,
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
        skipPermissions: true,
        bypassApprovals: undefined,
      };

      const migrated = migrateProfile(v2ProfileWithVersion);

      expect(migrated.id).toBe('claude-test');
      expect(migrated.name).toBe('Claude Test');
      expect(migrated.baseUrl).toBe('https://api.example.com');
      expect(migrated.skipPermissions).toBe(true);
      expect(migrated.bypassApprovals).toBeUndefined();
      expect(migrated.claudeCodeRetryWatchdog).toBeUndefined();
      expect(migrated.claudeCodeMaxRetries).toBeUndefined();
    });

    it('preserves v3 Claude retry fields', () => {
      const v3ProfileWithVersion = {
        __version: 3,
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
        claudeCleanupPeriodDays: 720,
        claudeCclineStatusLineEnabled: true,
      };

      const migrated = migrateProfile(v3ProfileWithVersion);

      expect(migrated.claudeCodeRetryWatchdog).toBe(true);
      expect(migrated.claudeCodeMaxRetries).toBe(100);
      expect(migrated.anthropicBetas).toBe('context-1m-2025-08-07');
      expect(migrated.httpProxy).toBe('http://127.0.0.1:7890');
      expect(migrated.httpsProxy).toBe('http://127.0.0.1:7890');
      expect(migrated.claudeCodeDisableNonessentialTraffic).toBe(true);
      expect(migrated.claudeCodeAttributionHeader).toBe('0');
      expect(migrated.disableInstallationChecks).toBe(true);
      expect(migrated.claudeCleanupPeriodDays).toBe(720);
    });

    it('keeps stored AnyRouter Claude model selectable while adding 1m beta settings', () => {
      const v3ProfileWithVersion = {
        __version: 3,
        id: 'claude-anyrouter',
        name: 'Claude · AnyRouter GitHub B',
        toolType: 'claude',
        baseUrl: 'https://a-ocnfniawgw.cn-shanghai.fcapp.run',
        defaultModel: 'claude-fable-5',
        availableModels: ['claude-fable-5', 'claude-opus-4-7'],
        keychainService: 'AgentDock',
        keychainAccount: 'claude-anyrouter',
        anthropicBetas: 'http://127.0.0.1:7897',
        httpProxy: 'context-1m-2025-08-07',
        httpsProxy: 'not-a-url',
      };

      const migrated = migrateProfile(v3ProfileWithVersion);

      expect(migrated.defaultModel).toBe('claude-fable-5');
      expect(migrated.claudeHaikuModel).toBe('claude-haiku-4-5-20251001');
      expect(migrated.claudeSonnetModel).toBe('claude-fable-5');
      expect(migrated.claudeOpusModel).toBe('claude-opus-4-8');
      expect(migrated.claudeDefaultLaunchMode).toBe('default');
      expect(migrated.availableModels).toEqual(['claude-fable-5', 'claude-opus-4-7']);
      expect(migrated.anthropicBetas).toBe('context-1m-2025-08-07');
      expect(migrated.httpProxy).toBeUndefined();
      expect(migrated.httpsProxy).toBeUndefined();
    });

    it('migrates legacy opus 1m pseudo model to explicit AnyRouter Claude model mapping defaults', () => {
      const v4ProfileWithLegacyModel = {
        __version: 4,
        id: 'claude-anyrouter',
        name: 'Claude · AnyRouter Linuxdo A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'opus[1m]',
        availableModels: ['opus[1m]', 'claude-fable-5', 'claude-opus-4-7'],
        keychainService: 'AgentDock',
        keychainAccount: 'claude-anyrouter',
        anthropicBetas: 'context-1m-2025-08-07',
      };

      const migrated = migrateProfile(v4ProfileWithLegacyModel);

      expect(migrated.defaultModel).toBe('claude-opus-4-8');
      expect(migrated.claudeHaikuModel).toBe('claude-haiku-4-5-20251001');
      expect(migrated.claudeSonnetModel).toBe('claude-fable-5');
      expect(migrated.claudeOpusModel).toBe('claude-opus-4-8');
      expect(migrated.claudeDefaultLaunchMode).toBe('default');
      expect(migrated.availableModels).toEqual(['claude-fable-5', 'claude-opus-4-7']);
      expect(migrated.anthropicBetas).toBe('context-1m-2025-08-07');
    });

    it('throws error on invalid profile data', () => {
      expect(() => migrateProfile(null)).toThrow('配置数据格式无效');
      expect(() => migrateProfile(undefined)).toThrow('配置数据格式无效');
      expect(() => migrateProfile('not an object')).toThrow('配置数据格式无效');
    });

    it('throws error on unsupported version', () => {
      const futureVersionProfile = {
        __version: 999,
        id: 'test',
        name: 'Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        keychainService: 'AgentDock',
        keychainAccount: 'test',
      };

      expect(() => migrateProfile(futureVersionProfile)).toThrow('不支持的配置版本: 999');
    });

    it('treats missing __version as v1', () => {
      const implicitV1Profile = {
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
      };

      const migrated = migrateProfile(implicitV1Profile);

      expect(migrated.skipPermissions).toBeUndefined();
      expect(migrated.bypassApprovals).toBeUndefined();
      expect(migrated.claudeCodeRetryWatchdog).toBeUndefined();
      expect(migrated.claudeCodeMaxRetries).toBeUndefined();
      expect(migrated.anthropicBetas).toBeUndefined();
      expect(migrated.httpProxy).toBeUndefined();
      expect(migrated.httpsProxy).toBeUndefined();
      expect(migrated.claudeCodeDisableNonessentialTraffic).toBeUndefined();
      expect(migrated.claudeCodeAttributionHeader).toBeUndefined();
      expect(migrated.disableInstallationChecks).toBeUndefined();
      expect(migrated.claudeCleanupPeriodDays).toBeUndefined();
    });
  });

  describe('Workspace migration', () => {
    it('migrates v1 workspace', () => {
      const v1Workspace = {
        id: 'workspace-test',
        name: 'Test Workspace',
        path: '/Users/test/workspace',
      };

      const migrated = migrateWorkspace(v1Workspace);

      expect(migrated).toEqual({
        id: 'workspace-test',
        name: 'Test Workspace',
        path: '/Users/test/workspace',
      });
    });

    it('handles v2 workspace', () => {
      const v2Workspace: Workspace = {
        id: 'workspace-test',
        name: 'Test Workspace',
        path: '/Users/test/workspace',
      };

      const migrated = migrateWorkspace(v2Workspace);

      expect(migrated).toEqual(v2Workspace);
    });

    it('throws error on invalid workspace data', () => {
      expect(() => migrateWorkspace(null)).toThrow('Invalid workspace data');
      expect(() => migrateWorkspace(undefined)).toThrow('Invalid workspace data');
    });

    it('throws error on unsupported workspace version', () => {
      const futureVersionWorkspace = {
        __version: 999,
        id: 'test',
        name: 'Test',
        path: '/test',
      };

      expect(() => migrateWorkspace(futureVersionWorkspace)).toThrow(
        'Unsupported workspace version: 999'
      );
    });
  });

  describe('Version tagging', () => {
    it('adds current version to profile', () => {
      const profile: ApiProfile = {
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
      };

      const versioned = addVersionToProfile(profile);

      expect(versioned).toEqual({
        ...profile,
        __version: CURRENT_CONFIG_VERSION,
      });
    });

    it('adds current version to workspace', () => {
      const workspace: Workspace = {
        id: 'workspace-test',
        name: 'Test Workspace',
        path: '/Users/test/workspace',
      };

      const versioned = addVersionToWorkspace(workspace);

      expect(versioned).toEqual({
        ...workspace,
        __version: CURRENT_CONFIG_VERSION,
      });
    });

    it('uses the current config version', () => {
      expect(CURRENT_CONFIG_VERSION).toBe(5);
    });

    it('preserves the Claude Anthropic compat proxy flag during migration and versioning', () => {
      const migrated = migrateProfile({
        __version: 4,
        id: 'claude-custom-1',
        name: 'Claude Custom',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-custom-1',
        claudeAnthropicCompatProxyEnabled: true,
      });

      expect(migrated.claudeAnthropicCompatProxyEnabled).toBe(true);
      expect(addVersionToProfile(migrated).__version).toBe(5);
    });
  });

  describe('Round-trip migration', () => {
    it('profile survives v1->v2 migration and back', () => {
      const originalProfile: ApiProfile = {
        id: 'claude-test',
        name: 'Claude Test',
        toolType: 'claude',
        baseUrl: 'https://api.example.com',
        defaultModel: 'claude-3-5-haiku',
        availableModels: ['claude-3-5-haiku', 'claude-opus'],
        keychainService: 'AgentDock',
        keychainAccount: 'claude-test',
        skipPermissions: false,
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
        claudeCleanupPeriodDays: 720,
        claudeAnthropicCompatProxyEnabled: true,
        claudeCclineStatusLineEnabled: true,
      };

      // 保存时添加版本号
      const saved = addVersionToProfile(originalProfile);

      // 从存储读取时迁移
      const migrated = migrateProfile(saved);

      // 核心字段保留
      expect(migrated.id).toBe(originalProfile.id);
      expect(migrated.name).toBe(originalProfile.name);
      expect(migrated.baseUrl).toBe(originalProfile.baseUrl);
      expect(migrated.defaultModel).toBe(originalProfile.defaultModel);
      expect(migrated.availableModels).toEqual(originalProfile.availableModels);
      expect(migrated.skipPermissions).toBe(originalProfile.skipPermissions);
      expect(migrated.claudeCodeRetryWatchdog).toBe(originalProfile.claudeCodeRetryWatchdog);
      expect(migrated.claudeCodeMaxRetries).toBe(originalProfile.claudeCodeMaxRetries);
      expect(migrated.anthropicBetas).toBe(originalProfile.anthropicBetas);
      expect(migrated.httpProxy).toBe(originalProfile.httpProxy);
      expect(migrated.httpsProxy).toBe(originalProfile.httpsProxy);
      expect(migrated.claudeCodeDisableNonessentialTraffic).toBe(
        originalProfile.claudeCodeDisableNonessentialTraffic,
      );
      expect(migrated.claudeCodeAttributionHeader).toBe(
        originalProfile.claudeCodeAttributionHeader,
      );
      expect(migrated.disableInstallationChecks).toBe(originalProfile.disableInstallationChecks);
      expect(migrated.claudeCleanupPeriodDays).toBe(originalProfile.claudeCleanupPeriodDays);
      expect(migrated.claudeAnthropicCompatProxyEnabled).toBe(
        originalProfile.claudeAnthropicCompatProxyEnabled,
      );
      expect(migrated.claudeCclineStatusLineEnabled).toBe(
        originalProfile.claudeCclineStatusLineEnabled,
      );
    });

    it('workspace survives v1->v2 migration', () => {
      const originalWorkspace: Workspace = {
        id: 'workspace-test',
        name: 'Test Workspace',
        path: '/Users/test/workspace',
      };

      // 保存时添加版本号
      const saved = addVersionToWorkspace(originalWorkspace);

      // 从存储读取时迁移
      const migrated = migrateWorkspace(saved);

      expect(migrated).toEqual(originalWorkspace);
    });
  });

  describe('Batch migration', () => {
    it('can migrate multiple profiles at once', () => {
      const profiles = [
        {
          id: 'claude-1',
          name: 'Claude 1',
          toolType: 'claude',
          baseUrl: 'https://api.example.com',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-1',
        },
        {
          id: 'codex-1',
          name: 'Codex 1',
          toolType: 'codex',
          baseUrl: 'https://api.example.com/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-1',
        },
      ];

      const migrated = profiles.map((p) => migrateProfile(p));

      expect(migrated).toHaveLength(2);
      expect(migrated[0].skipPermissions).toBeUndefined();
      expect(migrated[0].claudeCodeRetryWatchdog).toBeUndefined();
      expect(migrated[0].claudeCodeMaxRetries).toBeUndefined();
      expect(migrated[0].anthropicBetas).toBeUndefined();
      expect(migrated[0].claudeCleanupPeriodDays).toBeUndefined();
      expect(migrated[1].bypassApprovals).toBeUndefined();
    });
  });
});
