import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  saveFile: (opts: { filename: string; content?: string; binary?: number[] }) =>
    ipcRenderer.invoke("memolink:save-file", opts),

  openPath: (filePath: string) =>
    ipcRenderer.invoke("memolink:open-path", filePath),

  getInfo: () =>
    ipcRenderer.invoke("memolink:get-info"),

  mkdir: (dirPath: string) =>
    ipcRenderer.invoke("memolink:mkdir", dirPath),

  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("memolink:write-file", { filePath, content }),

  readFile: (filePath: string) =>
    ipcRenderer.invoke("memolink:read-file", filePath),

  listDir: (dirPath: string) =>
    ipcRenderer.invoke("memolink:list-dir", dirPath),

  deleteItem: (targetPath: string) =>
    ipcRenderer.invoke("memolink:delete", targetPath),

  exec: (command: string, cwd?: string) =>
    ipcRenderer.invoke("memolink:exec", { command, cwd }),

  bridgeConnect: (baseUrl: string, token: string) =>
    ipcRenderer.invoke("memolink:bridge-connect", { baseUrl, token }),

  bridgeDisconnect: () =>
    ipcRenderer.invoke("memolink:bridge-disconnect"),

  waStart: () =>
    ipcRenderer.invoke("memolink:wa-start"),

  waStop: () =>
    ipcRenderer.invoke("memolink:wa-stop"),

  waReset: () =>
    ipcRenderer.invoke("memolink:wa-reset"),

  waProxy: (opts: { method: string; path: string; body?: Record<string, unknown>; params?: Record<string, string> }) =>
    ipcRenderer.invoke("memolink:wa-proxy", opts),
});
