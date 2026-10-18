/**
 * Full desktop build:
 *   1. next build (produces .next/standalone with output: "standalone")
 *   2. stage a clean next-server into desktop-build/:
 *      server.js, package.json, node_modules, .next (+ static), public —
 *      nothing else. The raw standalone output contains traced extras
 *      (src/, electron/, even the dev data/) that must not ship.
 *   3. compile the Electron shell (dist-electron/main.js + preload.js)
 *   4. generate the app icon if missing
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

function run(cmd, args, label) {
  console.log(`• ${label}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: isWindows, env: process.env });
  if (result.status !== 0) {
    console.error(`✗ ${label} failed`);
    process.exit(1);
  }
}

function countFiles(dir) {
  let count = 0;
  const walk = (entry) => {
    for (const item of readdirSync(entry)) {
      const full = path.join(entry, item);
      if (statSync(full).isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(dir);
  return count;
}

run("bun", ["run", "build"], "building Next.js (standalone output)");

const standalone = path.join(".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("✗ .next/standalone/server.js is missing — is output: 'standalone' set?");
  process.exit(1);
}

console.log("• staging a clean next-server into desktop-build/");
const staging = path.join("desktop-build", "next-server");
rmSync("desktop-build", { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

cpSync(path.join(standalone, "server.js"), path.join(staging, "server.js"));
cpSync(path.join(standalone, "package.json"), path.join(staging, "package.json"));
cpSync(path.join(standalone, "node_modules"), path.join(staging, "node_modules"), {
  recursive: true,
});
cpSync(path.join(standalone, ".next"), path.join(staging, ".next"), { recursive: true });
cpSync(path.join(".next", "static"), path.join(staging, ".next", "static"), {
  recursive: true,
});
mkdirSync(path.join(staging, "public"), { recursive: true });
if (existsSync("public")) {
  cpSync("public", path.join(staging, "public"), { recursive: true });
}

const stagedFiles = countFiles(staging);
console.log(`  staged ${stagedFiles} files`);
if (!existsSync(path.join(staging, "node_modules", "next", "package.json"))) {
  console.error("✗ staged node_modules is missing the next runtime — refusing to package");
  process.exit(1);
}

run("bun", ["run", "build:electron"], "compiling the Electron shell");

if (!existsSync(path.join("build", "icon.ico"))) {
  run("node", ["scripts/make-icon.mjs"], "generating the app icon");
}

console.log("✓ desktop build ready — desktop-build/ + dist-electron/");
