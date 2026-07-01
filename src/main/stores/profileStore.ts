import path from 'node:path';
import type { ApiProfile } from '../../shared/agentdockTypes.js';
import { createJsonStore } from './jsonStore.js';

export function createProfileStore(rootDir: string) {
  const store = createJsonStore<ApiProfile>(path.join(rootDir, 'profiles.json'));

  return {
    list: store.list,
    save(profile: ApiProfile): Promise<void> {
      return store.save({
        id: profile.id,
        name: profile.name,
        toolType: profile.toolType,
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel,
        keychainService: profile.keychainService,
        keychainAccount: profile.keychainAccount,
        codexHome: profile.codexHome,
      });
    },
  };
}
