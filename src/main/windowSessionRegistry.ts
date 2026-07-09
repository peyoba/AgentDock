import type { SessionService } from './sessionService.js';

export type WindowSessionRegistry = {
  getOrCreate(windowId: number): SessionService;
  delete(windowId: number): Promise<void>;
  disposeAll(): Promise<void>;
};

export function createWindowSessionRegistry(
  createService: (windowId: number) => SessionService,
): WindowSessionRegistry {
  const services = new Map<number, SessionService>();

  return {
    getOrCreate(windowId: number): SessionService {
      const existing = services.get(windowId);
      if (existing) {
        return existing;
      }

      const service = createService(windowId);
      services.set(windowId, service);
      return service;
    },

    async delete(windowId: number): Promise<void> {
      const service = services.get(windowId);
      services.delete(windowId);
      await service?.dispose();
    },

    async disposeAll(): Promise<void> {
      const remaining = [...services.values()];
      services.clear();
      await Promise.all(remaining.map((service) => service.dispose().catch(() => undefined)));
    },
  };
}
