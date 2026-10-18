const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

/**
 * electron-builder silently drops node_modules from extraResources copies,
 * and the Next standalone server cannot run without its runtime. This hook
 * places the staged next-server into resources/ with a plain filesystem
 * copy — no glob engine, no filtering, nothing to lose.
 */
exports.afterPack = (context) => {
  const projectDir = context.packager?.info?.projectDir ?? process.cwd();
  const source = path.join(projectDir, "desktop-build", "next-server");
  if (!existsSync(path.join(source, "server.js"))) {
    throw new Error("desktop-build/next-server is missing — run `bun run build:desktop` first.");
  }
  const target = path.join(context.appOutDir, "resources", "next-server");
  cpSync(source, target, { recursive: true });
  console.log(`• afterPack: copied next-server into ${path.relative(projectDir, target)}`);
};
