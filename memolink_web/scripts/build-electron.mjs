/**
 * Production build script for the Electron app.
 * Step 1: Vite builds the React renderer into dist/
 * Step 2: esbuild compiles electron/main.ts + preload.ts into dist-electron/
 *
 * Uses the same esbuild config as dev-electron.mjs so output extensions
 * match (both produce .mjs files) and electron-updater stays external.
 */
import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 1. Build the React renderer with relative asset paths for file:// protocol
await viteBuild({ root, configFile: path.join(root, "vite.config.ts"), base: "./" });
console.log("\n  Renderer built.");

// 2. Compile Electron main + preload (same config as dev-electron.mjs)
await esbuild({
  entryPoints: [
    path.join(root, "electron/main.ts"),
    path.join(root, "electron/preload.ts"),
  ],
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["electron", "electron-updater"],
  outdir: path.join(root, "dist-electron"),
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
});
console.log("  Electron main + preload compiled.\n");
