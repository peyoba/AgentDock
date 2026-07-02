import { app, BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeytarAdapter } from './adapters/keychainAdapter.js';
import { createNodePtyAdapter } from './adapters/ptyAdapter.js';
import { createSessionService } from './sessionService.js';
import type {
  ApiProfile,
  LaunchRequest,
  TerminalKillRequest,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
} from '../shared/agentdockTypes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionService = createSessionService({
  keychain: createKeytarAdapter(),
  pty: createNodePtyAdapter(),
  appDataPath: app.getPath('userData'),
  workspaceExists: fs.existsSync,
});

const sampleProfiles: ApiProfile[] = [
  {
    id: 'claude-anyrouter',
    name: 'Claude · AnyRouter A',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.example.com/v1',
    defaultModel: 'sonnet-4',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-anyrouter',
  },
  {
    id: 'codex-openai',
    name: 'Codex · OpenAI',
    toolType: 'codex',
    baseUrl: 'https://api.openai.example.com/v1',
    defaultModel: 'gpt-5-codex',
    keychainService: 'AgentDock',
    keychainAccount: 'codex-openai',
    codexHome: '~/.agentdock/codex-profiles/codex-openai',
  },
];

const sampleWorkspaces: Workspace[] = [
  {
    id: 'agentdock',
    name: 'AgentDock',
    path: '/Users/peyoba/Desktop/web/AgentDock',
  },
];

function registerIpcHandlers(): void {
  ipcMain.handle('profiles:list', () => sampleProfiles);
  ipcMain.handle('workspaces:list', () => sampleWorkspaces);
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
  ipcMain.handle('sessions:launch', async (_event, request: LaunchRequest) => {
    const profile = sampleProfiles.find((item) => item.id === request.profileId);
    const workspace = sampleWorkspaces.find((item) => item.id === request.workspaceId);

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
    minWidth: 980,
    minHeight: 680,
    title: 'AgentDock 代理坞',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
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
