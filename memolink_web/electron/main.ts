import { app, BrowserWindow, ipcMain, dialog, shell, desktopCapturer, session } from "electron";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import { exec, spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Persistent error log ──────────────────────────────────────────────────────
// Packaged builds have no visible console, so every error that would otherwise
// be swallowed by a fire-and-forget .catch(() => {}) is appended here instead.
function logToFile(message: string) {
  console.error(message);
  try {
    const logPath = path.join(app.getPath("userData"), "memolink.log");
    fs.appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`).catch(() => {});
  } catch { /* app.getPath unavailable before "ready" — console.error above still ran */ }
}

function resolveUserPath(input: string): string {
  if (!input) return input;
  const home = os.homedir();
  let resolved = input.replace(/^~(?=$|[\\/])/, home);
  resolved = resolved.replace(/%USERPROFILE%/gi, home);
  resolved = resolved.replace(/%HOME%/gi, home);
  return path.normalize(resolved);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "MemoLink",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Hide the native menu bar on Windows/Linux
  win.setMenuBarVisibility(false);

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.OPEN_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

// ── Save file with native OS Save-As dialog ───────────────────────────────────
ipcMain.handle(
  "memolink:save-file",
  async (_, { filename, content, binary }: { filename: string; content?: string; binary?: number[] }) => {
    const ext = path.extname(filename).replace(".", "") || "txt";
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: [
        { name: "Current format", extensions: [ext] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (canceled || !filePath) return { success: false };

    try {
      if (binary) {
        await fs.writeFile(filePath, Buffer.from(binary));
      } else {
        await fs.writeFile(filePath, content ?? "", "utf-8");
      }
      return { success: true, filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
);

// ── Open a saved file with the OS default app ─────────────────────────────────
ipcMain.handle("memolink:open-path", async (_, filePath: string) => {
  const err = await shell.openPath(resolveUserPath(filePath));
  return { success: !err, error: err || undefined };
});

// ── Create directory ─────────────────────────────────────────────────────────
ipcMain.handle("memolink:mkdir", async (_, dirPath: string) => {
  try {
    const resolvedPath = resolveUserPath(dirPath);
    await fs.mkdir(resolvedPath, { recursive: true });
    return { success: true, path: resolvedPath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── Write / create a file ─────────────────────────────────────────────────────
ipcMain.handle("memolink:write-file", async (_, { filePath, content }: { filePath: string; content: string }) => {
  try {
    const resolvedPath = resolveUserPath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, "utf-8");
    return { success: true, path: resolvedPath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── Read a file ───────────────────────────────────────────────────────────────
ipcMain.handle("memolink:read-file", async (_, filePath: string) => {
  try {
    const content = await fs.readFile(resolveUserPath(filePath), "utf-8");
    return { success: true, content };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── List directory contents ───────────────────────────────────────────────────
ipcMain.handle("memolink:list-dir", async (_, dirPath: string) => {
  try {
    const entries = await fs.readdir(resolveUserPath(dirPath), { withFileTypes: true });
    return {
      success: true,
      entries: entries.map((e) => ({ name: e.name, isDir: e.isDirectory() })),
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── Delete a file or folder ───────────────────────────────────────────────────
ipcMain.handle("memolink:delete", async (_, targetPath: string) => {
  try {
    await fs.rm(resolveUserPath(targetPath), { recursive: true, force: true });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// ── Execute shell command ─────────────────────────────────────────────────────
ipcMain.handle("memolink:exec", async (_, { command, cwd }: { command: string; cwd?: string }) => {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd ?? os.homedir(),
      timeout: 60_000,
      windowsHide: true,
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    return {
      success: false,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? err.message).trim(),
    };
  }
});

// ── App info ──────────────────────────────────────────────────────────────────
ipcMain.handle("memolink:get-info", () => ({
  version: app.getVersion(),
  platform: process.platform,
}));

// ── WhatsApp Bridge (local Node.js subprocess) ────────────────────────────────

const WA_PORT = 3797;
let waBridgeProc: ChildProcess | null = null;

function findNodeBin(): string | null {
  // Bundled node.exe (packaged installer) — no system Node.js required
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "node.exe");
    if (existsSync(bundled)) return bundled;
  }
  // Fall back to system Node.js
  try {
    const result = process.platform === "win32"
      ? execSync("where node", { timeout: 3000 }).toString().split("\n")[0].trim()
      : execSync("which node", { timeout: 3000 }).toString().trim();
    if (result) return result;
  } catch { /* fall through to hardcoded paths */ }
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files (x86)\\nodejs\\node.exe"]
    : ["/usr/local/bin/node", "/usr/bin/node"];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function waBridgePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "whatsapp_bridge", "bridge.js")
    : path.join(__dirname, "../../memolink_backend/whatsapp_bridge/bridge.js");
}

ipcMain.handle("memolink:wa-start", async () => {
  if (waBridgeProc && waBridgeProc.exitCode === null) return { started: false };
  const node = findNodeBin();
  if (!node) return { error: "Node.js not found. Please install Node.js 20+." };
  const sessionDir = path.join(os.homedir(), ".memolink", "whatsapp", "session");
  await fs.mkdir(sessionDir, { recursive: true });
  waBridgeProc = spawn(node, [waBridgePath(), "--port", String(WA_PORT), "--session", sessionDir], {
    stdio: "ignore",
    detached: false,
  });
  return { started: true };
});

ipcMain.handle("memolink:wa-stop", async () => {
  if (waBridgeProc) { waBridgeProc.kill(); waBridgeProc = null; }
  return { stopped: true };
});

ipcMain.handle("memolink:wa-reset", async () => {
  if (waBridgeProc) { waBridgeProc.kill(); waBridgeProc = null; }
  const sessionDir = path.join(os.homedir(), ".memolink", "whatsapp");
  try { await fs.rm(sessionDir, { recursive: true, force: true }); } catch { }
  return { reset: true };
});

ipcMain.handle("memolink:wa-proxy", async (_, { method, path: reqPath, body, params }: {
  method: string; path: string; body?: Record<string, unknown>; params?: Record<string, string>;
}) => {
  return new Promise((resolve) => {
    try {
      const url = new URL(`http://127.0.0.1:${WA_PORT}${reqPath}`);
      if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
      const bodyStr = body ? JSON.stringify(body) : undefined;
      const req = http.request(url, {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json", ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}) },
      }, (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          try { resolve({ ok: true, data: JSON.parse(raw) }); }
          catch { resolve({ ok: true, data: raw }); }
        });
      });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      if (bodyStr) req.write(bodyStr);
      req.end();
    } catch (e: any) {
      resolve({ ok: false, error: e.message });
    }
  });
});

// ── Remote Desktop Bridge ─────────────────────────────────────────────────────
// Connects to the backend SSE stream and executes commands sent from web/mobile.

let bridgeHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let bridgePollTimer: ReturnType<typeof setInterval> | null = null;

async function executeRemoteCommand(commandType: string, payload: any): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    switch (commandType) {
      case "mkdir": {
        const targetPath = resolveUserPath(payload.path);
        await fs.mkdir(targetPath, { recursive: true });
        return { ok: true, output: `Folder created: ${targetPath}` };
      }
      case "write-file": {
        const targetPath = resolveUserPath(payload.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, payload.content ?? "", "utf-8");
        return { ok: true, output: `File created: ${targetPath}` };
      }
      case "read-file": {
        const content = await fs.readFile(resolveUserPath(payload.path), "utf-8");
        return { ok: true, output: content };
      }
      case "list-dir": {
        const entries = await fs.readdir(resolveUserPath(payload.path), { withFileTypes: true });
        const list = entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n");
        return { ok: true, output: list || "(empty)" };
      }
      case "delete": {
        const targetPath = resolveUserPath(payload.path);
        await fs.rm(targetPath, { recursive: true, force: true });
        return { ok: true, output: `Deleted: ${targetPath}` };
      }
      case "open": {
        const targetPath = resolveUserPath(payload.path);
        const err = await shell.openPath(targetPath);
        return err ? { ok: false, error: err } : { ok: true, output: `Opened: ${targetPath}` };
      }
      case "exec": {
        const { stdout, stderr } = await execAsync(payload.command, {
          cwd: payload.cwd ?? os.homedir(),
          timeout: 60_000,
          windowsHide: true,
        }).catch((e) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? e.message }));
        return { ok: true, output: stdout.trim() || stderr.trim() };
      }
      default:
        return { ok: false, error: `Unknown command type: ${commandType}` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function bridgeRequest(baseUrl: string, token: string, method: string, path: string, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const lib = url.protocol === "https:" ? https : http;
    const bodyBuf = body ? Buffer.from(body) : Buffer.alloc(0);
    const req = lib.request(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": bodyBuf.length },
    }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c.toString(); });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve(data);
          return;
        }
        let detail = data;
        try { detail = JSON.parse(data).detail ?? data; } catch { /* not JSON */ }
        reject(new Error(`HTTP ${status}: ${String(detail).slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    if (bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

function postResult(baseUrl: string, token: string, commandId: number, result: { ok: boolean; output?: string; error?: string }) {
  const body = JSON.stringify({ ok: result.ok, output: result.output ?? null, error: result.error ?? null });
  bridgeRequest(baseUrl, token, "POST", `/api/desktop/commands/${commandId}/result`, body)
    .catch((err) => logToFile(`Failed to post result for command ${commandId}: ${err?.message ?? err}`));
}

function postProgress(baseUrl: string, token: string, commandId: number, message: string) {
  bridgeRequest(baseUrl, token, "POST", `/api/desktop/commands/${commandId}/progress`, JSON.stringify({ message }))
    .catch((err) => logToFile(`Failed to post progress for command ${commandId}: ${err?.message ?? err}`));
}

// ── OneDrive book sync: runs an unbounded local loop, one small backend call at a
// time, so syncing any number of books is never subject to a serverless request
// timeout. Resumable via an opaque cursor the backend hands back each call.
async function runOneDriveSync(baseUrl: string, token: string, commandId: number) {
  let cursor: string | null = null;
  let scanned = 0, created = 0, updated = 0;
  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;
  let lastProgressAt = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  while (true) {
    try {
      const raw = await bridgeRequest(baseUrl, token, "POST", "/api/admin/books/sync/page", JSON.stringify({ cursor }));
      const page = JSON.parse(raw);
      scanned += page.scanned ?? 0;
      created += page.created ?? 0;
      updated += page.updated ?? 0;
      cursor = page.cursor ?? null;
      backoffMs = 1000;
      consecutiveFailures = 0;

      const now = Date.now();
      if (now - lastProgressAt > 2000) {
        lastProgressAt = now;
        postProgress(baseUrl, token, commandId, `Scanned ${scanned} · ${created} new · ${updated} updated…`);
      }

      if (page.done) {
        postResult(baseUrl, token, commandId, { ok: true, output: `Sync complete — scanned ${scanned}, ${created} new, ${updated} updated.` });
        return;
      }
    } catch (err: any) {
      consecutiveFailures++;
      const message = err?.message ?? "Unknown error";
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        postResult(baseUrl, token, commandId, { ok: false, error: `OneDrive sync failed after ${MAX_CONSECUTIVE_FAILURES} attempts: ${message}` });
        return;
      }
      postProgress(baseUrl, token, commandId, `Error, retrying (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${message}`);
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}

function startDesktopBridge(baseUrl: string, token: string) {
  if (bridgeHeartbeatTimer) clearInterval(bridgeHeartbeatTimer);
  if (bridgePollTimer) clearInterval(bridgePollTimer);

  function request(method: string, path: string, body?: string): Promise<string> {
    return bridgeRequest(baseUrl, token, method, path, body);
  }

  function sendHeartbeat() {
    request("POST", "/api/desktop/heartbeat").catch((err) => logToFile(`Heartbeat failed: ${err?.message ?? err}`));
  }

  const syncRunning = new Set<number>();

  function pollCommands() {
    request("GET", "/api/desktop/pending").then((body) => {
      let commands: Array<{ id: number; command_type: string; payload: Record<string, unknown> }>;
      try {
        commands = JSON.parse(body);
        if (!Array.isArray(commands)) throw new Error(`expected an array, got: ${body.slice(0, 300)}`);
      } catch (err: any) {
        logToFile(`Failed to parse /api/desktop/pending response: ${err?.message ?? err}`);
        return;
      }
      for (const cmd of commands) {
        if (cmd.command_type === "onedrive-sync") {
          if (syncRunning.has(cmd.id)) continue;
          syncRunning.add(cmd.id);
          runOneDriveSync(baseUrl, token, cmd.id).finally(() => syncRunning.delete(cmd.id));
          continue;
        }
        executeRemoteCommand(cmd.command_type, cmd.payload).then((result) => {
          postResult(baseUrl, token, cmd.id, result);
        });
      }
    }).catch((err) => logToFile(`Failed to poll /api/desktop/pending: ${err?.message ?? err}`));
  }

  sendHeartbeat();
  pollCommands();
  bridgeHeartbeatTimer = setInterval(sendHeartbeat, 30_000);
  bridgePollTimer = setInterval(pollCommands, 2_000);
}

// Renderer tells main to start the bridge (called after user logs in)
ipcMain.handle("memolink:bridge-connect", (_, { baseUrl, token }: { baseUrl: string; token: string }) => {
  startDesktopBridge(baseUrl, token);
  return { ok: true };
});

ipcMain.handle("memolink:bridge-disconnect", () => {
  if (bridgeHeartbeatTimer) { clearInterval(bridgeHeartbeatTimer); bridgeHeartbeatTimer = null; }
  if (bridgePollTimer) { clearInterval(bridgePollTimer); bridgePollTimer = null; }
  return { ok: true };
});

function setupAutoUpdater() {
  // Silent auto-download; prompt to restart when ready
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready — MemoLink",
        message: "A new version of MemoLink has been downloaded.\nRestart now to apply the update?",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    logToFile(`Auto-updater error: ${err.message}`);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    logToFile(`Update check failed: ${err.message}`);
  });
}

app.whenReady().then(() => {
  // Handle getDisplayMedia so Computer Audio capture works in Electron.
  // On Windows, 'loopback' captures all system audio via WASAPI without a dialog.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    callback({
      video: sources[0],
      audio: process.platform === "win32" ? "loopback" : undefined,
    });
  });

  createWindow();
  // Check for updates in production builds only
  if (!process.env.VITE_DEV_SERVER_URL) {
    setupAutoUpdater();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (waBridgeProc) { waBridgeProc.kill(); waBridgeProc = null; }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
