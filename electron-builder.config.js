/**
 * electron-builder config (JS because the afterPack hook needs a JS config).
 * The Next standalone server is attached in scripts/builder-hooks.cjs.
 */
module.exports = {
  appId: "app.ticky.desktop",
  productName: "Ticky",
  directories: {
    output: "dist-electron",
    buildResources: "build",
  },
  // The shell has zero runtime dependencies: only the compiled main +
  // preload ship inside the app. The Next server arrives via afterPack.
  files: ["dist-electron/main.js", "dist-electron/preload.js", "!node_modules/**"],
  asar: true,
  win: {
    target: ["nsis"],
    icon: "build/icon.ico",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    artifactName: "Ticky-Setup-${version}.${ext}",
  },
  afterPack: require("./scripts/builder-hooks.cjs").afterPack,
};
