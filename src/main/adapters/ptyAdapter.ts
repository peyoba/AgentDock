export type PtySpawnRequest = {
  sessionId: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
};

export type PtySession = {
  id: string;
  write(input: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

export type PtyAdapter = {
  spawn(request: PtySpawnRequest): Promise<PtySession>;
};

export function createUnavailablePtyAdapter(): PtyAdapter {
  return {
    async spawn(): Promise<PtySession> {
      throw new Error('PTY adapter is not available in Phase 1');
    },
  };
}
