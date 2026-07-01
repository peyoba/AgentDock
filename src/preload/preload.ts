import { contextBridge, ipcRenderer } from 'electron';
import type { AgentDockApi } from '../shared/preloadTypes.js';

const api: AgentDockApi = {
  version: '0.1.0',
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  launchSession: (request) => ipcRenderer.invoke('sessions:launch', request),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
};

contextBridge.exposeInMainWorld('agentDock', api);
