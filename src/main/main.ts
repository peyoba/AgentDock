import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodePtyAdapter } from './adapters/ptyAdapter.js';
import type { KeychainAdapter } from './adapters/keychainAdapter.js';
import { createKeytarAdapter } from './adapters/keychainAdapter.js';
import {
  createEncryptedVaultAdapter,
  createVaultBackedSecretAdapter,
} from './adapters/secretVaultAdapter.js';
import { fetchProfileModels } from './modelFetchService.js';
import type { SessionService } from './sessionService.js';
import { createRuntimeOwnerRegistry, createSessionService } from './sessionService.js';
import { installSingleInstanceGuard } from './singleInstanceGuard.js';
import { createSessionSummaryStore } from './sessionSummaryStore.js';
import { createProfileStore } from './stores/profileStore.js';
import { createSessionHistoryStore } from './stores/sessionHistoryStore.js';
import { createWorkspaceStore } from './stores/workspaceStore.js';
import { createSummaryJobService } from './summaryJobService.js';
import { launchContinuationWithPrompt } from './summaryContinuation.js';
import { createProfileSummaryRunner } from './summaryRunner.js';
import { createWindowSessionRegistry } from './windowSessionRegistry.js';
import { createWorkspaceContextStore } from './workspaceContextStore.js';
import { createWorkspaceFromPath, mergeWorkspaces } from './workspaceService.js';
import { normalizeClaudeProfileDefaults } from '../shared/claudeProfileDefaults.js';
import { defaultApiProfiles, isDefaultApiProfileId } from '../shared/defaultApiProfiles.js';
import { defaultWorkspaces } from '../shared/defaultWorkspaces.js';
import type {
  ApiProfile,
  CloseSessionViewRequest,
  LaunchRequest,
  ProfileModelsFetchRequest,
  ProfileSecretReadRequest,
  ProfileSecretSaveRequest,
  RestartSessionRequest,
  SessionContextPressureRequest,
  SessionHistoryArchiveRequest,
  SessionRecordRequest,
  SessionSummaryRequest,
  TerminalBufferRequest,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
  WorkspaceContextOpenRequest,
  WorkspaceContextReadRequest,
} from '../shared/agentdockTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hasSingleInstanceLock = installSingleInstanceGuard({
  app,
  getAllWindows: () => BrowserWindow.getAllWindows(),
  openWindow: () => {
    createMainWindow({ restoreHistory: true });
  },
});
const userDataPath = app.getPath('userData');
const profileStore = createProfileStore(userDataPath);
const workspaceStore = createWorkspaceStore(userDataPath);
const sessionHistoryStore = createSessionHistoryStore(userDataPath);
const runtimeOwnerRegistry = createRuntimeOwnerRegistry();
// vault 永远是唯一写入与首选读取来源；仅当 vault 未命中时读一次 legacy Keychain
// 并回写 vault（升级迁移，老 Key 至多触发一次系统弹窗）。keytar 原生模块缺失时降级纯 vault。
function createSecretAdapter(dataPath: string): KeychainAdapter {
  const vault = createEncryptedVaultAdapter({
    filePath: path.join(dataPath, 'secrets.vault.json'),
  });

  try {
    return createVaultBackedSecretAdapter({ vault, fallback: createKeytarAdapter() });
  } catch {
    return vault;
  }
}

const secretAdapter = createSecretAdapter(userDataPath);
const workspaceContextStore = createWorkspaceContextStore();
const sessionSummaryStore = createSessionSummaryStore();
const windowRestoreHistory = new Map<number, boolean>();
const sessionRegistry = createWindowSessionRegistry((windowId) => {
  let service: SessionService;
  service = createSessionService({
    keychain: secretAdapter,
    pty: createNodePtyAdapter(),
    appDataPath: userDataPath,
    workspaceExists: fs.existsSync,
    workspaceContext: workspaceContextStore,
    historyStore: sessionHistoryStore,
    restoreHistory: windowRestoreHistory.get(windowId) ?? true,
    // 每窗口唯一前缀，避免多窗口在同一 workspace 下 transcript 文件互相覆盖
    sessionIdPrefix: `w${windowId}-`,
    runtimeOwnerId: `window-${windowId}`,
    runtimeOwnerRegistry,
    summaryJob: async ({ session, workspace, continueAfterSummary }) => {
      const profile = (await listProfiles()).find((item) => item.id === session.profileId);
      if (!profile) {
        throw new Error('所选配置不存在，无法生成摘要');
      }
      const job = createSummaryJobService({
        summaryStore: sessionSummaryStore,
        runSummary: createProfileSummaryRunner({
          profile,
          keychain: secretAdapter,
          pty: createNodePtyAdapter(),
          appDataPath: userDataPath,
          homeDir: process.env.HOME ?? app.getPath('home'),
        }),
        readTranscript: () => service.readTerminalBuffer({ sessionId: session.id }),
        launchContinuation: async ({ sourceSession, handoffPrompt }) =>
          launchContinuationWithPrompt({
            service,
            profile,
            workspace,
            sourceSession,
            handoffPrompt,
          }),
      });
      return job.summarizeSession({
        session,
        workspace,
        continueAfterSummary,
        summaryProviderProfileId: profile.id,
      });
    },
  });
  return service;
});

const defaultProfiles: ApiProfile[] = defaultApiProfiles;

function sessionServiceForWebContents(contents: Electron.WebContents): SessionService {
  return sessionRegistry.getOrCreate(contents.id);
}

function broadcastMetadataChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('metadata:changed');
    }
  }
}

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
    claudeCclineStatusLineEnabled: normalizedProfile.claudeCclineStatusLineEnabled,
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

const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function saveProfile(profile: ApiProfile): Promise<ApiProfile> {
  if (!PROFILE_ID_PATTERN.test(profile.id)) {
    throw new Error('配置 ID 只能包含字母、数字、点、下划线和连字符');
  }

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

async function requireWorkspaceForContext(
  workspaceId: string,
  missingMessage: string,
): Promise<Workspace> {
  const workspace = (await listWorkspaces()).find((item) => item.id === workspaceId);
  if (!workspace) {
    throw new Error(missingMessage);
  }
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

// 输入框和选中文本的右键编辑菜单；终端区域由 renderer 侧 contextmenu preventDefault 接管，不会走到这里
function installEditContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const hasSelection = params.selectionText.trim().length > 0;
    if (!params.isEditable && !hasSelection) {
      return;
    }

    const template: Electron.MenuItemConstructorOptions[] = params.isEditable
      ? [
          { role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
          { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
          { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', label: '全选' },
        ]
      : [{ role: 'copy', label: '复制' }];

    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(contents) ?? undefined,
    });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('profiles:list', () => listProfiles());
  ipcMain.handle('profiles:save', async (_event, profile: ApiProfile) => {
    const savedProfile = await saveProfile(profile);
    broadcastMetadataChanged();
    return savedProfile;
  });
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

    const deletedProfile = (await listProfiles()).find((profile) => profile.id === profileId);
    await profileStore.delete(profileId);

    // 清理孤儿密钥：仅当没有其他配置共用同一密钥槽位时才删除
    if (deletedProfile) {
      const secretStillReferenced = (await listProfiles()).some(
        (profile) =>
          profile.keychainService === deletedProfile.keychainService &&
          profile.keychainAccount === deletedProfile.keychainAccount,
      );
      if (!secretStillReferenced) {
        await secretAdapter
          .deleteSecret(deletedProfile.keychainService, deletedProfile.keychainAccount)
          .catch(() => undefined);
      }
    }

    broadcastMetadataChanged();
  });
  ipcMain.handle('workspaces:list', () => listWorkspaces());
  ipcMain.handle('workspaces:choose', async (event) => {
    const workspace = await chooseWorkspace(BrowserWindow.fromWebContents(event.sender));
    if (workspace) {
      broadcastMetadataChanged();
    }
    return workspace;
  });
  ipcMain.handle('sessions:list', (event) => sessionServiceForWebContents(event.sender).list());
  ipcMain.handle('sessions:closeView', (event, request: CloseSessionViewRequest) =>
    sessionServiceForWebContents(event.sender).closeSessionView(request),
  );
  ipcMain.handle('sessions:archiveRecord', (event, request: SessionRecordRequest) =>
    sessionServiceForWebContents(event.sender).archiveSessionRecord(request),
  );
  ipcMain.handle('sessions:deleteRecord', (event, request: SessionRecordRequest) =>
    sessionServiceForWebContents(event.sender).deleteSessionRecord(request),
  );
  ipcMain.handle('terminal:write', (event, request: TerminalWriteRequest) =>
    sessionServiceForWebContents(event.sender).writeTerminal(request),
  );
  ipcMain.handle('terminal:resize', (event, request: TerminalResizeRequest) =>
    sessionServiceForWebContents(event.sender).resizeTerminal(request),
  );
  ipcMain.handle('terminal:kill', (event, request: TerminalKillRequest) =>
    sessionServiceForWebContents(event.sender).killTerminal(request),
  );
  ipcMain.handle('terminal:buffer', (event, request: TerminalBufferRequest) =>
    sessionServiceForWebContents(event.sender).readTerminalBuffer(request),
  );
  ipcMain.handle('sessions:archiveHistory', (event, request: SessionHistoryArchiveRequest) =>
    sessionServiceForWebContents(event.sender).archiveSessionHistory(request),
  );
  ipcMain.handle('sessions:contextPressure', (event, request: SessionContextPressureRequest) =>
    sessionServiceForWebContents(event.sender).getContextPressure(request),
  );
  ipcMain.handle('sessions:summarize', (event, request: SessionSummaryRequest) =>
    sessionServiceForWebContents(event.sender).summarizeSession(request),
  );
  ipcMain.handle('workspaceContext:read', async (_event, request: WorkspaceContextReadRequest) => {
    const workspace = await requireWorkspaceForContext(
      request.workspaceId,
      '所选工作区不存在，无法读取共享上下文',
    );
    return workspaceContextStore.readSharedContext(workspace);
  });
  ipcMain.handle(
    'workspaceContext:openFolder',
    async (_event, request: WorkspaceContextOpenRequest) => {
      const workspace = await requireWorkspaceForContext(
        request.workspaceId,
        '所选工作区不存在，无法打开共享上下文目录',
      );
      const openError = await shell.openPath(path.join(workspace.path, '.agentdock/context'));
      if (openError) {
        throw new Error('无法打开共享上下文目录');
      }
    },
  );
  ipcMain.handle('sessions:launch', async (event, request: LaunchRequest) => {
    const profiles = await listProfiles();
    const profile = profiles.find((item) => item.id === request.profileId);
    const workspaces = await listWorkspaces();
    const workspace = workspaces.find((item) => item.id === request.workspaceId);

    if (!profile || !workspace) {
      throw new Error('所选配置或工作区不存在，无法启动会话');
    }

    return sessionServiceForWebContents(event.sender).launch({
      profile,
      workspace,
      command: request.command,
      claudeLaunchMode: request.claudeLaunchMode,
    });
  });
  ipcMain.handle('sessions:restart', async (event, request: RestartSessionRequest) => {
    const service = sessionServiceForWebContents(event.sender);
    const session = (await service.list()).find((item) => item.id === request.sessionId);

    if (!session) {
      throw new Error('未找到指定的终端会话');
    }

    const profiles = await listProfiles();
    const profile = profiles.find((item) => item.id === session.profileId);
    const workspaces = await listWorkspaces();
    const workspace = workspaces.find((item) => item.id === session.workspaceId);

    if (!profile || !workspace) {
      throw new Error('所选配置或工作区不存在，无法重启会话');
    }

    return service.restart({
      sessionId: request.sessionId,
      profile,
      workspace,
      command: request.command ?? session.command,
      claudeLaunchMode: request.claudeLaunchMode,
    });
  });
  ipcMain.handle('windows:new', () => {
    createMainWindow({ restoreHistory: false });
  });
}

function createMainWindow({
  restoreHistory = BrowserWindow.getAllWindows().length === 0,
}: {
  restoreHistory?: boolean;
} = {}): BrowserWindow {
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

  windowRestoreHistory.set(window.webContents.id, restoreHistory);
  const windowSessionService = sessionRegistry.getOrCreate(window.webContents.id);
  const webContentsId = window.webContents.id;
  const unsubscribeTerminalOutput = windowSessionService.onTerminalOutput((event) => {
    if (!window.isDestroyed()) {
      window.webContents.send('terminal:output', event);
    }
  });
  const unsubscribeSessionChanged = windowSessionService.onSessionChanged((session) => {
    if (!window.isDestroyed()) {
      window.webContents.send('session:changed', session);
    }
  });
  window.on('closed', () => {
    windowRestoreHistory.delete(webContentsId);
    unsubscribeTerminalOutput();
    unsubscribeSessionChanged();
    void sessionRegistry.delete(webContentsId);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  hardenWebContents(window.webContents, devServerUrl);
  installEditContextMenu(window.webContents);
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
    return window;
  }

  void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

function installApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: 'File',
      submenu: [
        {
          label: '新窗口',
          accelerator: 'CommandOrControl+N',
          click: () => {
            createMainWindow({ restoreHistory: false });
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    installApplicationMenu();
    createMainWindow({ restoreHistory: true });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({ restoreHistory: true });
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
