/**
 * Parses natural-language file system requests and executes them via
 * window.electronAPI when running inside the Electron desktop app.
 *
 * Intents:
 *   mkdir     – create folder immediately
 *   write     – create/overwrite file with known content
 *   write-ai  – let AI generate content, then save to disk after streaming
 *   list      – list directory contents
 *   read      – read file contents
 *   open      – reveal path in OS explorer
 *   delete    – delete file or folder
 */

export type FsIntent =
  | { kind: "mkdir"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "write-ai"; dir: string; filename: string; fullPath: string }
  | { kind: "list"; path: string }
  | { kind: "read"; path: string }
  | { kind: "open"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "none" };

// ── File type keyword → extension map ────────────────────────────────────────

const FILE_TYPES: Record<string, string> = {
  python: ".py", py: ".py",
  javascript: ".js", js: ".js",
  typescript: ".ts", ts: ".ts",
  html: ".html", htm: ".html",
  css: ".css", scss: ".scss",
  json: ".json", yaml: ".yaml", yml: ".yaml",
  bash: ".sh", shell: ".sh", batch: ".bat", powershell: ".ps1",
  java: ".java", c: ".c", cpp: ".cpp", "c++": ".cpp",
  ruby: ".rb", go: ".go", rust: ".rs", php: ".php",
  sql: ".sql", markdown: ".md", md: ".md",
  text: ".txt", txt: ".txt",
};

// ── Path utilities ────────────────────────────────────────────────────────────

function normPath(raw: string): string {
  return raw.trim().replace(/\//g, "\\").replace(/\\+/g, "\\");
}

function cleanTail(s: string): string {
  return s.replace(/\s*[.,;!?].*$/, "").trim();
}

const KNOWN_FOLDER_TOKENS: Record<string, string> = {
  desktop: "%USERPROFILE%\\Desktop",
  documents: "%USERPROFILE%\\Documents",
  document: "%USERPROFILE%\\Documents",
  downloads: "%USERPROFILE%\\Downloads",
  download: "%USERPROFILE%\\Downloads",
};

function joinPath(base: string, tail: string): string {
  const normalizedBase = normPath(base);
  const normalizedTail = normPath(tail).replace(/^\\+/, "");
  return normalizedBase.endsWith("\\")
    ? normalizedBase + normalizedTail
    : `${normalizedBase}\\${normalizedTail}`;
}

function extractKnownFolderPath(message: string): string | null {
  const folderNames = Object.keys(KNOWN_FOLDER_TOKENS).join("|");

  const inCalledRe = new RegExp(
    `\\b(?:in|on|at|inside)\\s+(?:my\\s+|the\\s+)?(${folderNames})(?:\\s+folder)?\\s+(?:called|named)\\s+(.+)`,
    "i",
  );
  let m = message.match(inCalledRe);
  if (m) return joinPath(KNOWN_FOLDER_TOKENS[m[1].toLowerCase()], cleanTail(m[2]));

  const calledInRe = new RegExp(
    `(?:called|named)\\s+(.+?)\\s+(?:in|on|at|inside)\\s+(?:my\\s+|the\\s+)?(${folderNames})(?:\\s+folder)?\\b`,
    "i",
  );
  m = message.match(calledInRe);
  if (m) return joinPath(KNOWN_FOLDER_TOKENS[m[2].toLowerCase()], cleanTail(m[1]));

  const folderOnlyRe = new RegExp(
    `\\b(?:in|on|at|inside|open)\\s+(?:my\\s+|the\\s+)?(${folderNames})(?:\\s+folder)?\\b`,
    "i",
  );
  m = message.match(folderOnlyRe);
  if (m) return KNOWN_FOLDER_TOKENS[m[1].toLowerCase()];

  return null;
}

/**
 * Extracts a Windows absolute path from natural language.
 * Handles:
 *   "in [drive|disk|the] C:\ [subpath] called/named <name>"
 *   "called/named <name> in C:\<path>"
 *   bare absolute path: C:\something
 */
function extractAbsPath(message: string): string | null {
  const knownFolderPath = extractKnownFolderPath(message);
  if (knownFolderPath) return knownFolderPath;

  // "in [drive] C:\ [subpath] called/named <name>"
  const inCalledRe = /\bin\s+(?:(?:drive|disk|the)\s+)?([A-Za-z]:[\\\/]?[^,\n]*?)\s+(?:called|named)\s+(.+)/i;
  let m = message.match(inCalledRe);
  if (m) {
    let base = normPath(m[1].trim());
    const name = cleanTail(m[2]);
    if (!base.endsWith("\\")) base += "\\";
    return base + name;
  }

  // "called/named <name> in [drive] C:\"
  const calledInRe = /(?:called|named)\s+(.+?)\s+(?:in|on|at)\s+(?:(?:drive|disk|the)\s+)?([A-Za-z]:[\\\/][^\s,\n]*)/i;
  m = message.match(calledInRe);
  if (m) {
    const name = cleanTail(m[1]);
    let base = normPath(m[2].trim());
    if (!base.endsWith("\\")) base += "\\";
    return base + name;
  }

  // Bare absolute path anywhere in the message
  const directRe = /([A-Za-z]:[\\\/][^\s,;!?\n]*(?:\s+[^\s,;!?\n]+)*)/;
  m = message.match(directRe);
  if (m) return normPath(cleanTail(m[1]));

  return null;
}

/** Split "C:\dir\file.ext" into { dir: "C:\dir", filename: "file.ext" } */
function splitDirFile(fullPath: string): { dir: string; filename: string } {
  const parts = fullPath.split("\\");
  const filename = parts.pop()!;
  return { dir: parts.join("\\"), filename };
}

// ── Intent parser ─────────────────────────────────────────────────────────────

export function parseIntent(message: string): FsIntent {
  const m = message.toLowerCase();

  // ── mkdir ──────────────────────────────────────────────────────────────────
  const isMkdir =
    /(create|make|add)\s+(a\s+)?(new\s+)?(folder|directory|dir)\b/.test(m) ||
    /\bnew\s+folder\b/.test(m) ||
    /\bmkdir\b/.test(m);

  if (isMkdir) {
    const path = extractAbsPath(message);
    if (path) return { kind: "mkdir", path };
  }

  // ── write-ai: "create a [type] file [description] in [path]" ──────────────
  // Triggered when a recognised file-type keyword appears before "file"
  const aiFileMatch = m.match(/(create|make|write|add)\s+(a\s+)?(?:new\s+)?(\w+)\s+file\b/);
  if (aiFileMatch) {
    const typeKw = aiFileMatch[3];
    const ext = FILE_TYPES[typeKw];
    if (ext) {
      const rawPath = extractAbsPath(message);
      if (rawPath) {
        const hasExt = /\.\w{1,10}$/.test(rawPath);
        if (hasExt) {
          // e.g. C:\RonPogi\script.py  — full path given
          const { dir, filename } = splitDirFile(rawPath);
          return { kind: "write-ai", dir, filename, fullPath: rawPath };
        }
        // rawPath is a directory → infer filename
        // Check for explicit "called/named foo.ext"
        const namedMatch = message.match(/(?:called|named)\s+([\w\-. ]+\.\w{1,10})/i);
        const filename = namedMatch ? namedMatch[1].trim() : `script${ext}`;
        const sep = rawPath.endsWith("\\") ? "" : "\\";
        return { kind: "write-ai", dir: rawPath, filename, fullPath: rawPath + sep + filename };
      }
    }
  }

  // ── write: "create file [path] [with content X]" ──────────────────────────
  const isWrite =
    /(create|make|add|write)\s+(a\s+)?(new\s+)?file\b/.test(m) ||
    /\bnew\s+file\b/.test(m);

  if (isWrite) {
    const writeTo = message.match(/write\s+"?(.+?)"?\s+to\s+(.+)/i);
    if (writeTo) {
      const path = extractAbsPath(writeTo[2]);
      if (path) return { kind: "write", path, content: writeTo[1] };
    }
    const withContent = message.match(/file\s+(.+?)\s+with(?:\s+content)?\s+"?(.+)"?$/i);
    if (withContent) {
      const path = extractAbsPath(withContent[1]);
      if (path) return { kind: "write", path, content: withContent[2] };
    }
    const path = extractAbsPath(message);
    if (path) return { kind: "write", path, content: "" };
  }

  // ── list directory ─────────────────────────────────────────────────────────
  if (
    /(list|show|display)\s+(files?|folders?|contents?)\s+in\b/.test(m) ||
    /what('?s|\s+is)\s+(in|inside)\s+[A-Za-z]:/i.test(m) ||
    /\bls\s+[A-Za-z]:/i.test(m)
  ) {
    const match =
      message.match(/(?:in|at|inside)\s+(?:(?:drive|disk|the)\s+)?([A-Za-z]:[\\\/][^\s,\n]*)/i) ??
      message.match(/([A-Za-z]:[\\\/][^\s,\n]*)/i);
    if (match) return { kind: "list", path: normPath(match[1]) };
  }

  // ── read file ──────────────────────────────────────────────────────────────
  if (
    /(read|show|display)\s+(the\s+)?(contents?\s+(of\s+)?)?(the\s+)?file\b/.test(m) ||
    /show\s+me\s+(what'?s?\s+in|the\s+contents?\s+of)/.test(m)
  ) {
    const path = extractAbsPath(message);
    if (path) return { kind: "read", path };
  }

  // ── open in explorer ──────────────────────────────────────────────────────
  if (/\bopen\s+(?:folder|directory|file|path)?\s*(?:(?:drive|disk|the)\s+)?[A-Za-z]:[\\\/]/.test(m)) {
    const p = extractAbsPath(message);
    if (p) return { kind: "open", path: p };
  }

  // ── delete ────────────────────────────────────────────────────────────────
  if (/(delete|remove|erase)\s+(the\s+)?(folder|directory|file)?\s*[A-Za-z]:[\\\/]/.test(m)) {
    const p = extractAbsPath(message);
    if (p) return { kind: "delete", path: p };
  }

  return { kind: "none" };
}

// ── Executor ──────────────────────────────────────────────────────────────────

export type FsResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function executeIntent(intent: FsIntent): Promise<FsResult> {
  const api = window.electronAPI;
  if (!api) return { ok: false, message: "Not running in Electron desktop mode." };

  switch (intent.kind) {
    case "mkdir": {
      const res = await api.mkdir(intent.path);
      return res.success
        ? { ok: true, message: `Folder created: **${res.path}**` }
        : { ok: false, message: `Could not create folder: ${res.error}` };
    }
    case "write": {
      const res = await api.writeFile(intent.path, intent.content);
      return res.success
        ? { ok: true, message: `File created: **${res.path}**` }
        : { ok: false, message: `Could not create file: ${res.error}` };
    }
    case "list": {
      const res = await api.listDir(intent.path);
      if (!res.success) return { ok: false, message: `Could not list directory: ${res.error}` };
      if (!res.entries || res.entries.length === 0)
        return { ok: true, message: `**${intent.path}** is empty.` };
      const lines = res.entries.map((e) => `- ${e.isDir ? "📁" : "📄"} ${e.name}`).join("\n");
      return { ok: true, message: `Contents of **${intent.path}**:\n${lines}` };
    }
    case "read": {
      const res = await api.readFile(intent.path);
      return res.success
        ? { ok: true, message: `Contents of **${intent.path}**:\n\`\`\`\n${res.content}\n\`\`\`` }
        : { ok: false, message: `Could not read file: ${res.error}` };
    }
    case "open": {
      const res = await api.openPath(intent.path);
      return res.success
        ? { ok: true, message: `Opened **${intent.path}** in the file explorer.` }
        : { ok: false, message: `Could not open path: ${res.error}` };
    }
    case "delete": {
      const res = await api.deleteItem(intent.path);
      return res.success
        ? { ok: true, message: `Deleted **${intent.path}**.` }
        : { ok: false, message: `Could not delete: ${res.error}` };
    }
    default:
      return { kind: "none" } as never;
  }
}

/**
 * Extract the first code block from an AI response.
 * Falls back to the raw text if no fences found.
 */
export function extractCodeFromResponse(text: string): string {
  const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

/** Returns true when a message should be handled locally (not sent to the AI) */
export function isDesktopCommand(message: string): boolean {
  if (!window.electronAPI) return false;
  const kind = parseIntent(message).kind;
  return kind !== "none" && kind !== "write-ai";
}
