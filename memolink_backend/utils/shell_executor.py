"""
Safe subprocess executor for MemoLink's ActionAgent.

Runs shell commands with a timeout and returns structured output.
Background processes (start /B ...) are tracked in a ProcessRegistry so
the frontend can list and terminate them.

Security notes:
- Commands run in the MemoLink process's working directory by default
- Timeout prevents runaway foreground processes (default 30s, max 120s)
- Output is capped at 50KB to prevent context flooding
- Destructive commands (rm -rf, format, del /f) are detected and warned
"""

import logging
import os
import platform
import subprocess
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Optional

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"

_DESTRUCTIVE_PATTERNS = [
    "rm -rf", "rm -r", "del /f", "del /q", "format",
    "dd if=", "mkfs", ":(){ :|:& };:",
    "shutdown", "reboot", "halt",
]

DEFAULT_TIMEOUT = 30
MAX_TIMEOUT = 120
MAX_OUTPUT_CHARS = 50_000


@dataclass
class ShellResult:
    command: str
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False
    warning: str | None = None
    proc_id: str | None = None   # set when a background process is registered


@dataclass
class RunningProcess:
    proc_id: str
    name: str
    command: str
    pid: int
    user_id: Optional[int]
    _popen: object = field(repr=False, compare=False)


class ProcessRegistry:
    """In-memory registry of background processes started by the ActionAgent."""

    def __init__(self):
        self._lock = Lock()
        self._processes: dict[str, RunningProcess] = {}

    def _friendly_name(self, command: str) -> str:
        cmd = command.strip()
        parts = cmd.split()
        if not parts:
            return command
        exe = parts[0].lower()
        if exe in ("python", "python3", "py") and len(parts) > 1:
            return os.path.basename(parts[-1])
        return os.path.basename(parts[0])

    def register(self, command: str, popen, user_id: Optional[int]) -> str:
        proc_id = uuid.uuid4().hex[:8]
        entry = RunningProcess(
            proc_id=proc_id,
            name=self._friendly_name(command),
            command=command,
            pid=popen.pid,
            user_id=user_id,
            _popen=popen,
        )
        with self._lock:
            self._processes[proc_id] = entry
        return proc_id

    def list_for_user(self, user_id: Optional[int] = None) -> list[dict]:
        result = []
        with self._lock:
            dead = []
            for proc_id, entry in self._processes.items():
                if user_id is not None and entry.user_id != user_id:
                    continue
                if entry._popen.poll() is not None:
                    dead.append(proc_id)
                    continue
                result.append({
                    "proc_id": proc_id,
                    "name": entry.name,
                    "command": entry.command,
                    "pid": entry.pid,
                })
            for proc_id in dead:
                del self._processes[proc_id]
        return result

    def kill(self, proc_id: str, user_id: Optional[int] = None) -> bool:
        with self._lock:
            entry = self._processes.get(proc_id)
            if not entry:
                return False
            if user_id is not None and entry.user_id != user_id:
                return False
            popen = entry._popen
            try:
                if _IS_WINDOWS:
                    subprocess.run(
                        f"taskkill /F /T /PID {popen.pid}",
                        shell=True,
                        capture_output=True,
                    )
                else:
                    import signal
                    os.killpg(os.getpgid(popen.pid), signal.SIGTERM)
            except Exception:
                try:
                    popen.kill()
                except Exception:
                    pass
            self._processes.pop(proc_id, None)
            return True


PROCESS_REGISTRY = ProcessRegistry()


def _check_destructive(command: str) -> str | None:
    lower = command.lower()
    for pattern in _DESTRUCTIVE_PATTERNS:
        if pattern in lower:
            return f"⚠️  Command contains potentially destructive pattern: '{pattern}'. Proceed with caution."
    return None


def _run_background(command: str, warning: str | None, user_id: Optional[int], original_command: str) -> ShellResult:
    """Launch a process detached and register it in PROCESS_REGISTRY."""
    try:
        kwargs: dict = dict(
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if _IS_WINDOWS:
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True

        popen = subprocess.Popen(command, **kwargs)
        proc_id = PROCESS_REGISTRY.register(command, popen, user_id)
        name = PROCESS_REGISTRY._processes.get(proc_id, RunningProcess(proc_id, command, command, popen.pid, user_id, popen)).name

        logger.info("Background process started (proc_id=%s, pid=%d): %s", proc_id, popen.pid, command)
        return ShellResult(
            command=original_command,
            stdout=f"Started '{name}' in background (PID {popen.pid}).",
            stderr="",
            exit_code=0,
            warning=warning,
            proc_id=proc_id,
        )
    except Exception as exc:
        logger.error("Failed to start background process: %s — %s", command, exc)
        return ShellResult(
            command=original_command,
            stdout="",
            stderr=f"Failed to start background process: {exc}",
            exit_code=-1,
            warning=warning,
        )


def run_shell(
    command: str,
    timeout: int = DEFAULT_TIMEOUT,
    cwd: str | None = None,
    user_id: Optional[int] = None,
) -> ShellResult:
    warning = _check_destructive(command)

    # Background intent: model uses "start /B <cmd>" prefix
    stripped = command.strip()
    if stripped.lower().startswith("start /b "):
        actual = stripped[9:].strip()
        return _run_background(actual, warning, user_id, original_command=command)

    timeout = min(max(timeout, 1), MAX_TIMEOUT)
    logger.info("Running shell command (timeout=%ds): %s", timeout, command)

    try:
        proc = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        stdout = proc.stdout[:MAX_OUTPUT_CHARS] if proc.stdout else ""
        stderr = proc.stderr[:MAX_OUTPUT_CHARS] if proc.stderr else ""
        if len(proc.stdout or "") > MAX_OUTPUT_CHARS:
            stdout += f"\n... (output truncated at {MAX_OUTPUT_CHARS} chars)"
        return ShellResult(command=command, stdout=stdout, stderr=stderr, exit_code=proc.returncode, warning=warning)

    except subprocess.TimeoutExpired:
        logger.warning("Command timed out after %ds: %s", timeout, command)
        return ShellResult(command=command, stdout="", stderr=f"Command timed out after {timeout} seconds.", exit_code=-1, timed_out=True, warning=warning)

    except Exception as exc:
        logger.error("Command failed: %s — %s", command, exc)
        return ShellResult(command=command, stdout="", stderr=f"Failed to run command: {exc}", exit_code=-1, warning=warning)


def format_shell_result(result: ShellResult) -> str:
    parts = [f"Command: {result.command}"]

    if result.warning:
        parts.append(result.warning)

    if result.timed_out:
        parts.append("⏱️  TIMED OUT")
    elif result.exit_code == 0:
        parts.append("✅  Success (exit code 0)")
    else:
        parts.append(f"❌  Failed (exit code {result.exit_code})")

    if result.proc_id:
        parts.append(f"[background proc_id={result.proc_id}]")

    if result.stdout.strip():
        parts.append(f"\n--- stdout ---\n{result.stdout.strip()}")

    if result.stderr.strip():
        parts.append(f"\n--- stderr ---\n{result.stderr.strip()}")

    return "\n".join(parts)
