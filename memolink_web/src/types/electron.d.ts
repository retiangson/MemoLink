interface ElectronAPI {
  saveFile: (opts: {
    filename: string;
    content?: string;
    binary?: number[];
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>;

  openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;

  getInfo: () => Promise<{ version: string; platform: string }>;

  mkdir: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;

  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>;

  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;

  listDir: (dirPath: string) => Promise<{
    success: boolean;
    entries?: { name: string; isDir: boolean }[];
    error?: string;
  }>;

  deleteItem: (targetPath: string) => Promise<{ success: boolean; error?: string }>;

  exec: (command: string, cwd?: string) => Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
  }>;

  bridgeConnect: (baseUrl: string, token: string) => Promise<{ ok: boolean }>;
  bridgeDisconnect: () => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
