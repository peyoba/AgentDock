import type { AgentDockApi } from '../../shared/preloadTypes';

declare global {
  interface Window {
    agentDock: AgentDockApi;
  }
}

export {};
