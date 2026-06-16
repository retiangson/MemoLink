"""
File operation tools for MemoLink's ActionAgent.

Provides read, write, and patch (targeted string replacement) so the AI
can inspect code, fix bugs, and write new files on the local machine.

Safety limits:
- Read: capped at MAX_READ_CHARS to avoid flooding the context window
- Write: refuses to overwrite without explicit allow_overwrite flag
- Patch: requires exact old_string match — no silent partial matches
"""

import logging
import os
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

MAX_READ_CHARS = 30_000   # ~7-8k tokens — enough for most source files
MAX_READ_LINES = 1_000

_SAFE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json",
    ".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
    ".sh", ".bat", ".ps1", ".sql", ".csv", ".xml", ".java", ".c",
    ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".swift",
    ".kt", ".r", ".m", ".vue", ".svelte", ".tf", ".dockerfile",
    "", ".gitignore", ".env.example",
}


@dataclass
class FileResult:
    ok: bool
    path: str
    content: str       # on success: file contents / confirmation message
    error: str = ""    # on failure: error description
    lines: int = 0


def _expand(path: str) -> str:
    return os.path.expandvars(os.path.expanduser(path))


def _check_extension(path: str) -> Optional[str]:
    ext = os.path.splitext(path)[1].lower()
    if ext not in _SAFE_EXTENSIONS:
        return f"Refusing to read binary/unknown file type '{ext}'. Only text/source files are supported."
    return None


def read_file(path: str, offset: int = 0, limit: Optional[int] = None) -> FileResult:
    """
    Read a text file and return its contents with line numbers.

    Args:
        path: Absolute or relative file path
        offset: First line to read (0-indexed, default 0)
        limit: Max number of lines to read (default MAX_READ_LINES)
    """
    path = _expand(path)
    err = _check_extension(path)
    if err:
        return FileResult(ok=False, path=path, content="", error=err)

    if not os.path.exists(path):
        return FileResult(ok=False, path=path, content="", error=f"File not found: {path}")

    if not os.path.isfile(path):
        return FileResult(ok=False, path=path, content="", error=f"Path is not a file: {path}")

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()

        max_lines = limit or MAX_READ_LINES
        selected = all_lines[offset: offset + max_lines]
        total = len(all_lines)

        numbered = "".join(
            f"{offset + i + 1:4d}\t{line}" for i, line in enumerate(selected)
        )

        if len(numbered) > MAX_READ_CHARS:
            numbered = numbered[:MAX_READ_CHARS] + "\n... (truncated)"

        trailer = ""
        if offset + max_lines < total:
            trailer = f"\n[Showing lines {offset+1}–{offset+len(selected)} of {total}. Use offset/limit to read more.]"

        return FileResult(
            ok=True,
            path=path,
            content=numbered + trailer,
            lines=total,
        )
    except Exception as exc:
        logger.error("read_file failed for %s: %s", path, exc)
        return FileResult(ok=False, path=path, content="", error=str(exc))


def write_file(path: str, content: str, allow_overwrite: bool = True) -> FileResult:
    """
    Write content to a file, creating parent directories as needed.

    Args:
        path: Target file path
        content: Full file content to write
        allow_overwrite: If False, refuse if file already exists (default True)
    """
    path = _expand(path)

    if os.path.exists(path) and not allow_overwrite:
        return FileResult(ok=False, path=path, content="", error=f"File already exists: {path}. Set allow_overwrite=true to overwrite.")

    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        lines = content.count("\n") + 1
        logger.info("write_file: wrote %d lines to %s", lines, path)
        return FileResult(ok=True, path=path, content=f"Written {lines} lines to {path}", lines=lines)
    except Exception as exc:
        logger.error("write_file failed for %s: %s", path, exc)
        return FileResult(ok=False, path=path, content="", error=str(exc))


def patch_file(path: str, old_string: str, new_string: str) -> FileResult:
    """
    Replace the first exact occurrence of old_string with new_string in a file.
    Fails if old_string is not found or matches more than once (use write_file for full rewrites).

    Args:
        path: File to patch
        old_string: Exact text to find (must match exactly, including whitespace)
        new_string: Replacement text
    """
    path = _expand(path)

    if not os.path.exists(path):
        return FileResult(ok=False, path=path, content="", error=f"File not found: {path}")

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            original = f.read()

        count = original.count(old_string)
        if count == 0:
            return FileResult(ok=False, path=path, content="", error="old_string not found in file. Make sure the text matches exactly (including indentation and whitespace).")
        if count > 1:
            return FileResult(ok=False, path=path, content="", error=f"old_string found {count} times — it must be unique. Add more surrounding context to make it unique.")

        patched = original.replace(old_string, new_string, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(patched)

        logger.info("patch_file: patched %s", path)
        return FileResult(ok=True, path=path, content=f"Patched {path} successfully.")
    except Exception as exc:
        logger.error("patch_file failed for %s: %s", path, exc)
        return FileResult(ok=False, path=path, content="", error=str(exc))


def format_file_result(result: FileResult) -> str:
    if not result.ok:
        return f"❌ Error: {result.error}"
    return result.content
