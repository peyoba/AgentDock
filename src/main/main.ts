import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodePtyAdapter } from './adapters/ptyAdapter.js';
import { createEncryptedVaultAdapter } from './adapters/secretVaultAdapter.js';
import { fetchProfileModels } from './modelFetchService.js';
import { createSessionService } from './sessionService.js';
import { createProfileStore } from './stores/profileStore.js';
import { createWorkspaceStore } from './stores/workspaceStore.js';
import { createWorkspaceFromPath, mergeWorkspaces } from './workspaceService.js';
import { normalizeClaudeProfileDefaults } from '../shared/claudeProfileDefaults.js';
import { defaultApiProfiles, isDefaultApiProfileId } from '../shared/defaultApiProfiles.js';
import { defaultWorkspaces } from '../shared/defaultWorkspaces.js';
import type {
  ApiProfile,
  LaunchRequest,
  ProfileModelsFetchRequest,
  ProfileSecretReadRequest,
  ProfileSecretSaveRequest,
  TerminalBufferRequest,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
} from '../shared/agentdockTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDataPath = app.getPath('userData');
const profileStore = createProfileStore(userDataPath);
const workspaceStore = createWorkspaceStore(userDataPath);
const secretAdapter = createEncryptedVaultAdapter({
  filePath: path.join(userDataPath, 'secrets.vault.json'),
});
const sessionService = createSessionService({
  keychain: secretAdapter,
  pty: createNodePtyAdapter(),
  appDataPath: userDataPath,
  workspaceExists: fs.existsSync,
});

const defaultProfiles: ApiProfile[] = defaultApiProfiles;

function sanitizeProfile(profile: ApiProfile): ApiProfile {
  const normalizedProfile = normalizeClaudeProfileDefaults(profile);
  const availableModels = normalizeModelList(normalizedProfile.availableModels);
  const claudeCodeMaxRetries = positiveInteger(normalizedProfile.claudeCodeMaxRetries);
  const claudeCleanupPeriodDays = positiveInteger(normalizedProfile.claudeCleanupPeriodDays);

  return {
    id: normalizedProfile.id,
    name: normalizedProfile.name,
    toolType: normalizedProfile.toolType,
    baseUrl: normalizedProfile.baseUrl,
    defaultModel: normalizedProfile.defaultModel || undefined,
    availableModels: availableModels.length > 0 ? availableModels : undefined,
    keychainService: normalizedProfile.keychainService,
    keychainAccount: normalizedProfile.keychainAccount,
    codexHome: normalizedProfile.codexHome || undefined,
    skipPermissions: normalizedProfile.skipPermissions,
    bypassApprovals: normalizedProfile.bypassApprovals,
    claudeCodeRetryWatchdog: normalizedProfile.claudeCodeRetryWatchdog,
    claudeCodeMaxRetries,
    anthropicBetas: optionalTrimmedString(normalizedProfile.anthropicBetas),
    httpProxy: optionalTrimmedString(normalizedProfile.httpProxy),
    httpsProxy: optionalTrimmedString(normalizedProfile.httpsProxy),
    claudeCodeDisableNonessentialTraffic:
      normalizedProfile.claudeCodeDisableNonessentialTraffic,
    claudeCodeAttributionHeader: optionalTrimmedString(
      normalizedProfile.claudeCodeAttributionHeader,
    ),
    disableInstallationChecks: normalizedProfile.disableInstallationChecks,
    claudeCleanupPeriodDays,
    claudeDefaultLaunchMode: normalizedProfile.claudeDefaultLaunchMode,
    claudeHaikuModel: optionalTrimmedString(normalizedProfile.claudeHaikuModel),
    claudeSonnetModel: optionalTrimmedString(normalizedProfile.claudeSonnetModel),
    claudeOpusModel: optionalTrimmedString(normalizedProfile.claudeOpusModel),
    claudeAlwaysThinkingEnabled: normalizedProfile.claudeAlwaysThinkingEnabled,
  };
}

function normalizeModelList(models: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const model of models ?? []) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

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

async function listProfiles(): Promise<ApiProfile[]> {
  const storedProfiles = await profileStore.list();
  const profilesById = new Map(defaultProfiles.map((profile) => [profile.id, profile]));

  for (const profile of storedProfiles) {
    profilesById.set(profile.id, sanitizeProfile(profile));
  }

  return [...profilesById.values()];
}

async function saveProfile(profile: ApiProfile): Promise<ApiProfile> {
  const safeProfile = sanitizeProfile(profile);
  await profileStore.save(safeProfile);
  return safeProfile;
}

async function listWorkspaces(): Promise<Workspace[]> {
  return mergeWorkspaces(defaultWorkspaces, await workspaceStore.list());
}

async function chooseWorkspace(parentWindow: BrowserWindow | null): Promise<Workspace | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: '选择工作区目录',
    properties: ['openDirectory'],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  const selectedPath = result.filePaths[0];

  if (result.canceled || !selectedPath) {
    return undefined;
  }

  const existingWorkspace = (await listWorkspaces()).find(
    (workspace) => path.resolve(workspace.path) === path.resolve(selectedPath),
  );
  if (existingWorkspace) {
    return existingWorkspace;
  }

  const workspace = createWorkspaceFromPath(selectedPath);
  await workspaceStore.save(workspace);
  return workspace;
}

function hardenWebContents(
  contents: Electron.WebContents,
  devServerUrl: string | undefined,
): void {
  // 拒绝渲染层打开新窗口；仅把 https 链接交给系统浏览器，其余一律拦截
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 锁定导航：生产只允许本地 file://，开发额外允许 Vite dev server，
  // 避免注入内容把渲染进程导航到外部页面窃取已展示的密钥
  contents.on('will-navigate', (event, url) => {
    const isDevNavigation = Boolean(devServerUrl) && url.startsWith(devServerUrl as string);
    if (!isDevNavigation && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('profiles:list', () => listProfiles());
  ipcMain.handle('profiles:save', (_event, profile: ApiProfile) => saveProfile(profile));
  ipcMain.handle('profiles:saveSecret', async (_event, request: ProfileSecretSaveRequest) => {
    await secretAdapter.writeSecret(
      request.keychainService,
      request.keychainAccount,
      request.secret,
    );
  });
  ipcMain.handle('profiles:readSecret', (_event, request: ProfileSecretReadRequest) =>
    secretAdapter.readSecret(request.keychainService, request.keychainAccount),
  );
  ipcMain.handle('profiles:fetchModels', async (_event, request: ProfileModelsFetchRequest) => {
    const profile = (await listProfiles()).find((item) => item.id === request.profileId);
    if (!profile) {
      throw new Error('所选配置不存在，无法拉取模型列表');
    }

    return fetchProfileModels({ profile, secretAdapter });
  });
  ipcMain.handle('profiles:delete', async (_event, { profileId }: { profileId: string }) => {
    if (isDefaultApiProfileId(profileId)) {
      throw new Error('无法删除内置默认配置；请新增自定义配置或编辑保存覆盖。');
    }

    const profiles = await listProfiles();
    if (profiles.length <= 1) {
      throw new Error('无法删除最后一个配置，至少需要保留一个');
    }
    await profileStore.delete(profileId);
  });
  ipcMain.handle('workspaces:list', () => listWorkspaces());
  ipcMain.handle('workspaces:choose', (event) =>
    chooseWorkspace(BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle('sessions:list', () => sessionService.list());
  ipcMain.handle('terminal:write', (_event, request: TerminalWriteRequest) =>
    sessionService.writeTerminal(request),
  );
  ipcMain.handle('terminal:resize', (_event, request: TerminalResizeRequest) =>
    sessionService.resizeTerminal(request),
  );
  ipcMain.handle('terminal:kill', (_event, request: TerminalKillRequest) =>
    sessionService.killTerminal(request),
  );
  ipcMain.handle('terminal:buffer', (_event, request: TerminalBufferRequest) =>
    sessionService.readTerminalBuffer(request),
  );
  ipcMain.handle('sessions:launch', async (_event, request: LaunchRequest) => {
    const profiles = await listProfiles();
    const profile = profiles.find((item) => item.id === request.profileId);
    const workspaces = await listWorkspaces();
    const workspace = workspaces.find((item) => item.id === request.workspaceId);

    if (!profile || !workspace) {
      throw new Error('所选配置或工作区不存在，无法启动会话');
    }

    return sessionService.launch({
      profile,
      workspace,
      command: request.command,
    });
  });
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    title: 'AgentDock 代理坞',
    titleBarStyle: 'hidden',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const unsubscribeTerminalOutput = sessionService.onTerminalOutput((event) => {
    window.webContents.send('terminal:output', event);
  });
  window.on('closed', unsubscribeTerminalOutput);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  hardenWebContents(window.webContents, devServerUrl);
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
