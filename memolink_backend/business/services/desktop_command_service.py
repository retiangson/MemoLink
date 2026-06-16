"""
Desktop Command Service

Manages the remote command queue so the Electron desktop app can execute
file system and shell commands on behalf of the authenticated user, even
when the request originates from a web/mobile client.

Flow:
  Web client  ──POST /api/desktop/commands──▶  this service  ──push via SSE──▶  Electron app
  Web client  ◀──poll GET /{id}─────────────  this service  ◀──POST /{id}/result── Electron app
"""

import asyncio
import json
from collections import defaultdict
from typing import Optional
from memolink_backend.domain.repositories.desktop_command_repository import DesktopCommandRepository
from memolink_backend.contracts.desktop_command_contracts import (
    DesktopCommandCreateDTO,
    DesktopCommandResultDTO,
    DesktopCommandResponseDTO,
)

# In-memory SSE queues: user_id → list[asyncio.Queue]
# Each connected Electron app gets its own queue.
_desktop_queues: dict[int, list[asyncio.Queue]] = defaultdict(list)


class DesktopCommandService:
    def __init__(self, repo: DesktopCommandRepository):
        self._repo = repo

    # ── Command creation (called by web/mobile client) ────────────────────────

    def create_command(self, user_id: int, dto: DesktopCommandCreateDTO) -> DesktopCommandResponseDTO:
        cmd = self._repo.create(user_id, dto.command_type, dto.payload)

        # Push to any connected desktop apps for this user
        event = json.dumps({"command_id": cmd.id, "command_type": cmd.command_type, "payload": cmd.payload})
        for q in _desktop_queues.get(user_id, []):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

        return DesktopCommandResponseDTO.model_validate(cmd)

    def get_command(self, command_id: int, user_id: int) -> Optional[DesktopCommandResponseDTO]:
        cmd = self._repo.get_for_user(command_id, user_id)
        return DesktopCommandResponseDTO.model_validate(cmd) if cmd else None

    # ── Result submission (called by Electron app) ────────────────────────────

    def submit_result(self, command_id: int, user_id: int, dto: DesktopCommandResultDTO) -> bool:
        result_json = json.dumps({"ok": dto.ok, "output": dto.output, "error": dto.error})
        return self._repo.set_result_for_user(command_id, user_id, dto.ok, result_json)

    # ── SSE stream (Electron app connects here on startup) ───────────────────

    async def desktop_event_stream(self, user_id: int):
        """
        Async generator that yields SSE-formatted events.
        Drains any pending commands first, then waits for new ones.
        """
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        _desktop_queues[user_id].append(queue)

        try:
            # Send any pending commands that arrived while the desktop was offline
            for cmd in self._repo.list_pending(user_id):
                event = json.dumps({"command_id": cmd.id, "command_type": cmd.command_type, "payload": cmd.payload})
                yield f"data: {event}\n\n"

            # Keep connection alive, yield new commands as they arrive
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {event}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"   # keep-alive ping
        finally:
            queues = _desktop_queues.get(user_id, [])
            if queue in queues:
                queues.remove(queue)

    # ── Desktop presence ──────────────────────────────────────────────────────

    def is_desktop_online(self, user_id: int) -> bool:
        return len(_desktop_queues.get(user_id, [])) > 0
