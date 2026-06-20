"""
WhatsApp service — manages the local Baileys bridge subprocess and
exposes async helpers for the controller.
"""
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
from openai import OpenAI

from memolink_backend.core.config import settings

logger = logging.getLogger(__name__)

BRIDGE_PORT = 3797
BRIDGE_URL = f"http://127.0.0.1:{BRIDGE_PORT}"
_bridge_processes: dict[int, subprocess.Popen] = {}


def normalize_chat_id(target: str) -> str:
    value = (target or "").strip()
    if not value:
        raise ValueError("WhatsApp recipient is required")
    if "@" in value:
        return value

    digits = re.sub(r"\D", "", value)
    if not 7 <= len(digits) <= 15:
        raise ValueError("WhatsApp recipient must be a valid phone number")
    return f"{digits}@s.whatsapp.net"


def _bridge_dir() -> Path:
    return Path(__file__).parent.parent.parent / "whatsapp_bridge"


def _session_dir(user_id: int) -> Path:
    # Lambda and some containers have a read-only home dir; fall back to /tmp
    bases = [
        Path.home() / ".memolink" / "whatsapp",
        Path("/tmp") / "memolink" / "whatsapp",
    ]
    for base in bases:
        try:
            base.mkdir(parents=True, exist_ok=True)
            p = base / str(user_id)
            p.mkdir(parents=True, exist_ok=True)
            return p
        except OSError:
            continue
    raise RuntimeError("Cannot create WhatsApp session directory in home or /tmp")


def _first_existing_executable(candidates: list[str | Path | None]) -> str | None:
    for candidate in candidates:
        if not candidate:
            continue

        path = Path(str(candidate)).expanduser()
        if path.is_file():
            return str(path)
    return None


def _find_node() -> str | None:
    executable = "node.exe" if sys.platform == "win32" else "node"
    bridge_dir = _bridge_dir()
    python_dir = Path(sys.executable).parent

    extra_win: list[str | Path | None] = []
    if sys.platform == "win32":
        # Standard Windows installer locations
        extra_win = [
            Path(r"C:\Program Files\nodejs") / executable,
            Path(r"C:\Program Files (x86)\nodejs") / executable,
            # NVM for Windows: %APPDATA%\nvm\<version>\node.exe
            *[
                p / executable
                for p in (Path(os.getenv("APPDATA", "")) / "nvm").glob("*")
                if p.is_dir()
            ],
        ]

    return _first_existing_executable(
        [
            os.getenv("MEMOLINK_NODE_PATH"),
            shutil.which("node"),
            shutil.which("node.exe"),
            *extra_win,
            bridge_dir / "node" / executable,
            bridge_dir / "node" / "bin" / executable,
            python_dir / executable,
            python_dir / "node" / executable,
            python_dir / "node" / "bin" / executable,
            python_dir / "resources" / "node" / executable,
            python_dir / "resources" / "node" / "bin" / executable,
            Path("/usr/local/bin/node"),
            Path("/usr/bin/node"),
        ]
    )


def _find_npm() -> str | None:
    executable = "npm.cmd" if sys.platform == "win32" else "npm"
    bridge_dir = _bridge_dir()
    python_dir = Path(sys.executable).parent

    return _first_existing_executable(
        [
            os.getenv("MEMOLINK_NPM_PATH"),
            shutil.which("npm"),
            shutil.which("npm.cmd"),
            bridge_dir / "node" / executable,
            bridge_dir / "node" / "bin" / executable,
            python_dir / executable,
            python_dir / "node" / executable,
            python_dir / "node" / "bin" / executable,
            python_dir / "resources" / "node" / executable,
            python_dir / "resources" / "node" / "bin" / executable,
            Path("/usr/local/bin/npm"),
            Path("/usr/bin/npm"),
        ]
    )


def _kill_orphan_bridge() -> None:
    """Kill any process already occupying BRIDGE_PORT (survives backend restarts)."""
    try:
        if sys.platform == "win32":
            flags = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=5,
                creationflags=flags,
            )
            for line in result.stdout.splitlines():
                if f":{BRIDGE_PORT}" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    if pid.isdigit() and int(pid) > 0:
                        subprocess.run(
                            ["taskkill", "/F", "/PID", pid],
                            capture_output=True, timeout=3,
                            creationflags=flags,
                        )
                        time.sleep(0.3)  # let OS release the socket
        else:
            subprocess.run(
                ["pkill", "-f", "bridge.js"],
                capture_output=True, timeout=3,
            )
            time.sleep(0.3)
    except Exception:
        pass


def _clear_session(user_id: int) -> None:
    """Delete saved WhatsApp session files so the next connect shows a fresh QR."""
    for base in [Path.home() / ".memolink" / "whatsapp", Path("/tmp") / "memolink" / "whatsapp"]:
        session = base / str(user_id)
        if session.exists():
            shutil.rmtree(session, ignore_errors=True)


def start_bridge(user_id: int) -> dict:
    """Start the Node.js WhatsApp bridge for this user."""
    if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
        raise RuntimeError(
            "WhatsApp is not available in the Lambda deployment. "
            "The bridge needs a persistent process and port — use a server or container deployment instead."
        )

    proc = _bridge_processes.get(user_id)
    if proc and proc.poll() is None:
        return {"started": False, "message": "Bridge already running"}

    bridge_dir = _bridge_dir()
    bridge_js = bridge_dir / "bridge.js"

    if not bridge_js.exists():
        raise RuntimeError(f"WhatsApp bridge not found at {bridge_js}")

    node = _find_node()
    if not node:
        raise RuntimeError(
            "WhatsApp requires a bundled Node.js 20+ runtime in production. "
            "Install Node.js on the host, set MEMOLINK_NODE_PATH, or rebuild the "
            "Docker/Electron package so it includes Node and the WhatsApp bridge."
        )

    # Kill any orphan bridge from a previous backend session
    _kill_orphan_bridge()

    # Auto-install npm deps on first run
    nm = bridge_dir / "node_modules"
    if not nm.exists():
        npm = _find_npm()
        if not npm:
            raise RuntimeError(
                "WhatsApp bridge dependencies are missing and npm was not found. "
                "Run npm ci --omit=dev in memolink_backend/whatsapp_bridge during "
                "the production build, or set MEMOLINK_NPM_PATH for development."
            )
        subprocess.run(
            [npm, "ci", "--omit=dev"] if (bridge_dir / "package-lock.json").exists() else [npm, "install"],
            cwd=str(bridge_dir),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    session = str(_session_dir(user_id))

    # Detach so the bridge survives backend restarts (uvicorn --reload kills children)
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        proc = subprocess.Popen(
            [node, str(bridge_js), "--port", str(BRIDGE_PORT), "--session", session],
            cwd=str(bridge_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=flags,
        )
    else:
        proc = subprocess.Popen(
            [node, str(bridge_js), "--port", str(BRIDGE_PORT), "--session", session],
            cwd=str(bridge_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,  # detach from parent process group on Unix
        )
    _bridge_processes[user_id] = proc
    return {"started": True}


def stop_bridge(user_id: int) -> dict:
    proc = _bridge_processes.pop(user_id, None)
    if proc:
        try:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=3)
        except Exception:
            pass
        # Clear saved session so the next connect always shows a fresh QR
        _clear_session(user_id)
        return {"stopped": True}
    # Even with no tracked proc, clear session and kill any orphan
    _kill_orphan_bridge()
    _clear_session(user_id)
    return {"stopped": False}


def is_bridge_running(user_id: int) -> bool:
    proc = _bridge_processes.get(user_id)
    return proc is not None and proc.poll() is None


def get_status() -> dict:
    try:
        with httpx.Client(timeout=3.0) as client:
            data = client.get(f"{BRIDGE_URL}/health").json()
        return {
            "connected":           data.get("status") == "connected",
            "status":              data.get("status", "disconnected"),
            "qr_image":            data.get("qr_image"),
            "historySynced":       data.get("historySynced", False),
            "historySyncComplete": data.get("historySyncComplete", False),
            "historySyncProgress": data.get("historySyncProgress"),
            "chatCount":           data.get("chatCount", 0),
            "messageCount":        data.get("messageCount", 0),
        }
    except Exception:
        return {"connected": False, "status": "disconnected", "qr_image": None,
                "historySynced": False, "historySyncComplete": False, "historySyncProgress": None,
                "chatCount": 0, "messageCount": 0}


async def list_chats() -> list:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{BRIDGE_URL}/chats")
            chats = resp.json().get("chats", [])

            async def has_messages(chat: dict, semaphore: asyncio.Semaphore) -> bool:
                if not isinstance(chat, dict) or not chat.get("id"):
                    return False
                message_count = chat.get("messageCount")
                if isinstance(message_count, int):
                    return message_count > 0
                async with semaphore:
                    try:
                        msg_resp = await client.get(
                            f"{BRIDGE_URL}/messages",
                            params={"chatId": chat["id"], "limit": 1, "offset": 0},
                        )
                        payload = msg_resp.json()
                        return bool(payload.get("total", 0) or payload.get("messages"))
                    except Exception:
                        return False

            semaphore = asyncio.Semaphore(8)
            checks = await asyncio.gather(*(has_messages(chat, semaphore) for chat in chats))
            return [chat for chat, keep in zip(chats, checks) if keep]
    except Exception:
        return []


async def get_messages(chat_id: str, limit: int = 20, offset: int = 0) -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{BRIDGE_URL}/messages",
                params={"chatId": chat_id, "limit": limit, "offset": offset},
            )
            return resp.json()   # {messages: [...], total: N}
    except Exception:
        return {"messages": [], "total": 0}


async def get_profile_picture(chat_id: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{BRIDGE_URL}/profile-picture",
                params={"chatId": normalize_chat_id(chat_id)},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None


async def send_message(chat_id: str, message: str) -> dict:
    normalized_chat_id = normalize_chat_id(chat_id)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{BRIDGE_URL}/send",
            json={"chatId": normalized_chat_id, "message": message},
        )
        resp.raise_for_status()
        return resp.json()


async def delete_message(chat_id: str, msg_id: str) -> dict:
    normalized_chat_id = normalize_chat_id(chat_id)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{BRIDGE_URL}/delete",
            json={"chatId": normalized_chat_id, "msgId": msg_id},
        )
        resp.raise_for_status()
        return resp.json()


async def delete_chat(chat_id: str) -> dict:
    normalized_chat_id = normalize_chat_id(chat_id)
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{BRIDGE_URL}/chat/delete",
            json={"chatId": normalized_chat_id},
        )
        resp.raise_for_status()
        return resp.json()


async def suggest_reply(chat_id: str, note_context: str = "", draft_reply: str = "") -> list[str]:
    """Generate 3 AI reply suggestions for the last message in a WhatsApp chat.

    If draft_reply is provided, the suggestions rework that draft (matching its
    intent) instead of generating independent replies from scratch.
    """
    message_result = await get_messages(chat_id, limit=10)
    messages = message_result.get("messages", []) if isinstance(message_result, dict) else message_result
    if not messages:
        return []

    chat_text = "\n".join(
        f"{'Me' if m.get('fromMe') else m.get('from', 'Contact')}: {m.get('body', '')}"
        for m in messages[-10:]
        if isinstance(m, dict) and m.get("body")
    )
    if not chat_text:
        return []

    context_block = (
        f"\n\nRelevant notes/context:\n{note_context}"
        if note_context and note_context.strip()
        else ""
    )
    draft_block = (
        "\n\nThe user's CURRENT draft reply, typed just now and not yet sent "
        "(rewrite THIS — ignore the content/topic of any message the user already "
        f"sent earlier in the conversation above):\n\"{draft_reply.strip()}\""
        if draft_reply and draft_reply.strip()
        else ""
    )

    if draft_block:
        system_prompt = (
            "You polish WhatsApp reply drafts. The user has typed a new, unsent draft reply; "
            "rewrite ONLY that current draft into exactly 3 variants that preserve its intent and "
            "key content: one professional/formal, one friendly/casual, and one very brief. "
            "Do not base the variants on any message the user already sent earlier in the chat — "
            "that history is for context only. "
            "Each reply should be natural and ready to send. "
            + ("Use the provided notes context where relevant. " if context_block else "")
            + 'Respond ONLY with JSON: {"replies": ["...", "...", "..."]}'
        )
    else:
        system_prompt = (
            "You draft WhatsApp reply messages. Based on the conversation, "
            "generate exactly 3 reply options: one professional/formal, "
            "one friendly/casual, and one very brief. "
            "Each reply should be natural and ready to send. "
            + ("Use the provided notes context where relevant. " if context_block else "")
            + 'Respond ONLY with JSON: {"replies": ["...", "...", "..."]}'
        )

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"WhatsApp conversation so far:\n{chat_text}{context_block}{draft_block}\n\nGenerate 3 reply suggestions.",
                },
            ],
            max_tokens=300,
            temperature=0.7,
            response_format={"type": "json_object"},
        )
        result = json.loads(resp.choices[0].message.content)
        return result.get("replies", [])
    except Exception:
        return []
