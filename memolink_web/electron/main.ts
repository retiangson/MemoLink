import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import updaterPkg from "electron-updater";
const { autoUpdater } = updaterPkg;
import path from "path";
import fs from "fs/promises";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function postResult(baseUrl: string, token: string, commandId: number, result: { ok: boolean; output?: string; error?: string }) {
  const body = JSON.stringify({ ok: result.ok, output: result.output ?? null, error: result.error ?? null });
  const url = new URL(`/api/desktop/commands/${commandId}/result`, baseUrl);
  const lib = url.protocol === "https:" ? https : http;
  const req = lib.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Content-Length": Buffer.byteLength(body) },
  });
  req.write(body);
  req.end();
}

function startDesktopBridge(baseUrl: string, token: string) {
  if (bridgeHeartbeatTimer) clearInterval(bridgeHeartbeatTimer);
  if (bridgePollTimer) clearInterval(bridgePollTimer);

  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  function request(method: string, path: string, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const lib = url.protocol === "https:" ? https : http;
      const bodyBuf = body ? Buffer.from(body) : Buffer.alloc(0);
      const req = lib.request(url, {
        method,
        headers: { ...authHeaders, "Content-Length": bodyBuf.length },
      }, (res) => {
        let data = "";
        res.on("data", (c: Buffer) => { data += c.toString(); });
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      if (bodyBuf.length) req.write(bodyBuf);
      req.end();
    });
  }

  function sendHeartbeat() {
    request("POST", "/api/desktop/heartbeat").catch(() => {});
  }

  function pollCommands() {
    request("GET", "/api/desktop/pending").then((body) => {
      const commands: Array<{ id: number; command_type: string; payload: Record<string, unknown> }> = JSON.parse(body);
      for (const cmd of commands) {
        executeRemoteCommand(cmd.command_type, cmd.payload).then((result) => {
          postResult(baseUrl, token, cmd.id, result);
        });
      }
    }).catch(() => {});
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
    console.error("Auto-updater error:", err.message);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("Update check failed:", err.message);
  });
}

app.whenReady().then(() => {
  createWindow();
  // Check for updates in production builds only
  if (!process.env.VITE_DEV_SERVER_URL) {
    setupAutoUpdater();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
