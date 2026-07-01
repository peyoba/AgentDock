import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalOutputEvent } from '../shared/agentdockTypes.js';
import type { AgentDockApi } from '../shared/preloadTypes.js';

function isTerminalOutputEvent(value: unknown): value is TerminalOutputEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TerminalOutputEvent>;
  return typeof candidate.sessionId === 'string' && typeof candidate.data === 'string';
}

const api: AgentDockApi = {
  version: '0.1.0',
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  launchSession: (request) => ipcRenderer.invoke('sessions:launch', request),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  writeTerminal: (request) => ipcRenderer.invoke('terminal:write', request),
  resizeTerminal: (request) => ipcRenderer.invoke('terminal:resize', request),
  killTerminal: (request) => ipcRenderer.invoke('terminal:kill', request),
  onTerminalOutput: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (isTerminalOutputEvent(payload)) {
        listener(payload);
      }
    };

    ipcRenderer.on('terminal:output', handler);
    return () => ipcRenderer.off('terminal:output', handler);
  },
};

contextBridge.exposeInMainWorld('agentDock', api);
