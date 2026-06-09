from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Iterator, Optional

from openai import OpenAI

from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.contracts.chat_dtos import ChatResponseDTO
from memolink_backend.contracts.chat_stream_dtos import (
    MessageCompleteEvent,
    MessageDeltaEvent,
    ToolCompleteEvent,
    ToolStartEvent,
    sse_event,
)
from memolink_backend.core.config import settings
from memolink_backend.utils.web_search import brave_search

logger = logging.getLogger(__name__)

_HTML_TAG = re.compile(r"<[^>]+>")
_OPENAI_PREFIXES = ("gpt-", "o1-", "o3-", "o4-")
_ACTION_NOTE_RE = re.compile(
    r"\b(?:create|add|save|make)\b.*\bnote\b"
    r"|\b(?:save|add)\b.*\bto notes?\b"
    r"|\b(?:edit|update|rewrite|revise|improve|polish)\b.*\bnote\b"
    r"|\b(?:search|find|look\s+through|check)\b.*\bnotes?\b",
    re.IGNORECASE,
)
_ACTION_REMINDER_RE = re.compile(
    r"\b(?:create|set|add)\b.*\breminder\b|\bremind me\b",
    re.IGNORECASE,
)
_ACTION_WEB_RE = re.compile(
    r"\b(?:search|look up|check|find)\b.*\b(?:web|internet|online)\b"
    r"|\b(?:latest|recent|current)\b.*\b(?:news|updates)\b",
    re.IGNORECASE,
)
_EXPLICIT_TOOL_RE = re.compile(
    r"\b(?:use tools|take action|do it for me|handle it for me|perform the action)\b",
    re.IGNORECASE,
)

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_notes",
            "description": "Search the user's personal notes for relevant information using semantic similarity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query describing what to look for"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_note",
            "description": "Create a new note with a title and markdown content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short note title"},
                    "content": {"type": "string", "description": "Note body in markdown format"},
                },
                "required": ["title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_note",
            "description": "Update the content of an existing note by its ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "note_id": {"type": "integer", "description": "ID of the note to edit"},
                    "title": {"type": "string", "description": "New title (optional)"},
                    "content": {"type": "string", "description": "New content in markdown"},
                },
                "required": ["note_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reminder",
            "description": "Create a reminder for the user with an optional due date and time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Short reminder title"},
                    "description": {"type": "string", "description": "Optional longer detail"},
                    "due_date": {"type": "string", "description": "Due date in YYYY-MM-DD format"},
                    "due_time": {"type": "string", "description": "Due time in HH:MM (24-hour) format"},
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for up-to-date information on a topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"],
            },
        },
    },
]

_TOOL_LABELS = {
    "search_notes": "Searching your notes",
    "create_note": "Creating a note",
    "edit_note": "Editing note",
    "create_reminder": "Adding a reminder",
    "web_search": "Searching the web",
}

_SYSTEM_PROMPT = (
    "You are MemoLink Action Agent, an AI assistant that can take focused actions on the user's behalf. "
    "Use tools only when the user is asking you to perform a concrete action such as searching notes, "
    "creating or editing notes, adding reminders, or searching the web for live information. "
    "Keep tool use efficient, avoid redundant actions, and give a concise final answer that states what you did."
)


@dataclass(frozen=True)
class ActionAgentDecision:
    should_handle: bool
    reason: str | None = None


def decide_action_agent(prompt: str, smart_analysis: dict | None = None) -> ActionAgentDecision:
    lower = (prompt or "").strip().lower()
    if not lower:
        return ActionAgentDecision(False)

    note_action = bool(_ACTION_NOTE_RE.search(lower))
    reminder_action = bool(_ACTION_REMINDER_RE.search(lower))
    web_action = bool(_ACTION_WEB_RE.search(lower))
    explicit_tool_request = bool(_EXPLICIT_TOOL_RE.search(lower))

    if not any((note_action, reminder_action, web_action, explicit_tool_request)):
        return ActionAgentDecision(False)

    mode = (smart_analysis or {}).get("mode", "general_chat")
    if mode in {"academic_writer", "creative_writer", "email_writer"} and not explicit_tool_request and not note_action and not reminder_action:
        return ActionAgentDecision(False)

    if note_action:
        return ActionAgentDecision(True, "Smart: action_agent (notes)")
    if reminder_action:
        return ActionAgentDecision(True, "Smart: action_agent (reminder)")
    if web_action and ((smart_analysis or {}).get("needs_web") or "search" in lower or "look up" in lower):
        return ActionAgentDecision(True, "Smart: action_agent (web)")
    if explicit_tool_request:
        return ActionAgentDecision(True, "Smart: action_agent (explicit)")

    return ActionAgentDecision(False)


class ActionAgentRunner:
    def __init__(
        self,
        conv_repo,
        note_repo,
        reminder_repo,
        embedding_service: Optional[EmbeddingService] = None,
    ):
        self.conv_repo = conv_repo
        self.note_repo = note_repo
        self.reminder_repo = reminder_repo
        self.embedding = embedding_service or EmbeddingService()
        self.client = OpenAI(api_key=settings.openai_api_key)

    def _resolve_model(self, model: Optional[str]) -> str:
        selected = model or settings.openai_chat_model
        if not any(selected.startswith(prefix) for prefix in _OPENAI_PREFIXES):
            return "gpt-4o-mini"
        return selected

    def _build_messages(
        self,
        *,
        conversation_id: int,
        prompt: str,
        persist_user_message: bool,
    ) -> list[dict]:
        user_text = prompt.strip()
        if persist_user_message:
            self.conv_repo.add_message(conversation_id, "user", user_text)
        history = self.conv_repo.get_messages_paginated(conversation_id, limit=20, before_id=None)
        messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
        messages += [{"role": message.role, "content": message.content} for message in reversed(history)]
        return messages

    def _search_notes(self, query: str, user_id: int, workspace_id: Optional[int]) -> str:
        try:
            vec = self.embedding.embed_text(query)
            try:
                notes = self.note_repo.search_by_vector(vec, top_k=5, workspace_id=workspace_id)
            except TypeError:
                notes = self.note_repo.search_by_vector(vec, top_k=5)
        except Exception:
            notes = self.note_repo.get_for_user(user_id, workspace_id)[:5]
        if not notes:
            return "No relevant notes found."
        return "\n\n".join(
            f"[NOTE {note.id}: {note.title or 'Untitled'}]\n{_HTML_TAG.sub(' ', note.content).strip()[:600]}"
            for note in notes
        )

    def _create_note(self, title: str, content: str, user_id: int, workspace_id: Optional[int]) -> str:
        note = self.note_repo.create_note(user_id, title, content, "agent", workspace_id)
        try:
            vec = self.embedding.embed_text(f"{title} {content}"[:2000])
            if hasattr(self.note_repo, "save_embedding"):
                self.note_repo.save_embedding(note.id, vec)
        except Exception:
            pass
        repo_db = getattr(self.note_repo, "db", None)
        if repo_db is not None:
            try:
                repo_db.commit()
            except Exception:
                pass
        return f"Created note '{title}' (ID: {note.id})"

    def _edit_note(self, note_id: int, content: str, title: Optional[str]) -> str:
        note = self.note_repo.update_note(note_id, title, content)
        if not note:
            return f"Note {note_id} not found."
        return f"Updated note '{note.title or 'Untitled'}' (ID: {note_id})"

    def _create_reminder(
        self,
        text: str,
        user_id: int,
        workspace_id: Optional[int],
        description: Optional[str] = None,
        due_date: Optional[str] = None,
        due_time: Optional[str] = None,
    ) -> str:
        self.reminder_repo.create_reminder(
            user_id=user_id,
            text=text,
            workspace_id=workspace_id,
            description=description,
            reminder_type="ai",
            due_date=due_date,
            due_time=due_time,
        )
        date_str = f" for {due_date}" if due_date else ""
        time_str = f" at {due_time}" if due_time else ""
        return f"Created reminder '{text}'{date_str}{time_str}"

    def _web_search(self, query: str) -> str:
        result = brave_search(query)
        return result or "No web results found."

    def _execute_tool(self, name: str, args: dict, user_id: int, workspace_id: Optional[int]) -> str:
        if name == "search_notes":
            return self._search_notes(args["query"], user_id, workspace_id)
        if name == "create_note":
            return self._create_note(args["title"], args["content"], user_id, workspace_id)
        if name == "edit_note":
            return self._edit_note(args["note_id"], args["content"], args.get("title"))
        if name == "create_reminder":
            return self._create_reminder(
                args["text"],
                user_id,
                workspace_id,
                args.get("description"),
                args.get("due_date"),
                args.get("due_time"),
            )
        if name == "web_search":
            return self._web_search(args["query"])
        return f"Unknown tool: {name}"

    def _run_tool_loop(
        self,
        *,
        messages: list[dict],
        model: str,
        user_id: int,
        workspace_id: Optional[int],
        stream_events: bool,
    ) -> tuple[list[dict], list[str]]:
        events: list[str] = []
        for _ in range(5):
            response = self.client.chat.completions.create(
                model=model,
                messages=messages,
                tools=AGENT_TOOLS,
                tool_choice="auto",
            )
            choice = response.choices[0]
            if choice.finish_reason != "tool_calls":
                break

            messages.append(choice.message)
            for tool_call in choice.message.tool_calls:
                name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)
                label = _TOOL_LABELS.get(name, name)
                if stream_events:
                    events.append(sse_event(ToolStartEvent(label=label, tool_call=name)))
                result = self._execute_tool(name, args, user_id, workspace_id)
                if stream_events:
                    events.append(sse_event(ToolCompleteEvent(ok=True, result=result)))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": result,
                    }
                )
        return messages, events

    def ask(
        self,
        *,
        conversation_id: int,
        prompt: str,
        user_id: int,
        workspace_id: Optional[int],
        model: Optional[str] = None,
        persist_user_message: bool = True,
        routing_reason: str | None = None,
    ) -> ChatResponseDTO:
        user_text = prompt.strip()
        if not user_text:
            return ChatResponseDTO(answer="Please provide a message.", sources=[])

        chosen_model = self._resolve_model(model)
        full_answer = ""
        try:
            messages = self._build_messages(
                conversation_id=conversation_id,
                prompt=user_text,
                persist_user_message=persist_user_message,
            )
            messages, _ = self._run_tool_loop(
                messages=messages,
                model=chosen_model,
                user_id=user_id,
                workspace_id=workspace_id,
                stream_events=False,
            )
            response = self.client.chat.completions.create(
                model=chosen_model,
                messages=messages,
            )
            full_answer = (response.choices[0].message.content or "").strip()
        except Exception as exc:
            logger.warning("Action agent failed: %s", exc)
            full_answer = f"⚠ Action agent error: {exc}"

        assistant_msg = self.conv_repo.add_message(conversation_id, "assistant", full_answer, model=chosen_model)
        return ChatResponseDTO(
            answer=full_answer,
            sources=[],
            message_id=assistant_msg.id,
            routing_reason=routing_reason,
        )

    def ask_stream(
        self,
        *,
        conversation_id: int,
        prompt: str,
        user_id: int,
        workspace_id: Optional[int],
        model: Optional[str] = None,
        persist_user_message: bool = True,
        routing_reason: str | None = None,
    ) -> Iterator[str]:
        user_text = prompt.strip()
        if not user_text:
            yield sse_event(MessageDeltaEvent(text="Please provide a message."))
            yield sse_event(MessageCompleteEvent(message_id=None, routing_reason=routing_reason))
            return

        chosen_model = self._resolve_model(model)
        full_answer = ""
        try:
            messages = self._build_messages(
                conversation_id=conversation_id,
                prompt=user_text,
                persist_user_message=persist_user_message,
            )
            messages, tool_events = self._run_tool_loop(
                messages=messages,
                model=chosen_model,
                user_id=user_id,
                workspace_id=workspace_id,
                stream_events=True,
            )
            for event in tool_events:
                yield event

            stream = self.client.chat.completions.create(
                model=chosen_model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_answer += delta
                    yield sse_event(MessageDeltaEvent(text=delta))
        except Exception as exc:
            logger.warning("Action agent stream failed: %s", exc)
            full_answer = f"⚠ Action agent error: {exc}"
            yield sse_event(MessageDeltaEvent(text=full_answer))

        assistant_msg = self.conv_repo.add_message(conversation_id, "assistant", full_answer, model=chosen_model)
        yield sse_event(
            MessageCompleteEvent(
                message_id=assistant_msg.id,
                model=chosen_model,
                routing_reason=routing_reason,
            )
        )
