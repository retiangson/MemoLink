"""
Workflow Agent Service - Human-Approval Agent
=============================================

A two-phase agent that proposes actions before executing them.

PHASE 1  plan()
---------------------------------------------------------------------------
1. Silently searches the user's notes (read-only - no approval needed).
2. Sends the prompt + found notes to GPT-4o-mini with a structured prompt
   that lists all 8 available action types and asks for a JSON plan.
3. Stores the plan as a conversation message with the __WORKFLOW_PLAN__
   prefix so the frontend can re-render it on history reload.
4. Returns the parsed plan to the frontend for approval UI.

PHASE 2  execute_stream()
---------------------------------------------------------------------------
Receives only the actions the user approved.
Executes each in order, streaming progress events:
  {"workflow_start":  true, "total": N}
  {"workflow_step":   {"id":"a1", "label":"Creating reminder…"}}
  {"workflow_done":   {"id":"a1", "label":"✓ Reminder created", "ok":true}}
  ...
  {"t": "Final summary text"}
  {"done": true, "id": <message_id>}

ACTION TYPES
---------------------------------------------------------------------------
  create_reminder       - creates a Reminder row
  create_note           - creates a Note row + embedding
  summarise_workspace   - GPT summarises all notes, creates a summary note
  search_web            - Brave Search (read-only, but user still sees it)
  organise_notes        - GPT proposes category tags for each note, creates
                          an organisation note with the mapping
  suggest_title         - improves the title of a named note via GPT
  extract_tasks         - extracts all action-item lines, creates a Tasks note
  prepare_report_outline - GPT writes a structured outline, creates a note
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Iterator, Optional

from openai import OpenAI

from memolink_backend.core.config import settings
from memolink_backend.contracts.workflow_dtos import (
    WorkflowAction, WorkflowPlanResponse, WorkflowConfirmResponse, WorkflowChatMessage,
)
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.utils.web_search import brave_image_search, brave_search

_HTML = re.compile(r"<[^>]+>")

_ACTION_ICONS = {
    "create_reminder":      "⏰",
    "create_note":          "📝",
    "summarise_workspace":  "📋",
    "search_web":           "🌐",
    "organise_notes":       "🗂️",
    "suggest_title":        "✏️",
    "extract_tasks":        "✅",
    "prepare_report_outline": "📄",
}

_PLAN_SYSTEM = """You are MemoLink Workflow Agent. Analyse the user's request and the notes context provided,
then return a JSON action plan. Do NOT execute anything - only propose.

Available action types and their required params:
  create_reminder       params: title (str), due_date (YYYY-MM-DD, optional), due_time (HH:MM, optional), description (optional)
  create_note           params: title (str), content (markdown str)
  summarise_workspace   params: focus (str, optional topic to focus on)
  search_web            params: query (str)
  organise_notes        params: (none required)
  suggest_title         params: note_id (int), current_title (str)
  extract_tasks         params: (none required - scans all context notes)
  prepare_report_outline params: topic (str), sections (list[str], optional)

Return ONLY valid JSON:
{
  "understanding": "Plain-English summary of what I understand the user wants to achieve.",
  "actions": [
    {"id":"a1","type":"...","label":"Short human-readable action description","preview":"Short outcome e.g. ⏰ due 2026-06-06","params":{...}},
    ...
  ]
}

Rules:
- Propose only actions that make sense for this specific request.
- If creating multiple reminders, give each a separate action entry.
- Keep labels concise (max 80 chars).
- Keep preview very short (max 40 chars).
- Use today's date as a reference for relative date expressions.
- Limit to at most 8 actions total."""


class WorkflowService:
    def __init__(
        self,
        conv_repo: ConversationRepository,
        note_repo: NoteRepository,
        reminder_repo: ReminderRepository,
        embedding_service: Optional[EmbeddingService] = None,
    ):
        self._notes    = note_repo
        self._convs    = conv_repo
        self._reminders = reminder_repo
        self._embed    = embedding_service or EmbeddingService()
        self._client   = OpenAI(api_key=settings.openai_api_key)

    # ── Suggest ───────────────────────────────────────────────────────────────

    def suggest(
        self,
        message: str,
        workspace_id: Optional[int],
        user_id: int,
        user_message: Optional[str] = None,
    ) -> list[WorkflowAction]:
        """
        Analyse an AI response and return 0–3 suggested quick actions.
        Called automatically after every chat response when workflow is enabled.
        Uses a cheap GPT call; returns empty list when nothing actionable is found.
        """
        if len(message.strip()) < 80:
            return []

        _OPENAI_PREFIXES = ("gpt-", "o1-", "o3-", "o4-")
        model = settings.openai_chat_model
        if not any(model.startswith(p) for p in _OPENAI_PREFIXES):
            model = "gpt-4o-mini"

        system = (
            "You analyse an AI assistant exchange and suggest up to 3 quick follow-up actions.\n"
            "Return ONLY valid JSON:\n"
            '{"actions": [\n'
            '  {"id":"a1","type":"create_note","label":"Save as Note","params":{"title":"...","content":"..."}},\n'
            '  {"id":"a2","type":"create_reminder","label":"Add Reminder: Task by Friday","params":{"title":"...","due_date":"YYYY-MM-DD"}},\n'
            '  {"id":"a3","type":"search_web","label":"Search: topic","params":{"query":"..."}}\n'
            ']}\n\n'
            "Rules:\n"
            "- suggest create_note  : response contains a study plan, steps, list, or reference info worth saving\n"
            "- suggest create_reminder : response mentions a deadline, due date, task, or time-sensitive item\n"
            "- suggest search_web   : user asked to search online / look something up / find current info,\n"
            "                         OR the AI response says it cannot browse/search the web,\n"
            "                         OR the response suggests further reading or external sources would help.\n"
            "                         Use the user's actual question as the search query.\n"
            "                         Never use generic placeholder queries like 'specific questions or topics of interest'.\n"
            "- suggest extract_tasks: response contains multiple action items or to-dos\n"
            "- return empty array when response is conversational, a greeting, or simple Q&A (< 3 sentences)\n"
            "- max 3 actions, labels must be short action phrases\n"
            f"- today's date is {__import__('datetime').date.today()}"
        )

        user_block = f"User asked: {user_message}\n\n" if user_message else ""
        resp = self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": f"{user_block}AI response:\n{message[:3000]}"},
            ],
            max_tokens=400,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)
        generic_queries = {
            "specific questions or topics of interest",
            "topic",
            "topics",
            "further reading",
            "external sources",
            "research interests",
        }
        for action in data.get("actions", []):
            if action.get("type") != "search_web":
                continue
            params = action.setdefault("params", {})
            query = str(params.get("query") or "").strip()
            if user_message and (not query or query.lower() in generic_queries or len(query) < 8):
                params["query"] = user_message.strip()
        return [
            WorkflowAction(
                id=a.get("id", f"s{i}"),
                type=a.get("type", ""),
                label=a.get("label", ""),
                preview=a.get("preview", ""),
                params=a.get("params", {}),
            )
            for i, a in enumerate(data.get("actions", []))
            if a.get("type")
        ]

    # ── Phase 1: Plan ──────────────────────────────────────────────────────────

    def plan(
        self,
        user_id: int,
        conversation_id: int,
        prompt: str,
        workspace_id: Optional[int],
        model: Optional[str],
    ) -> WorkflowPlanResponse:
        model = model or settings.openai_chat_model
        _OPENAI_PREFIXES = ("gpt-", "o1-", "o3-", "o4-")
        if not any(model.startswith(p) for p in _OPENAI_PREFIXES):
            model = "gpt-4o-mini"

        # Save user message
        self._convs.add_message(conversation_id, "user", prompt)

        # Silently read notes for context (no approval needed - read-only)
        context_notes = self._read_notes(prompt, user_id, workspace_id)

        # Ask GPT to generate a plan
        resp = self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _PLAN_SYSTEM},
                {"role": "user", "content": f"User request: {prompt}\n\nContext from notes:\n{context_notes}"},
            ],
            max_tokens=1500,
        )
        raw = (resp.choices[0].message.content or "").strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        data = json.loads(raw)

        understanding = data.get("understanding", "")
        actions = [
            WorkflowAction(
                id=a.get("id", f"a{i}"),
                type=a.get("type", ""),
                label=a.get("label", ""),
                preview=a.get("preview", ""),
                params=a.get("params", {}),
            )
            for i, a in enumerate(data.get("actions", []))
            if a.get("type")
        ]

        # Persist plan as a special assistant message for history
        plan_payload = {
            "understanding": understanding,
            "actions": [a.model_dump() for a in actions],
        }
        msg = self._convs.add_message(
            conversation_id, "assistant",
            f"__WORKFLOW_PLAN__:{json.dumps(plan_payload)}",
        )

        return WorkflowPlanResponse(
            message_id=msg.id,
            conversation_id=conversation_id,
            understanding=understanding,
            actions=actions,
        )

    # ── Phase 2: Execute ───────────────────────────────────────────────────────

    def confirm_action(
        self,
        user_id: int,
        conversation_id: int,
        action: WorkflowAction,
        user_message: str,
        workspace_id: Optional[int],
        model: Optional[str],
    ) -> WorkflowConfirmResponse:
        """Execute one suggested action as a normal chat turn and persist both messages."""
        model = self._chat_model(model)
        user_text = (user_message or "Yes").strip()
        user_msg = self._convs.add_message(conversation_id, "user", user_text)

        try:
            result = self._execute_action(action, user_id, workspace_id)
            ok = True
            assistant_text = self._confirmation_reply(action, result, True)
        except Exception as exc:
            result = str(exc)
            ok = False
            assistant_text = self._confirmation_reply(action, result, False)

        assistant_msg = self._convs.add_message(conversation_id, "assistant", assistant_text, model=model)
        return WorkflowConfirmResponse(
            ok=ok,
            result=result,
            user_message=self._message_payload(user_msg),
            assistant_message=self._message_payload(assistant_msg),
        )

    def execute_stream(
        self,
        user_id: int,
        conversation_id: int,
        actions: list[WorkflowAction],
        workspace_id: Optional[int],
        model: Optional[str],
    ) -> Iterator[str]:
        model = self._chat_model(model)
        total = len(actions)
        results: list[str] = []

        yield f"data: {json.dumps({'workflow_start': True, 'total': total})}\n\n"

        for action in actions:
            icon = _ACTION_ICONS.get(action.type, "⚙️")
            yield f"data: {json.dumps({'workflow_step': {'id': action.id, 'label': f'{icon} {action.label}…'}})}\n\n"

            try:
                result = self._execute_action(action, user_id, workspace_id)
                results.append(f"✓ {action.label}: {result}")
                yield f"data: {json.dumps({'workflow_done': {'id': action.id, 'label': f'✓ {action.label}', 'result': result, 'ok': True}})}\n\n"
            except Exception as exc:
                results.append(f"✗ {action.label}: {exc}")
                yield f"data: {json.dumps({'workflow_done': {'id': action.id, 'label': f'✗ {action.label}', 'result': str(exc), 'ok': False}})}\n\n"

        # GPT summary of everything that was done
        summary = self._summarise_results(results, model)
        for chunk in summary:
            yield f"data: {json.dumps({'t': chunk})}\n\n"

        full_text = "".join(summary)
        msg = self._convs.add_message(conversation_id, "assistant", full_text, model=model)
        yield f"data: {json.dumps({'done': True, 'id': msg.id, 'model': model})}\n\n"

    # ── Action executor ────────────────────────────────────────────────────────

    def _execute_action(self, action: WorkflowAction, user_id: int, workspace_id: Optional[int]) -> str:
        p = action.params

        if action.type == "create_reminder":
            self._reminders.create_reminder(
                user_id=user_id,
                text=p.get("title", "Reminder"),
                workspace_id=workspace_id,
                description=p.get("description"),
                reminder_type="ai",
                due_date=p.get("due_date"),
                due_time=p.get("due_time"),
            )
            due = f" - due {p['due_date']}" if p.get("due_date") else ""
            return f"Reminder '{p.get('title', 'Reminder')}'{due} created"

        if action.type == "create_note":
            note = self._notes.create_note(user_id, p["title"], p.get("content", ""), "workflow", workspace_id)
            try:
                vec = self._embed.embed_text(f"{p['title']} {p.get('content','')}"[:2000])
                self._notes.save_embedding(note.id, vec)
            except Exception:
                pass
            self._notes.db.commit()
            return f"Note '{p['title']}' created (ID {note.id})"

        if action.type == "summarise_workspace":
            notes = self._notes.get_for_user(user_id, workspace_id)
            if not notes:
                return "No notes to summarise"
            ctx = "\n\n".join(f"## {n.title}\n{_HTML.sub(' ', n.content or '').strip()[:1500]}" for n in notes[:12])
            focus = p.get("focus", "")
            focus_line = f" Focus on: {focus}." if focus else ""
            resp = self._client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": f"Summarise these notes into a concise markdown document.{focus_line}"},
                    {"role": "user",   "content": ctx},
                ],
                max_tokens=800,
            )
            summary_text = resp.choices[0].message.content or ""
            note = self._notes.create_note(user_id, "Workspace Summary", summary_text, "workflow", workspace_id)
            self._notes.db.commit()
            return f"Summary note created (ID {note.id})"

        if action.type == "search_web":
            query = str(p.get("query") or "").strip()
            web_results = brave_search(query, count=6)
            image_results = brave_image_search(query, count=3)
            if not web_results and not image_results:
                return "No results found"
            parts = []
            if web_results:
                parts.append(web_results)
            if image_results:
                parts.append(image_results)
            return "\n\n".join(parts)

        if action.type == "organise_notes":
            notes = self._notes.get_for_user(user_id, workspace_id)
            if not notes:
                return "No notes to organise"
            listing = "\n".join(f"- ID {n.id}: {n.title or 'Untitled'}" for n in notes)
            resp = self._client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": "Suggest category labels for these notes. Return markdown with sections."},
                    {"role": "user",   "content": listing},
                ],
                max_tokens=600,
            )
            outline = resp.choices[0].message.content or ""
            note = self._notes.create_note(user_id, "Note Organisation Map", outline, "workflow", workspace_id)
            self._notes.db.commit()
            return f"Organisation map created (ID {note.id})"

        if action.type == "suggest_title":
            note_id = p.get("note_id")
            note = self._notes.get_by_id(note_id) if note_id else None
            if not note:
                return "Note not found"
            content_preview = _HTML.sub(" ", note.content or "").strip()[:800]
            resp = self._client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": "Suggest a concise, descriptive title for this note. Return only the title text."},
                    {"role": "user",   "content": content_preview},
                ],
                max_tokens=40,
            )
            new_title = (resp.choices[0].message.content or "").strip().strip('"')
            self._notes.update_note(note_id, new_title, None)
            return f"Title updated to: {new_title}"

        if action.type == "extract_tasks":
            notes = self._notes.get_for_user(user_id, workspace_id)
            if not notes:
                return "No notes to scan"
            ctx = "\n\n".join(f"## {n.title}\n{_HTML.sub(' ', n.content or '').strip()[:1500]}" for n in notes[:10])
            resp = self._client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": "Extract all action items, tasks, and to-dos from these notes. Format as a markdown checklist."},
                    {"role": "user",   "content": ctx},
                ],
                max_tokens=600,
            )
            tasks_text = resp.choices[0].message.content or ""
            note = self._notes.create_note(user_id, "Extracted Tasks", tasks_text, "workflow", workspace_id)
            self._notes.db.commit()
            return f"Tasks note created (ID {note.id})"

        if action.type == "prepare_report_outline":
            topic = p.get("topic", "")
            sections = p.get("sections", [])
            ctx = self._read_notes(topic, user_id, workspace_id)
            sec_hint = f"\nSections to include: {', '.join(sections)}" if sections else ""
            resp = self._client.chat.completions.create(
                model=settings.openai_chat_model,
                messages=[
                    {"role": "system", "content": f"Create a structured report outline for: {topic}.{sec_hint} Use notes as source material. Format in markdown."},
                    {"role": "user",   "content": ctx},
                ],
                max_tokens=700,
            )
            outline = resp.choices[0].message.content or ""
            title = f"Report Outline: {topic}" if topic else "Report Outline"
            note = self._notes.create_note(user_id, title, outline, "workflow", workspace_id)
            self._notes.db.commit()
            return f"Report outline created (ID {note.id})"

        raise ValueError(f"Unknown action type: {action.type}")

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _chat_model(self, model: Optional[str]) -> str:
        model = model or settings.openai_chat_model
        _OPENAI_PREFIXES = ("gpt-", "o1-", "o3-", "o4-")
        if not any(model.startswith(p) for p in _OPENAI_PREFIXES):
            return "gpt-4o-mini"
        return model

    def _message_payload(self, msg) -> WorkflowChatMessage:
        return WorkflowChatMessage(
            id=msg.id,
            role=msg.role,
            content=msg.content,
            model=msg.model,
        )

    def _confirmation_reply(self, action: WorkflowAction, result: str, ok: bool) -> str:
        if not ok:
            return f"I tried to run **{action.label}**, but it failed: {result}"

        p = action.params or {}
        if action.type == "create_note":
            title = p.get("title") or "the note"
            return f"Successfully saved that as a note: **{title}**."
        if action.type == "create_reminder":
            title = p.get("title") or "the reminder"
            due = f" for {p.get('due_date')}" if p.get("due_date") else ""
            return f"Successfully added the reminder **{title}**{due}."
        if action.type == "extract_tasks":
            return "Successfully extracted the tasks and saved them as a checklist note."
        if action.type == "summarise_workspace":
            return "Successfully created a workspace summary note."
        if action.type == "organise_notes":
            return "Successfully created a note organisation map."
        if action.type == "prepare_report_outline":
            return "Successfully created the report outline note."
        if action.type == "suggest_title":
            return f"Successfully updated the note title. {result}"
        if action.type == "search_web":
            return f"Here is what I found:\n\n{result}"
        return f"Successfully completed **{action.label}**. {result}"

    def _read_notes(self, query: str, user_id: int, workspace_id: Optional[int]) -> str:
        try:
            vec = self._embed.embed_text(query)
            notes = self._notes.search_by_vector(vec, top_k=6, workspace_id=workspace_id)
        except Exception:
            notes = self._notes.get_for_user(user_id, workspace_id)[:6]
        if not notes:
            return "(no notes found in this workspace)"
        return "\n\n".join(
            f"[NOTE {n.id}: {n.title or 'Untitled'}]\n{_HTML.sub(' ', n.content or '').strip()[:800]}"
            for n in notes
        )

    def _summarise_results(self, results: list[str], model: str) -> list[str]:
        if not results:
            return ["No actions were executed."]
        lines = "\n".join(results)
        resp = self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Write a brief, friendly 1–2 sentence summary of these completed workflow actions."},
                {"role": "user",   "content": lines},
            ],
            max_tokens=120,
            stream=True,
        )
        for chunk in resp:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield delta
