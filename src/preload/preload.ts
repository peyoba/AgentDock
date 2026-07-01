import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('agentDock', {
  version: '0.1.0',
});
