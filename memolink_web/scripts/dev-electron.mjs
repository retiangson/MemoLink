/**
 * Dev launcher: starts the Vite dev server, compiles Electron
 * main/preload with esbuild (Node.js target), then spawns Electron.
 */
import { createServer } from "vite";
import { build } from "esbuild";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 1. Start Vite dev server (browser renderer)
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
});
await server.listen();
const devUrl = server.resolvedUrls.local[0];
console.log(`\n  Vite dev server: ${devUrl}`);

// 2. Compile electron/main.ts + electron/preload.ts for Node.js
await build({
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
  logLevel: "warning",
});
console.log("  Electron main + preload compiled.\n");

// 3. Spawn Electron
// On Windows, use the actual .exe; on POSIX use the .bin symlink
const electronBin =
  process.platform === "win32"
    ? path.join(root, "node_modules", "electron", "dist", "electron.exe")
    : path.join(root, "node_modules", ".bin", "electron");

const proc = spawn(electronBin, [root], {
  env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  stdio: "inherit",
  shell: false,
});

proc.on("close", (code) => {
  server.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  proc.kill();
  server.close();
  process.exit(0);
});
