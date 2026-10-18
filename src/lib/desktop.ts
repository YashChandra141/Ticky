/**
 * The renderer's typed view of the desktop bridge exposed by the Electron
 * preload script. In a plain browser (web build / Render demo) there is no
 * bridge and callers fall back to normal links and HTTP.
 */
export type DesktopBridge = {
  version(): Promise<string>;
  /** Fetches a local-server PDF and shows a native save dialog. */
  savePdf(sourcePath: string, suggestedName: string): Promise<SaveResult>;
  saveCsv(sourcePath: string, suggestedName: string): Promise<SaveResult>;
  revealFile(path: string): Promise<void>;
  /** Runs the server-side VACUUM backup and returns the new file. */
  backupNow(): Promise<{ file: string; path: string }>;
  /** Opens a native file picker, then asks the server to restore that backup. */
  restoreBackup(): Promise<{ restored: boolean; error?: string }>;
};

export type SaveResult = { saved: boolean; path?: string; error?: string };

declare global {
  interface Window {
    ticky?: DesktopBridge;
  }
}

export function getDesktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.ticky ?? null;
}

/** True when running inside the Ticky desktop app. */
export function isDesktop(): boolean {
  return getDesktop() !== null;
}
