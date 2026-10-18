/**
 * Dev loop for the desktop shell:
 *   1. compile electron/main.ts + preload.ts (tsc, no bundler)
 *   2. start `next dev` on :3000
 *   3. launch Electron pointing at it (TICKY_ELECTRON_DEV=1)
 * Ctrl+C or closing Electron tears everything down.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const isWindows = process.platform === "win32";
const electronBin = isWindows
  ? path.join("node_modules", "electron", "dist", "electron.exe")
  : path.join("node_modules", ".bin", "electron");

if (!existsSync(electronBin)) {
  console.error("Electron binary not found. Run: bun install");
  process.exit(1);
}

console.log("• compiling electron main/preload…");
const compiled = spawnSync("bun", ["x", "tsc", "-p", "electron/tsconfig.json"], {
  stdio: "inherit",
});
if (compiled.status !== 0) {
  console.error("Electron TypeScript build failed.");
  process.exit(1);
}

async function waitForDevServer(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dev server did not answer at ${url}`);
}

const devServer = spawn("bun", ["run", "dev"], {
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
});

const shutdown = () => {
  if (devServer.exitCode === null) devServer.kill();
};
process.on("exit", shutdown);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

try {
  await waitForDevServer("http://localhost:3000");
} catch (error) {
  console.error(String(error));
  devServer.kill();
  process.exit(1);
}

console.log("• launching electron…");
const electronApp = spawn(electronBin, [path.join("dist-electron", "main.js")], {
  stdio: "inherit",
  env: { ...process.env, TICKY_ELECTRON_DEV: "1" },
});

electronApp.on("exit", () => {
  shutdown();
  process.exit(0);
});
devServer.on("exit", () => {
  if (electronApp.exitCode === null) electronApp.kill();
  process.exit(0);
});
