import json
import re
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterator, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from memolink_backend.core.config import settings
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.conversation_repository import ConversationRepository
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.business.services.embedding_service import EmbeddingService
from memolink_backend.contracts.slash_command_dtos import SlashCommandRequestDTO

logger = logging.getLogger(__name__)

# ── Command parser ─────────────────────────────────────────────────────────────

@dataclass
class ParsedCommand:
    raw: str
    command: str          # lowercase, e.g. "improve"
    target: Optional[str] # note name or None
    is_all: bool
    instruction: Optional[str]  # after " : "


def _parse(text: str) -> Optional[ParsedCommand]:
    text = text.strip()
    if not text.startswith("/"):
        return None
    rest = text[1:].strip()
    parts = rest.split(None, 1)
    if not parts:
        return None
    command = parts[0].lower()
    args = parts[1].strip() if len(parts) > 1 else ""

    # Split instruction after " : "
    instruction = None
    if " : " in args:
        target_part, instruction = args.split(" : ", 1)
        instruction = instruction.strip()
    else:
        target_part = args

    target_part = target_part.strip()

    if target_part.lower() == "all":
        return ParsedCommand(raw=text, command=command, target=None, is_all=True, instruction=instruction)

    # Quoted target — unquote. Any text after the closing quote becomes the
    # instruction, e.g.  /Discussion "My Note" how do we improve this?
    if target_part and target_part[0] in ('"', "'"):
        q = target_part[0]
        end = target_part.find(q, 1)
        if end != -1:
            trailing = target_part[end + 1:].strip()
            target_part = target_part[1:end].strip()
            if trailing and not instruction:
                instruction = trailing

    return ParsedCommand(raw=text, command=command, target=target_part or None, is_all=False, instruction=instruction)


# ── OpenAI client helper (reuses chat_service pattern) ────────────────────────

_GEMINI_MODELS = {"gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"}
_DEEPSEEK_MODELS = {"deepseek-chat", "deepseek-reasoner", "deepseek-coder"}
_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
_MODEL_ALIASES = {
    "gemini-2.0-flash": "gemini-2.5-flash",
    "gemini-2.0-flash-lite": "gemini-2.5-flash-lite",
    "gemini-1.5-flash-8b": "gemini-2.5-flash-lite",
    "gemini-1.5-pro": "gemini-2.5-pro",
}


def _canonical_model(model: str) -> str:
    return _MODEL_ALIASES.get(model, model)


def _get_client(model: str, user_keys: dict | None = None) -> OpenAI:
    model = _canonical_model(model)
    keys = user_keys or {}
    if model in keys:
        cfg = keys[model]
        return OpenAI(api_key=cfg["key"], base_url=cfg.get("base_url") or None)
    if model in _GEMINI_MODELS:
        return OpenAI(api_key=settings.gemini_api_key, base_url=_GEMINI_BASE_URL)
    if model in _DEEPSEEK_MODELS:
        return OpenAI(api_key=settings.deepseek_api_key, base_url=_DEEPSEEK_BASE_URL)
    return OpenAI(api_key=settings.openai_api_key)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ── Service ────────────────────────────────────────────────────────────────────

class SlashCommandService:
    def __init__(
        self,
        note_repo: NoteRepository,
        conv_repo: ConversationRepository,
        embedding_service: EmbeddingService,
        db: Session,
        log_service=None,
        user_api_key_repo=None,
    ):
        self.note_repo = note_repo
        self.conv_repo = conv_repo
        self.embedding = embedding_service
        self.db = db
        self._log = log_service
        self._user_api_key_repo = user_api_key_repo

    # ── helpers ───────────────────────────────────────────────────────────────

    def _resolve_user_keys(self, user_id: int | None) -> dict:
        if not user_id or not self._user_api_key_repo:
            return {}
        try:
            return self._user_api_key_repo.get_all_decrypted(user_id)
        except Exception:
            return {}

    def _ai(self, model: str, messages: list, user_id: int | None) -> str:
        user_keys = self._resolve_user_keys(user_id)
        chain = [_canonical_model(model), settings.openai_chat_model]
        for m in chain:
            try:
                return _get_client(m, user_keys).chat.completions.create(
                    model=m, messages=messages
                ).choices[0].message.content or ""
            except Exception:
                continue
        return ""

    def _update_note(self, note, new_content: str, command: str, instruction: str | None):
        """Save undo snapshot, update content, regenerate embedding."""
        self.note_repo.save_undo_snapshot(note.id, note.title, note.content, command, instruction)
        self.note_repo.update_note(note.id, None, new_content)
        try:
            vector = self.embedding.embed_text(new_content)
            self.note_repo.save_embedding(note.id, vector)
            self.db.commit()
        except Exception:
            pass

    def _not_found(self, name: str) -> str:
        return f'Could not find a note matching **"{name}"**. Check the title and try again.'

    def _requires_target(self, cmd: str) -> str:
        return f'`/{cmd}` requires a note name. Example: `/{cmd.capitalize()} "My Note"`'

    def _requires_instruction(self, cmd: str) -> str:
        return f'`/{cmd}` requires an instruction after ` : `. Example: `/{cmd.capitalize()} "My Note" : your instruction`'

    # ── entry point ───────────────────────────────────────────────────────────

    def execute_stream(self, dto: SlashCommandRequestDTO) -> Iterator[str]:
        parsed = _parse(dto.command)
        if not parsed:
            yield _sse({"t": "Invalid command. Type `/` to see available commands."})
            yield _sse({"done": True})
            return

        # Ensure conversation exists
        if dto.conversation_id is None:
            conv = self.conv_repo.create_conversation(dto.user_id, dto.command[:60], workspace_id=dto.workspace_id)
            conv_id = conv.id
        else:
            conv_id = dto.conversation_id

        self.conv_repo.add_message(conv_id, "user", dto.command)

        model = dto.model or settings.openai_chat_model
        full_text = ""

        try:
            for chunk in self._route(parsed, dto, conv_id, model):
                if chunk.startswith("data: "):
                    try:
                        payload = json.loads(chunk[6:])
                        if "t" in payload:
                            full_text += payload["t"]
                        elif "replace" in payload:
                            full_text = payload["replace"]
                        elif "quiz" in payload:
                            full_text = f"__QUIZ__:{json.dumps(payload['quiz'])}"
                    except Exception:
                        pass
                yield chunk
        except Exception as exc:
            msg = f"Command failed: {exc}"
            yield _sse({"t": msg})
            full_text = msg

        assistant_msg = self.conv_repo.add_message(conv_id, "assistant", full_text)
        yield _sse({"done": True, "id": assistant_msg.id, "conversation_id": conv_id})

    def _route(self, p: ParsedCommand, dto: SlashCommandRequestDTO, conv_id: int, model: str) -> Iterator[str]:
        c = p.command
        if c == "improve":
            yield from self._cmd_improve(p, dto, model)
        elif c == "enhance":
            yield from self._cmd_enhance(p, dto, model)
        elif c == "summarize":
            yield from self._cmd_summarize(p, dto, model)
        elif c in ("natural", "humanize"):
            yield from self._cmd_natural(p, dto, model)
        elif c == "update":
            yield from self._cmd_update(p, dto, model)
        elif c == "add":
            yield from self._cmd_add(p, dto, model)
        elif c == "undo":
            yield from self._cmd_undo(p, dto)
        elif c == "reminder":
            yield from self._cmd_reminder(p, dto)
        elif c == "quiz":
            yield from self._cmd_quiz(p, dto, model)
        elif c == "discussion":
            yield from self._cmd_discussion(p, dto, model)
        elif c == "read":
            yield from self._cmd_read(p, dto)
        elif c == "feedback":
            yield from self._cmd_feedback(p, dto, "suggestion")
        elif c == "reportbug":
            yield from self._cmd_feedback(p, dto, "bug")
        else:
            yield _sse({"t": f'Unknown command `/{p.command}`. Type `/` to see available commands.'})

    # ── /Improve ──────────────────────────────────────────────────────────────

    def _improve_one(self, note, dto: SlashCommandRequestDTO, model: str, verb: str, sys_prompt: str) -> Iterator[str]:
        yield _sse({"cmd_running": f"{verb.capitalize()}ing **{note.title}**…"})
        plain = re.sub(r"<[^>]+>", " ", note.content).strip()
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": f"Note title: {note.title}\n\nContent:\n{plain[:6000]}"},
        ]
        improved = self._ai(model, messages, dto.user_id)
        if improved:
            self._update_note(note, improved, verb, None)
            yield _sse({"note_updated": note.id})
            yield _sse({"t": f"**{note.title}** has been {verb}d and saved.\n\n"})
        else:
            yield _sse({"t": f"Could not {verb} **{note.title}** — AI unavailable.\n\n"})

    def _cmd_improve(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        sys_prompt = (
            "You are a document editor. Improve the grammar, clarity, structure, and Markdown formatting of the given note. "
            "Rules: preserve all original meaning and information; do not add new information; "
            "do not remove names, dates, requirements, decisions, citations, or action items; "
            "format as clean Markdown with proper headings, lists, and emphasis. "
            "Return ONLY the improved Markdown content."
        )
        if p.is_all:
            notes = self.note_repo.get_for_user(dto.user_id, dto.workspace_id)
            if not notes:
                yield _sse({"t": "No notes found in this workspace."})
                return
            yield _sse({"t": f"Improving {len(notes)} notes…\n\n"})
            for note in notes:
                yield from self._improve_one(note, dto, model, "improve", sys_prompt)
        else:
            if not p.target:
                yield _sse({"t": self._requires_target("improve")})
                return
            note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
            if not note:
                yield _sse({"t": self._not_found(p.target)})
                return
            yield from self._improve_one(note, dto, model, "improve", sys_prompt)

    # ── /Enhance ──────────────────────────────────────────────────────────────

    def _cmd_enhance(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        sys_prompt = (
            "You are a document editor. Enhance the given note by improving AND expanding it. "
            "Rules: preserve all original information; improve grammar, structure, headings, flow, and Markdown formatting; "
            "add helpful explanations, examples, transitions, or missing context where appropriate; "
            "do not fabricate facts, citations, or unsupported claims. "
            "Return ONLY the enhanced Markdown content."
        )
        if p.is_all:
            notes = self.note_repo.get_for_user(dto.user_id, dto.workspace_id)
            if not notes:
                yield _sse({"t": "No notes found in this workspace."})
                return
            yield _sse({"t": f"Enhancing {len(notes)} notes…\n\n"})
            for note in notes:
                yield from self._improve_one(note, dto, model, "enhance", sys_prompt)
        else:
            if not p.target:
                yield _sse({"t": self._requires_target("enhance")})
                return
            note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
            if not note:
                yield _sse({"t": self._not_found(p.target)})
                return
            yield from self._improve_one(note, dto, model, "enhance", sys_prompt)

    # ── /Summarize ────────────────────────────────────────────────────────────

    def _cmd_summarize(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        if p.is_all:
            notes = self.note_repo.get_for_user(dto.user_id, dto.workspace_id)
            if not notes:
                yield _sse({"t": "No notes found in this workspace."})
                return
            combined = "\n\n---\n\n".join(
                f"## {n.title or 'Untitled'}\n{re.sub(r'<[^>]+>', ' ', n.content).strip()[:3000]}"
                for n in notes
            )
            title = f"Summary - All Notes - {datetime.now().strftime('%Y-%m-%d')}"
            sys_prompt = "Summarize all the provided notes into one concise Markdown document. Include key points, decisions, action items, deadlines, and important dates. Use ## headings per topic. Format as clean Markdown."
            messages = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": combined[:8000]}]
        else:
            if not p.target:
                yield _sse({"t": self._requires_target("summarize")})
                return
            note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
            if not note:
                yield _sse({"t": self._not_found(p.target)})
                return
            title = f"Summary - {note.title}"
            plain = re.sub(r"<[^>]+>", " ", note.content).strip()
            sys_prompt = "Summarize the given note concisely. Include key points, decisions, action items, deadlines, and important dates. Format as clean Markdown."
            messages = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": f"Note title: {note.title}\n\n{plain[:6000]}"}]

        yield _sse({"cmd_running": "Generating summary…"})
        summary = self._ai(model, messages, dto.user_id)
        if not summary:
            yield _sse({"t": "⚠ Failed to generate summary — AI unavailable."})
            return

        new_note = self.note_repo.create_note(dto.user_id, title, summary, "slash_command", dto.workspace_id)
        self.db.commit()
        try:
            vector = self.embedding.embed_text(summary)
            self.note_repo.save_embedding(new_note.id, vector)
            self.db.commit()
        except Exception:
            pass
        yield _sse({"t": f"✅ Summary note created: **{title}**\n\n[[NOTE_LINK:{new_note.id}:{title}]]"})

    # ── /Natural & /Humanize ──────────────────────────────────────────────────

    def _cmd_natural(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        if not p.target:
            yield _sse({"t": self._requires_target(p.command)})
            return
        note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
        if not note:
            yield _sse({"t": self._not_found(p.target)})
            return
        sys_prompt = (
            "Rewrite the given note in a more natural, readable style. "
            "Rules: preserve the original meaning; keep citations, names, dates, numbers, and technical terms accurate; "
            "do not add unsupported information; format as clean Markdown. "
            "Return ONLY the rewritten Markdown content."
        )
        plain = re.sub(r"<[^>]+>", " ", note.content).strip()
        messages = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": f"Note title: {note.title}\n\n{plain[:6000]}"}]
        yield _sse({"cmd_running": f"Rewriting **{note.title}** naturally…"})
        result = self._ai(model, messages, dto.user_id)
        if result:
            self._update_note(note, result, p.command, None)
            yield _sse({"note_updated": note.id})
            yield _sse({"t": f"**{note.title}** has been rewritten naturally and saved."})
        else:
            yield _sse({"t": "Could not rewrite note — AI unavailable."})

    # ── /Update ───────────────────────────────────────────────────────────────

    def _cmd_update(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        if not p.target:
            yield _sse({"t": self._requires_target("update")})
            return
        if not p.instruction:
            yield _sse({"t": self._requires_instruction("update")})
            return
        note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
        if not note:
            yield _sse({"t": self._not_found(p.target)})
            return
        plain = re.sub(r"<[^>]+>", " ", note.content).strip()
        sys_prompt = (
            "Update the given note using the user's instruction. "
            "Read the existing note, interpret the instruction, decide the best place for the new content, "
            "and merge it naturally. Preserve all existing important content. "
            "Improve formatting to clean Markdown. Return ONLY the updated Markdown content."
        )
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": f"Note title: {note.title}\n\nExisting content:\n{plain[:5000]}\n\nInstruction: {p.instruction}"},
        ]
        yield _sse({"cmd_running": f"Updating **{note.title}**…"})
        result = self._ai(model, messages, dto.user_id)
        if result:
            self._update_note(note, result, "update", p.instruction)
            yield _sse({"note_updated": note.id})
            yield _sse({"t": f"**{note.title}** has been updated and saved."})
        else:
            yield _sse({"t": "Could not update note — AI unavailable."})

    # ── /Add ──────────────────────────────────────────────────────────────────

    def _cmd_add(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        if not p.target:
            yield _sse({"t": self._requires_target("add")})
            return
        if not p.instruction:
            yield _sse({"t": self._requires_instruction("add")})
            return
        note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
        if not note:
            yield _sse({"t": self._not_found(p.target)})
            return
        plain = re.sub(r"<[^>]+>", " ", note.content).strip()
        sys_prompt = (
            "Add new content to the most appropriate section of the given note. "
            "Preserve all existing content. If no suitable section exists, create one near the end. "
            "Improve grammar and Markdown formatting. Do not rewrite the whole note unless necessary. "
            "Return ONLY the updated Markdown content."
        )
        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": f"Note title: {note.title}\n\nExisting content:\n{plain[:5000]}\n\nContent to add: {p.instruction}"},
        ]
        yield _sse({"cmd_running": f"Adding content to **{note.title}**…"})
        result = self._ai(model, messages, dto.user_id)
        if result:
            self._update_note(note, result, "add", p.instruction)
            yield _sse({"note_updated": note.id})
            yield _sse({"t": f"Content added to **{note.title}** and saved."})
        else:
            yield _sse({"t": "Could not add content — AI unavailable."})

    # ── /Undo ─────────────────────────────────────────────────────────────────

    def _cmd_undo(self, p: ParsedCommand, dto: SlashCommandRequestDTO) -> Iterator[str]:
        if not p.target:
            yield _sse({"t": self._requires_target("undo")})
            return
        note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
        if not note:
            yield _sse({"t": self._not_found(p.target)})
            return
        if not getattr(note, "undo_available", False):
            yield _sse({"t": f"No undo version is available for **{note.title}**."})
            return
        restored_title = note.undo_title
        restored_content = note.undo_content
        self.note_repo.update_note(note.id, restored_title, restored_content)
        self.note_repo.clear_undo_snapshot(note.id)
        try:
            vector = self.embedding.embed_text(restored_content)
            self.note_repo.save_embedding(note.id, vector)
            self.db.commit()
        except Exception:
            pass
        yield _sse({"note_updated": note.id})
        yield _sse({"t": f"✅ **{restored_title or note.title}** has been restored to its previous version."})

    # ── /Reminder ─────────────────────────────────────────────────────────────

    def _cmd_reminder(self, p: ParsedCommand, dto: SlashCommandRequestDTO) -> Iterator[str]:
        title = p.target
        date_str = p.instruction
        if not title:
            yield _sse({"t": 'Usage: `/Reminder title : YYYY-MM-DD HH:MM`'})
            return
        due_date = None
        due_time = None
        if date_str:
            # Try to parse date and time
            dt_match = re.search(r"(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})?", date_str)
            if dt_match:
                due_date = dt_match.group(1)
                due_time = dt_match.group(2)
            else:
                yield _sse({"t": f"Could not parse date/time from `{date_str}`. Please use format `YYYY-MM-DD HH:MM`."})
                return
        else:
            yield _sse({"t": "Please specify a date and time. Example: `/Reminder Submit draft : 2026-06-05 18:00`"})
            return
        reminder = Reminder(
            user_id=dto.user_id,
            workspace_id=dto.workspace_id,
            text=title,
            type="manual",
            done=False,
            due_date=due_date,
            due_time=due_time,
        )
        self.db.add(reminder)
        self.db.commit()
        time_str = f" at {due_time}" if due_time else ""
        yield _sse({"t": f"✅ Reminder set: **{title}** on {due_date}{time_str}."})

    # ── /Quiz ─────────────────────────────────────────────────────────────────

    def _cmd_quiz(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        count = 10
        if p.instruction:
            try:
                count = int(p.instruction.strip())
            except ValueError:
                pass
        count = max(1, min(count, 30))

        if p.is_all:
            notes = self.note_repo.get_for_user(dto.user_id, dto.workspace_id)
            if not notes:
                yield _sse({"t": "No notes found in this workspace."})
                return
            quiz_title = "Quiz - All Notes"
            context = "\n\n---\n\n".join(
                f"## {n.title or 'Untitled'}\n{re.sub(r'<[^>]+>', ' ', n.content).strip()[:2000]}"
                for n in notes[:10]
            )
        else:
            if not p.target:
                yield _sse({"t": self._requires_target("quiz")})
                return
            note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
            if not note:
                yield _sse({"t": self._not_found(p.target)})
                return
            quiz_title = f"Quiz - {note.title}"
            context = re.sub(r"<[^>]+>", " ", note.content).strip()[:6000]

        yield _sse({"cmd_running": f"Generating {count}-question quiz…"})

        sys_prompt = f"""Generate a quiz with exactly {count} questions based on the given notes.
Return ONLY valid JSON (no markdown fences):
{{
  "title": "{quiz_title}",
  "questions": [
    {{
      "id": 1,
      "type": "single",
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correct": [0],
      "explanation": "..."
    }}
  ]
}}
Use "single" for one correct answer (radio button), "multi" for multiple correct answers (checkbox).
Base questions ONLY on the provided notes. Do not invent facts not in the notes."""

        messages = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": context}]
        raw = self._ai(model, messages, dto.user_id)
        if not raw:
            yield _sse({"t": "⚠ Failed to generate quiz — AI unavailable."})
            return

        try:
            # Strip markdown fences if AI added them anyway
            raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
            raw = re.sub(r"\s*```$", "", raw)
            quiz_data = json.loads(raw)
            yield _sse({"quiz": quiz_data})
        except Exception:
            yield _sse({"t": "⚠ Failed to parse quiz response. Please try again."})

    # ── /Discussion ───────────────────────────────────────────────────────────

    def _cmd_discussion(self, p: ParsedCommand, dto: SlashCommandRequestDTO, model: str) -> Iterator[str]:
        if p.is_all:
            notes = self.note_repo.get_for_user(dto.user_id, dto.workspace_id)
            if not notes:
                yield _sse({"t": "No notes found in this workspace."})
                return
            context = "\n\n---\n\n".join(
                f"## {n.title or 'Untitled'}\n{re.sub(r'<[^>]+>', ' ', n.content).strip()[:2000]}"
                for n in notes[:8]
            )
            topic = "All Notes"
        else:
            if not p.target:
                yield _sse({"t": self._requires_target("discussion")})
                return
            note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
            if not note:
                yield _sse({"t": self._not_found(p.target)})
                return
            context = re.sub(r"<[^>]+>", " ", note.content).strip()[:6000]
            topic = note.title

        # Server-configured participants
        discussion_models: list[tuple[str, str]] = [
            ("GPT", settings.openai_chat_model),
        ]
        if settings.gemini_api_key:
            discussion_models.append(("Gemini", "gemini-2.5-flash"))
        if settings.deepseek_api_key:
            discussion_models.append(("DeepSeek", "deepseek-chat"))

        # User's custom providers — add any not already in the list
        user_keys_named: dict[str, dict] = {}
        if dto.user_id and self._user_api_key_repo:
            try:
                user_keys_named = self._user_api_key_repo.get_all_decrypted_with_names(dto.user_id)
            except Exception:
                pass

        existing_model_ids = {m for _, m in discussion_models}
        for model_id, info in user_keys_named.items():
            if model_id not in existing_model_ids:
                discussion_models.append((info.get("name", model_id), model_id))
                existing_model_ids.add(model_id)

        # Strip names for _get_client (it only needs key + base_url)
        user_keys = {m: {"key": v["key"], "base_url": v.get("base_url")} for m, v in user_keys_named.items()}

        if not discussion_models:
            yield _sse({"t": "No discussion models are configured."})
            return

        # The discussion goal is whatever the user asked after the note name,
        # e.g.  /Discussion "Chat Snippet" how do we improve this?
        question = (p.instruction or "How can this note be improved? Suggest concrete, specific improvements.").strip()

        base_sys = (
            "You are {name}, collaborating with other AI models to reach ONE agreed answer to the user's request "
            "about a note. Read the note and the discussion so far, then contribute concretely — build on or "
            "respectfully challenge the others' points and move the group toward consensus. Keep your contribution "
            "to 3-5 sentences. End your message with a tag on its own line: write [AGREE] if you fully support the "
            "current best approach with no further changes, or [REFINE] if you still want changes."
            f"\n\nUser's request: {question}\n\nNote ({topic}):\n{context}"
        )

        yield _sse({"t": f"## Discussion: {topic}\n\n"})
        yield _sse({"t": f"*Goal:* {question}\n\n"})

        MAX_ROUNDS = 4
        # With multiple models, require at least one round where everyone has seen
        # the others before accepting consensus; a lone model agrees after round 1.
        min_rounds = 1 if len(discussion_models) == 1 else 2

        transcript = ""
        agreed = False
        round_num = 0
        while round_num < MAX_ROUNDS and not agreed:
            round_num += 1
            yield _sse({"t": f"### Round {round_num}\n\n"})
            round_agrees: list[bool] = []
            for name, disc_model in discussion_models:
                yield _sse({"t": f"**{name}:** "})
                user_msg = (
                    f"Discussion so far:\n{transcript[-8000:] or '(no one has spoken yet — you are first)'}\n\n"
                    f"Contribute your view as {name} (round {round_num})."
                )
                try:
                    resp = _get_client(disc_model, user_keys).chat.completions.create(
                        model=disc_model,
                        messages=[
                            {"role": "system", "content": base_sys.format(name=name)},
                            {"role": "user", "content": user_msg},
                        ],
                    ).choices[0].message.content or ""
                except Exception as exc:
                    resp = f"*(unavailable: {exc})* [AGREE]"
                up = resp.upper()
                agrees = "[AGREE]" in up and "[REFINE]" not in up
                round_agrees.append(agrees)
                clean = re.sub(r"\[(AGREE|REFINE)\]", "", resp, flags=re.IGNORECASE).strip()
                stance = "✅ agrees" if agrees else "✎ wants changes"
                yield _sse({"t": f"{clean}\n\n_{stance}_\n\n"})
                transcript += f"\n{name}: {clean}\n"
            if round_agrees and all(round_agrees) and round_num >= min_rounds:
                agreed = True

        # Final conclusion — the agreed best approach
        yield _sse({"t": "## Conclusion — Best Approach\n\n"})
        if agreed:
            yield _sse({"t": f"*The models reached agreement after {round_num} round(s).*\n\n"})
        else:
            yield _sse({"t": f"*No full consensus after {round_num} rounds — summarising the strongest points.*\n\n"})
        synth_model = discussion_models[0][1]
        synth_prompt = (
            f"User's request: {question}\n\nNote: {topic}\n\nFull discussion:\n{transcript[-12000:]}\n\n"
            "Write the final conclusion that directly answers the user's request, synthesising the strongest "
            "agreed points into a clear, actionable recommendation. Use concise Markdown bullet points. "
            "Do not include any [AGREE] or [REFINE] tags."
        )
        try:
            synth = _get_client(synth_model, user_keys).chat.completions.create(
                model=synth_model,
                messages=[{"role": "user", "content": synth_prompt}],
            ).choices[0].message.content or ""
            yield _sse({"t": synth})
        except Exception:
            pass

    # ── /Read ─────────────────────────────────────────────────────────────────

    def _cmd_read(self, p: ParsedCommand, dto: SlashCommandRequestDTO) -> Iterator[str]:
        if not p.target:
            yield _sse({"t": self._requires_target("read")})
            return
        note = self.note_repo.find_by_title_for_user(dto.user_id, p.target, dto.workspace_id)
        if not note:
            yield _sse({"t": self._not_found(p.target)})
            return
        plain = re.sub(r"<[^>]+>", " ", note.content).strip()
        yield _sse({"open_note": note.id})
        yield _sse({"t": f"## {note.title or 'Untitled'}\n\n{plain}"})
        # Send plain text for browser text-to-speech (strip markdown symbols)
        speak_text = re.sub(r"[#*_`~>]", "", plain).strip()
        title_text = note.title or "Untitled"
        yield _sse({"speak": f"{title_text}. {speak_text}"})

    # ── /Feedback & /ReportBug ────────────────────────────────────────────────

    def _cmd_feedback(self, p: ParsedCommand, dto: SlashCommandRequestDTO, fb_type: str) -> Iterator[str]:
        title = p.target
        message = p.instruction
        if not title or not message:
            cmd = "feedback" if fb_type == "suggestion" else "reportbug"
            yield _sse({"t": f'Usage: `/{cmd.capitalize()} title : message`'})
            return
        from sqlalchemy import text as sql_text
        self.db.execute(
            sql_text("INSERT INTO feedback (user_id, type, title, message, status) VALUES (:uid, :type, :title, :msg, 'open')"),
            {"uid": dto.user_id, "type": fb_type, "title": title[:200], "msg": message},
        )
        self.db.commit()
        label = "Bug report" if fb_type == "bug" else "Feedback"
        yield _sse({"t": f"✅ {label} submitted: **{title}**\n\nThank you! The team will review it."})
