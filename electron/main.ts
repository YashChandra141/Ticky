import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

/**
 * Ticky desktop shell. The renderer is sandboxed and talks to the app over
 * HTTP only; native work (save dialogs, file reveal, backup orchestration)
 * goes through the small allow-listed IPC surface in preload.ts.
 */

const isDev = process.env.TICKY_ELECTRON_DEV === "1";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverOrigin = "";

// ---------- Next server lifecycle ----------

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The server did not answer at ${url} within ${timeoutMs / 1000}s.`);
}

/** Spawns the Next standalone server on a local port (env PORT overrides, for smoke tests). */
async function startNextServer(): Promise<string> {
  const port = process.env.PORT ? Number(process.env.PORT) : await findFreePort();
  const serverJs = app.isPackaged
    ? path.join(process.resourcesPath, "next-server", "server.js")
    : path.join(app.getAppPath(), ".next", "standalone", "server.js");

  if (!existsSync(serverJs)) {
    throw new Error(
      `Next standalone server not found at ${serverJs}.\n` +
        `Build it first: bun run build (with output: "standalone" in next.config.ts).`,
    );
  }

  serverProcess = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      TICKY_DATA_DIR: process.env.TICKY_DATA_DIR || path.join(app.getPath("userData"), "data"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[next] ${text}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[next] ${text}`);
  });
  serverProcess.on("exit", (code) => {
    console.error(`[next] server exited with code ${code}`);
    serverProcess = null;
  });

  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(`${origin}/api/ai/models`, 30_000);
  return origin;
}

// ---------- window ----------

function isLocalUrl(raw: string): boolean {
  if (!serverOrigin) return false;
  try {
    return new URL(raw).origin === serverOrigin;
  } catch {
    return false;
  }
}

function createWindow(): void {
  if (!serverOrigin) return;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "Ticky",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Never navigate the window away from the local app server.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isLocalUrl(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  // No new windows, ever. External links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !isLocalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(serverOrigin);
}

// ---------- IPC surface ----------
// preload.ts is the only bridge; every handler validates the sender origin
// and its arguments with zod before touching anything native.

function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  try {
    return new URL(frame.url).origin === serverOrigin;
  } catch {
    return false;
  }
}

// Hand-rolled argument validation (no runtime dependencies — the packaged
// app ships zero node_modules; the Next server arrives via extraResources).

type SaveArgs = { sourcePath: string; suggestedName: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A local API path only — never an absolute URL, never traversal. */
function isApiPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > "/api/".length &&
    value.length <= 512 &&
    value.startsWith("/api/") &&
    !value.includes("://") &&
    !value.includes("..")
  );
}

function isSafeFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[\w\-. ()]+$/.test(value)
  );
}

function parseSaveArgs(raw: unknown): SaveArgs | null {
  if (!isPlainObject(raw)) return null;
  if (!isApiPath(raw.sourcePath) || !isSafeFileName(raw.suggestedName)) return null;
  return { sourcePath: raw.sourcePath, suggestedName: raw.suggestedName };
}

function parseExistingFilePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 600) return null;
  if (raw.includes("://") || raw.includes("..")) return null;
  return raw;
}

type SaveResult = { saved: boolean; path?: string; error?: string };

async function saveFromServer(
  event: Electron.IpcMainInvokeEvent,
  raw: unknown,
  filters: Electron.FileFilter[],
): Promise<SaveResult> {
  if (!isTrustedSender(event)) return { saved: false, error: "Untrusted request." };
  const parsed = parseSaveArgs(raw);
  if (!parsed) return { saved: false, error: "Invalid request." };
  try {
    const response = await fetch(new URL(parsed.sourcePath, serverOrigin));
    if (!response.ok) return { saved: false, error: `The server returned HTTP ${response.status}.` };
    const bytes = Buffer.from(await response.arrayBuffer());
    const dialogResult = await dialog.showSaveDialog({
      defaultPath: parsed.suggestedName,
      filters,
    });
    if (dialogResult.canceled || !dialogResult.filePath) return { saved: false };
    await writeFile(dialogResult.filePath, bytes);
    return { saved: true, path: dialogResult.filePath };
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : "Saving failed." };
  }
}

function registerIpc(): void {
  ipcMain.handle("ticky:version", () => app.getVersion());

  ipcMain.handle("ticky:savePdf", (event, raw) =>
    saveFromServer(event, raw, [{ name: "PDF document", extensions: ["pdf"] }]),
  );

  ipcMain.handle("ticky:saveCsv", (event, raw) =>
    saveFromServer(event, raw, [{ name: "CSV file", extensions: ["csv"] }]),
  );

  ipcMain.handle("ticky:revealFile", async (event, raw): Promise<{ ok: boolean; error?: string }> => {
    if (!isTrustedSender(event)) return { ok: false, error: "Untrusted request." };
    const filePath = parseExistingFilePath(raw);
    if (!filePath || !existsSync(filePath)) return { ok: false, error: "File not found." };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle(
    "ticky:backupNow",
    async (event): Promise<{ file?: string; path?: string; error?: string }> => {
      if (!isTrustedSender(event)) return { error: "Untrusted request." };
      try {
        const response = await fetch(new URL("/api/backup", serverOrigin), { method: "POST" });
        const data = (await response.json()) as { file?: string; path?: string; error?: string };
        if (!response.ok) return { error: data.error ?? "Backup failed." };
        return data;
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Backup failed." };
      }
    },
  );

  ipcMain.handle(
    "ticky:restoreBackup",
    async (event): Promise<{ restored: boolean; error?: string }> => {
      if (!isTrustedSender(event)) return { restored: false, error: "Untrusted request." };
      try {
        const dialogResult = await dialog.showOpenDialog({
          title: "Choose a Ticky backup to restore",
          properties: ["openFile"],
          filters: [{ name: "Ticky backup", extensions: ["db"] }],
        });
        if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
          return { restored: false };
        }
        const response = await fetch(new URL("/api/backup/restore", serverOrigin), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: dialogResult.filePaths[0] }),
        });
        const data = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !data.ok) {
          return { restored: false, error: data.error ?? "Restoring failed." };
        }
        return { restored: true };
      } catch (error) {
        return { restored: false, error: error instanceof Error ? error.message : "Restoring failed." };
      }
    },
  );
}

// ---------- app lifecycle ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // In dev the HMR websocket needs a looser CSP; production locks down.
    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data:",
                "font-src 'self' data:",
                "connect-src 'self'",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                "frame-ancestors 'none'",
              ].join("; "),
            ],
          },
        });
      });
    }

    try {
      serverOrigin = isDev ? "http://localhost:3000" : await startNextServer();
    } catch (error) {
      dialog.showErrorBox(
        "Ticky",
        error instanceof Error ? error.message : "The app server could not start.",
      );
      app.quit();
      return;
    }

    registerIpc();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  const stopServer = () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  };
  app.on("before-quit", stopServer);
  app.on("quit", stopServer);
  process.on("exit", stopServer);
}
