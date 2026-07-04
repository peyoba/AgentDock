import path from 'node:path';
import type { ApiProfile } from '../../shared/agentdockTypes.js';
import { normalizeClaudeProfileDefaults } from '../../shared/claudeProfileDefaults.js';
import { migrateProfile, addVersionToProfile } from './configMigration.js';
import { createJsonStore } from './jsonStore.js';

function optionalTrimmedString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function sanitizeProfile(profile: ApiProfile): ApiProfile {
  const normalizedProfile = normalizeClaudeProfileDefaults(profile);
  const sanitized: ApiProfile = {
    id: normalizedProfile.id,
    name: normalizedProfile.name,
    toolType: normalizedProfile.toolType,
    baseUrl: normalizedProfile.baseUrl,
    keychainService: normalizedProfile.keychainService,
    keychainAccount: normalizedProfile.keychainAccount,
  };

  if (normalizedProfile.defaultModel) {
    sanitized.defaultModel = normalizedProfile.defaultModel;
  }
  if (normalizedProfile.availableModels && normalizedProfile.availableModels.length > 0) {
    sanitized.availableModels = [...normalizedProfile.availableModels];
  }
  if (normalizedProfile.codexHome) {
    sanitized.codexHome = normalizedProfile.codexHome;
  }
  if (typeof normalizedProfile.skipPermissions === 'boolean') {
    sanitized.skipPermissions = normalizedProfile.skipPermissions;
  }
  if (typeof normalizedProfile.bypassApprovals === 'boolean') {
    sanitized.bypassApprovals = normalizedProfile.bypassApprovals;
  }
  if (typeof normalizedProfile.claudeCodeRetryWatchdog === 'boolean') {
    sanitized.claudeCodeRetryWatchdog = normalizedProfile.claudeCodeRetryWatchdog;
  }
  const claudeCodeMaxRetries = positiveInteger(normalizedProfile.claudeCodeMaxRetries);
  if (claudeCodeMaxRetries) {
    sanitized.claudeCodeMaxRetries = claudeCodeMaxRetries;
  }
  const anthropicBetas = optionalTrimmedString(normalizedProfile.anthropicBetas);
  if (anthropicBetas) {
    sanitized.anthropicBetas = anthropicBetas;
  }
  const httpProxy = optionalTrimmedString(normalizedProfile.httpProxy);
  if (httpProxy) {
    sanitized.httpProxy = httpProxy;
  }
  const httpsProxy = optionalTrimmedString(normalizedProfile.httpsProxy);
  if (httpsProxy) {
    sanitized.httpsProxy = httpsProxy;
  }
  if (typeof normalizedProfile.claudeCodeDisableNonessentialTraffic === 'boolean') {
    sanitized.claudeCodeDisableNonessentialTraffic =
      normalizedProfile.claudeCodeDisableNonessentialTraffic;
  }
  const attributionHeader = optionalTrimmedString(normalizedProfile.claudeCodeAttributionHeader);
  if (attributionHeader) {
    sanitized.claudeCodeAttributionHeader = attributionHeader;
  }
  if (typeof normalizedProfile.disableInstallationChecks === 'boolean') {
    sanitized.disableInstallationChecks = normalizedProfile.disableInstallationChecks;
  }
  const claudeCleanupPeriodDays = positiveInteger(normalizedProfile.claudeCleanupPeriodDays);
  if (claudeCleanupPeriodDays) {
    sanitized.claudeCleanupPeriodDays = claudeCleanupPeriodDays;
  }

  return sanitized;
}

function versionProfile(profile: ApiProfile): ApiProfile {
  return addVersionToProfile(sanitizeProfile(profile)) as ApiProfile;
}

export function createProfileStore(rootDir: string) {
  const store = createJsonStore<ApiProfile>(path.join(rootDir, 'profiles.json'));

  async function list(): Promise<ApiProfile[]> {
    const stored = await store.list();
    return stored.map((item) => sanitizeProfile(migrateProfile(item)));
  }

  function save(profile: ApiProfile): Promise<void> {
    return store.save(versionProfile(profile));
  }

  async function deleteProfile(profileId: string): Promise<void> {
    const profiles = await list();
    const filtered = profiles.filter((p) => p.id !== profileId);

    if (filtered.length === profiles.length) {
      return;
    }

    await store.replaceAll(filtered.map(versionProfile));
  }

  async function migrateAll(): Promise<void> {
    await store.migrateAll((item: unknown) => {
      const migrated = migrateProfile(item);
      return versionProfile(migrated);
    });
  }

  return {
    list,
    save,
    delete: deleteProfile,
    migrateAll,
  };
}
