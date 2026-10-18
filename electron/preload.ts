import { contextBridge, ipcRenderer } from "electron";

/**
 * The whole IPC surface: one `invoke` per allow-listed channel. No arbitrary
 * channel forwarding, no objects, no node access — validation and sender
 * checks happen in main.
 */
const bridge = {
  version: () => ipcRenderer.invoke("ticky:version") as Promise<string>,
  savePdf: (sourcePath: string, suggestedName: string) =>
    ipcRenderer.invoke("ticky:savePdf", { sourcePath, suggestedName }) as Promise<{
      saved: boolean;
      path?: string;
      error?: string;
    }>,
  saveCsv: (sourcePath: string, suggestedName: string) =>
    ipcRenderer.invoke("ticky:saveCsv", { sourcePath, suggestedName }) as Promise<{
      saved: boolean;
      path?: string;
      error?: string;
    }>,
  revealFile: (path: string) =>
    ipcRenderer.invoke("ticky:revealFile", path) as Promise<{ ok: boolean; error?: string }>,
  backupNow: () =>
    ipcRenderer.invoke("ticky:backupNow") as Promise<{ file?: string; path?: string; error?: string }>,
  restoreBackup: () =>
    ipcRenderer.invoke("ticky:restoreBackup") as Promise<{ restored: boolean; error?: string }>,
};

contextBridge.exposeInMainWorld("ticky", bridge);
