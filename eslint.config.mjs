import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ticky build output (compiled Electron shell) and scripts:
    "dist-electron/**",
    "scripts/**",
    "electron-builder.config.js",
    // Staged Next standalone server for packaging:
    "desktop-build/**",
  ]),
]);

export default eslintConfig;
