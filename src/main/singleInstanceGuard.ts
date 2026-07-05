type SingleInstanceApp = {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): void;
};

type FocusableWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
};

export function installSingleInstanceGuard({
  app,
  getAllWindows,
  openWindow,
}: {
  app: SingleInstanceApp;
  getAllWindows(): FocusableWindow[];
  openWindow?(): void;
}): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const existingWindow = getAllWindows().find((window) => !window.isDestroyed());
    if (!existingWindow) {
      openWindow?.();
      return;
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.focus();
  });

  return true;
}
