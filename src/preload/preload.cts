import { contextBridge, ipcRenderer } from 'electron';
import type { AgentSession, TerminalOutputEvent } from '../shared/agentdockTypes.js';
import type { AgentDockApi } from '../shared/preloadTypes.js';

function isTerminalOutputEvent(value: unknown): value is TerminalOutputEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TerminalOutputEvent>;
  return typeof candidate.sessionId === 'string' && typeof candidate.data === 'string';
}

function isAgentSession(value: unknown): value is AgentSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AgentSession>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.profileId === 'string' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.command === 'string' &&
    typeof candidate.status === 'string'
  );
}

const api: AgentDockApi = {
  version: '0.1.0',
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  chooseWorkspace: () => ipcRenderer.invoke('workspaces:choose'),
  saveProfile: (profile) => ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: (profileId) => ipcRenderer.invoke('profiles:delete', { profileId }),
  saveProfileSecret: (request) => ipcRenderer.invoke('profiles:saveSecret', request),
  readProfileSecret: (request) => ipcRenderer.invoke('profiles:readSecret', request),
  fetchProfileModels: (request) => ipcRenderer.invoke('profiles:fetchModels', request),
  launchSession: (request) => ipcRenderer.invoke('sessions:launch', request),
  restartSession: (request) => ipcRenderer.invoke('sessions:restart', request),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  closeSessionView: (request) => ipcRenderer.invoke('sessions:closeView', request),
  archiveSessionRecord: (request) => ipcRenderer.invoke('sessions:archiveRecord', request),
  deleteSessionRecord: (request) => ipcRenderer.invoke('sessions:deleteRecord', request),
  writeTerminal: (request) => ipcRenderer.invoke('terminal:write', request),
  resizeTerminal: (request) => ipcRenderer.invoke('terminal:resize', request),
  killTerminal: (request) => ipcRenderer.invoke('terminal:kill', request),
  readTerminalBuffer: (request) => ipcRenderer.invoke('terminal:buffer', request),
  archiveSessionHistory: (request) => ipcRenderer.invoke('sessions:archiveHistory', request),
  getSessionContextPressure: (request) => ipcRenderer.invoke('sessions:contextPressure', request),
  summarizeSession: (request) => ipcRenderer.invoke('sessions:summarize', request),
  onTerminalOutput: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (isTerminalOutputEvent(payload)) {
        listener(payload);
      }
    };

    ipcRenderer.on('terminal:output', handler);
    return () => ipcRenderer.off('terminal:output', handler);
  },
  onSessionChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (isAgentSession(payload)) {
        listener(payload);
      }
    };

    ipcRenderer.on('session:changed', handler);
    return () => ipcRenderer.off('session:changed', handler);
  },
  readWorkspaceContext: (request) => ipcRenderer.invoke('workspaceContext:read', request),
  openWorkspaceContextFolder: (request) =>
    ipcRenderer.invoke('workspaceContext:openFolder', request),
  openNewWindow: () => ipcRenderer.invoke('windows:new'),
  onMetadataChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('metadata:changed', handler);
    return () => ipcRenderer.off('metadata:changed', handler);
  },
};

contextBridge.exposeInMainWorld('agentDock', api);
