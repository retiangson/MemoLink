"""
Agent service — orchestrates OpenAI tool-calling to let the AI take actions
(search notes, create notes, create reminders, web search, edit notes) before
producing a final streamed answer.
"""
from __future__ import annotations
import json
import re
from typing import Iterator, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from memolink_backend.core.config import settings
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.utils.web_search import brave_search

_HTML_TAG = re.compile(r"<[^>]+>")

# ── Tool definitions ───────────────────────────────────────────────────────────

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
    "You are MemoLink Agent, an AI assistant with the ability to take actions on the user's behalf. "
    "You can search their notes, create or edit notes, add reminders, and search the web. "
    "When the user asks you to do something, use the appropriate tools first, then summarise what you did "
    "and provide any helpful information. Always be concise and action-oriented."
)


class AgentService:
    def __init__(
        self,
        db: Session,
        embedding_service: Optional[EmbeddingService] = None,
    ):
        self.db = db
        self.note_repo = NoteRepository(db)
        self.conv_repo = ConversationRepository(db)
        self.embedding = embedding_service or EmbeddingService()
        self.client = OpenAI(api_key=settings.openai_api_key)

    # ── Tool implementations ───────────────────────────────────────────────────

    def _search_notes(self, query: str, user_id: int, workspace_id: Optional[int]) -> str:
        try:
            vec = self.embedding.embed_text(query)
            notes = self.note_repo.search_by_vector(vec, top_k=5, workspace_id=workspace_id)
        except Exception:
            notes = self.note_repo.get_for_user(user_id, workspace_id)[:5]
        if not notes:
            return "No relevant notes found."
        return "\n\n".join(
            f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{_HTML_TAG.sub(' ', n.content).strip()[:600]}"
            for n in notes
        )

    def _create_note(self, title: str, content: str, user_id: int, workspace_id: Optional[int]) -> str:
        note = self.note_repo.create_note(user_id, title, content, "agent", workspace_id)
        try:
            vec = self.embedding.embed_text(f"{title} {content}"[:2000])
            self.note_repo.save_embedding(note.id, vec)
        except Exception:
            pass
        self.db.commit()
        return f"Created note '{title}' (ID: {note.id})"

    def _edit_note(self, note_id: int, content: str, title: Optional[str]) -> str:
        note = self.note_repo.update_note(note_id, title, content)
        if not note:
            return f"Note {note_id} not found."
        self.db.commit()
        return f"Updated note '{note.title or 'Untitled'}' (ID: {note_id})"

    def _create_reminder(
        self, text: str, user_id: int, workspace_id: Optional[int],
        description: Optional[str] = None,
        due_date: Optional[str] = None,
        due_time: Optional[str] = None,
    ) -> str:
        reminder = Reminder(
            user_id=user_id,
            workspace_id=workspace_id,
            text=text,
            description=description,
            type="ai",
            due_date=due_date,
            due_time=due_time,
        )
        self.db.add(reminder)
        self.db.commit()
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
                args["text"], user_id, workspace_id,
                args.get("description"), args.get("due_date"), args.get("due_time"),
            )
        if name == "web_search":
            return self._web_search(args["query"])
        return f"Unknown tool: {name}"

    # ── Main streaming entry point ─────────────────────────────────────────────

    def ask_stream(
        self,
        conversation_id: int,
        prompt: str,
        user_id: int,
        workspace_id: Optional[int],
        model: Optional[str] = None,
    ) -> Iterator[str]:
        model = model or settings.openai_chat_model
        user_text = prompt.strip()
        if not user_text:
            yield f"data: {json.dumps({'t': 'Please provide a message.'})}\n\n"
            yield f"data: {json.dumps({'done': True, 'id': None})}\n\n"
            return

        self.conv_repo.add_message(conversation_id, "user", user_text)
        history = self.conv_repo.get_messages_paginated(conversation_id, limit=20, before_id=None)
        messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
        messages += [{"role": m.role, "content": m.content} for m in reversed(history)]

        full_answer = ""

        try:
            # ── Tool-calling loop (max 5 rounds) ──────────────────────────────
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

                # Append assistant tool-call message
                messages.append(choice.message)

                for tc in choice.message.tool_calls:
                    name = tc.function.name
                    args = json.loads(tc.function.arguments)
                    label = _TOOL_LABELS.get(name, name)

                    yield f"data: {json.dumps({'tool_call': name, 'label': label})}\n\n"

                    result = self._execute_tool(name, args, user_id, workspace_id)

                    yield f"data: {json.dumps({'tool_result': name, 'ok': True})}\n\n"

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })

            # ── Stream final answer ───────────────────────────────────────────
            stream = self.client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    full_answer += delta
                    yield f"data: {json.dumps({'t': delta})}\n\n"

        except Exception as e:
            full_answer = f"⚠ Agent error: {str(e)}"
            yield f"data: {json.dumps({'t': full_answer})}\n\n"

        assistant_msg = self.conv_repo.add_message(conversation_id, "assistant", full_answer, model=model)
        yield f"data: {json.dumps({'done': True, 'id': assistant_msg.id, 'model': model})}\n\n"
