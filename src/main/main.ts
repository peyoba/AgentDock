import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeytarAdapter } from './adapters/keychainAdapter.js';
import { createNodePtyAdapter } from './adapters/ptyAdapter.js';
import { createSessionService } from './sessionService.js';
import { createProfileStore } from './stores/profileStore.js';
import { createWorkspaceStore } from './stores/workspaceStore.js';
import { createWorkspaceFromPath, mergeWorkspaces } from './workspaceService.js';
import type {
  ApiProfile,
  LaunchRequest,
  ProfileSecretSaveRequest,
  TerminalBufferRequest,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
} from '../shared/agentdockTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileStore = createProfileStore(app.getPath('userData'));
const workspaceStore = createWorkspaceStore(app.getPath('userData'));
const keychainAdapter = createKeytarAdapter();
const sessionService = createSessionService({
  keychain: keychainAdapter,
  pty: createNodePtyAdapter(),
  appDataPath: app.getPath('userData'),
  workspaceExists: fs.existsSync,
});

const defaultProfiles: ApiProfile[] = [
  {
    id: 'claude-anyrouter',
    name: 'Claude · AnyRouter A',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.top',
    defaultModel: 'claude-3-5-haiku-20241022',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-anyrouter',
  },
  {
    id: 'codex-openai',
    name: 'Codex · AnyRouter',
    toolType: 'codex',
    baseUrl: 'https://anyrouter.top/v1',
    defaultModel: 'gpt-5-codex',
    keychainService: 'AgentDock',
    keychainAccount: 'codex-openai',
    codexHome: '~/.agentdock/codex-profiles/codex-openai',
  },
];

const defaultWorkspaces: Workspace[] = [
  {
    id: 'agentdock',
    name: 'AgentDock',
    path: '/Users/peyoba/Desktop/web/AgentDock',
  },
];

function sanitizeProfile(profile: ApiProfile): ApiProfile {
  return {
    id: profile.id,
    name: profile.name,
    toolType: profile.toolType,
    baseUrl: profile.baseUrl,
    defaultModel: profile.defaultModel || undefined,
    keychainService: profile.keychainService,
    keychainAccount: profile.keychainAccount,
    codexHome: profile.codexHome || undefined,
  };
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

function registerIpcHandlers(): void {
  ipcMain.handle('profiles:list', () => listProfiles());
  ipcMain.handle('profiles:save', (_event, profile: ApiProfile) => saveProfile(profile));
  ipcMain.handle('profiles:saveSecret', async (_event, request: ProfileSecretSaveRequest) => {
    await keychainAdapter.writeSecret(
      request.keychainService,
      request.keychainAccount,
      request.secret,
    );
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
      throw new Error('Cannot launch session because profile or workspace was not found');
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
    titleBarStyle: 'hiddenInset',
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
