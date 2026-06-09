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
_ACTION_CONNECTOR_RE = re.compile(
    r"\b(?:github|jira)\b.*\b(?:issue|issues|ticket|tickets|branch|development|develop|repo|repository|pr|pull request|merge|comment)\b"
    r"|\b(?:issue|issues|ticket|tickets)\b.*\b(?:github|jira)\b"
    r"|\b(?:pull request|pr)\b.*\b(?:github|repo|repository|branch)\b"
    r"|\b(?:create|add|update|edit|check|show|list|open|close|move|transition|start|comment|merge)\b.*\b(?:ticket|tickets|issue|issues|pull request|pr|branch|repo|repository)\b"
    r"|\bstart development\b|\bcreate branch\b",
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
    {
        "type": "function",
        "function": {
            "name": "github_ticket_action",
            "description": "Work with GitHub repositories, branches, issues, pull requests, comments, and merge workflows.",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["repo", "list_branches", "list", "get", "create", "update", "comment", "list_comments", "list_pull_requests", "get_pull_request", "find_pull_request", "create_pull_request", "update_pull_request", "merge_pull_request", "start_development"]},
                    "repo": {"type": "string", "description": "Repository in owner/repo format. Optional if a default repo is configured."},
                    "issue_number": {"type": "integer", "description": "Issue number for get, update, or start_development"},
                    "pull_number": {"type": "integer", "description": "Pull request number for get, update, comment, or merge operations"},
                    "query": {"type": "string", "description": "Search text for listing relevant issues"},
                    "title": {"type": "string", "description": "Issue title for create or update"},
                    "body": {"type": "string", "description": "Issue description or update body"},
                    "state": {"type": "string", "enum": ["open", "closed"], "description": "Issue state for update or list"},
                    "labels": {"type": "array", "items": {"type": "string"}},
                    "assignees": {"type": "array", "items": {"type": "string"}},
                    "branch_name": {"type": "string", "description": "Branch name to create for start_development"},
                    "base_branch": {"type": "string", "description": "Optional source branch for start_development"},
                    "head_branch": {"type": "string", "description": "Source branch for pull request creation or lookup"},
                    "title_query": {"type": "string", "description": "Optional text for finding a pull request by title"},
                    "draft": {"type": "boolean", "description": "Whether the pull request should be created as a draft"},
                    "merge_method": {"type": "string", "enum": ["merge", "squash", "rebase"], "description": "GitHub merge method for merge_pull_request"},
                    "comment": {"type": "string", "description": "Comment body to add to an issue or pull request"},
                },
                "required": ["operation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "jira_ticket_action",
            "description": "Check Jira tickets, create a ticket, update it, comment on it, or move it to a new workflow status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["search", "get", "create", "update", "transition", "list_transitions", "comment", "list_comments"]},
                    "issue_key": {"type": "string", "description": "Jira issue key such as PROJ-123"},
                    "jql": {"type": "string", "description": "Optional Jira query when searching"},
                    "project_key": {"type": "string", "description": "Project key for create"},
                    "summary": {"type": "string", "description": "Issue summary for create or update"},
                    "description": {"type": "string", "description": "Issue description for create or update"},
                    "issue_type": {"type": "string", "description": "Issue type name for create, such as Task or Story"},
                    "status_name": {"type": "string", "description": "Target Jira workflow status for transition"},
                    "comment": {"type": "string", "description": "Comment to add to the Jira issue"},
                },
                "required": ["operation"],
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
    "github_ticket_action": "Working with GitHub",
    "jira_ticket_action": "Working with Jira",
}

_SYSTEM_PROMPT = (
    "You are MemoLink Action Agent, an AI assistant that can take focused actions on the user's behalf. "
    "Use tools only when the user is asking you to perform a concrete action such as searching notes, "
    "creating or editing notes, adding reminders, searching the web for live information, or managing GitHub/Jira work items when those connectors are configured. "
    "If the user says 'ticket' without naming a system, prefer Jira for project-management tickets and GitHub for repository issues, pull requests, branches, and repo workflows based on the wording. "
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
    connector_action = bool(_ACTION_CONNECTOR_RE.search(lower))
    explicit_tool_request = bool(_EXPLICIT_TOOL_RE.search(lower))

    if not any((note_action, reminder_action, web_action, connector_action, explicit_tool_request)):
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
    if connector_action:
        return ActionAgentDecision(True, "Smart: action_agent (connectors)")
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
        github_service=None,
        jira_service=None,
    ):
        self.conv_repo = conv_repo
        self.note_repo = note_repo
        self.reminder_repo = reminder_repo
        self.embedding = embedding_service or EmbeddingService()
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.github = github_service
        self.jira = jira_service

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
                notes = self.note_repo.search_hybrid(
                    query,
                    vec,
                    top_k=5,
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
            except TypeError:
                notes = self.note_repo.search_by_vector(vec, top_k=5, workspace_id=workspace_id, user_id=user_id)
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

    def _github_ticket_action(self, args: dict, user_id: int) -> str:
        if self.github is None:
            return "GitHub connector is not available."
        operation = args["operation"]
        if operation == "repo":
            return self.github.get_repo(user_id, args.get("repo"))
        if operation == "list_branches":
            return self.github.list_branches(user_id, args.get("repo"), query=args.get("query"))
        if operation == "list":
            return self.github.list_issues(
                user_id,
                args.get("repo"),
                query=args.get("query"),
                state=args.get("state") or "open",
            )
        if operation == "get":
            return self.github.get_issue(user_id, args.get("repo"), int(args["issue_number"]))
        if operation == "create":
            return self.github.create_issue(
                user_id,
                args.get("repo"),
                args["title"],
                body=args.get("body"),
                labels=args.get("labels"),
                assignees=args.get("assignees"),
            )
        if operation == "update":
            return self.github.update_issue(
                user_id,
                args.get("repo"),
                int(args["issue_number"]),
                title=args.get("title"),
                body=args.get("body"),
                state=args.get("state"),
                labels=args.get("labels"),
                assignees=args.get("assignees"),
            )
        if operation == "comment":
            target_number = args.get("pull_number") or args.get("issue_number")
            if target_number is None:
                return "A GitHub issue number or pull request number is required to add a comment."
            comment_body = args.get("comment") or args.get("body")
            if not comment_body:
                return "A comment body is required to add a GitHub comment."
            return self.github.comment_issue(
                user_id,
                args.get("repo"),
                int(target_number),
                comment_body,
            )
        if operation == "list_comments":
            target_number = args.get("pull_number") or args.get("issue_number")
            if target_number is None:
                return "A GitHub issue number or pull request number is required to list comments."
            return self.github.list_comments(user_id, args.get("repo"), int(target_number))
        if operation == "list_pull_requests":
            return self.github.list_pull_requests(
                user_id,
                args.get("repo"),
                state=args.get("state") or "open",
                base=args.get("base_branch"),
                head=args.get("head_branch") or args.get("branch_name"),
            )
        if operation == "get_pull_request":
            return self.github.get_pull_request(user_id, args.get("repo"), int(args["pull_number"]))
        if operation == "find_pull_request":
            return self.github.find_pull_request(
                user_id,
                args.get("repo"),
                branch_name=args.get("head_branch") or args.get("branch_name"),
                title_query=args.get("title_query") or args.get("title"),
                state=args.get("state") or "open",
            )
        if operation == "create_pull_request":
            head_branch = args.get("head_branch") or args.get("branch_name")
            if not head_branch:
                return "A head branch is required to create a GitHub pull request."
            return self.github.create_pull_request(
                user_id,
                args.get("repo"),
                args["title"],
                head=head_branch,
                base=args.get("base_branch"),
                body=args.get("body"),
                draft=args.get("draft"),
            )
        if operation == "update_pull_request":
            return self.github.update_pull_request(
                user_id,
                args.get("repo"),
                int(args["pull_number"]),
                title=args.get("title"),
                body=args.get("body"),
                base=args.get("base_branch"),
                state=args.get("state"),
            )
        if operation == "merge_pull_request":
            return self.github.merge_pull_request(
                user_id,
                args.get("repo"),
                int(args["pull_number"]),
                merge_method=args.get("merge_method") or "merge",
                commit_title=args.get("title"),
                commit_message=args.get("body"),
            )
        if operation == "start_development":
            return self.github.start_development(
                user_id,
                args.get("repo"),
                issue_number=args.get("issue_number"),
                branch_name=args.get("branch_name"),
                base_branch=args.get("base_branch"),
            )
        return f"Unknown GitHub operation: {operation}"

    def _jira_ticket_action(self, args: dict, user_id: int) -> str:
        if self.jira is None:
            return "Jira connector is not available."
        operation = args["operation"]
        if operation == "search":
            return self.jira.search_issues(user_id, jql=args.get("jql"))
        if operation == "get":
            return self.jira.get_issue(user_id, issue_key=args["issue_key"])
        if operation == "create":
            return self.jira.create_issue(
                user_id,
                project_key=args.get("project_key"),
                summary=args["summary"],
                description=args.get("description"),
                issue_type=args.get("issue_type"),
            )
        if operation == "update":
            return self.jira.update_issue(
                user_id,
                issue_key=args["issue_key"],
                summary=args.get("summary"),
                description=args.get("description"),
            )
        if operation == "transition":
            return self.jira.transition_issue(
                user_id,
                issue_key=args["issue_key"],
                status_name=args["status_name"],
            )
        if operation == "list_transitions":
            return self.jira.list_transitions(
                user_id,
                issue_key=args["issue_key"],
            )
        if operation == "comment":
            comment_body = args.get("comment") or args.get("description")
            if not comment_body:
                return "A Jira comment is required to add a comment."
            return self.jira.comment_issue(
                user_id,
                issue_key=args["issue_key"],
                body=comment_body,
            )
        if operation == "list_comments":
            return self.jira.list_comments(
                user_id,
                issue_key=args["issue_key"],
            )
        return f"Unknown Jira operation: {operation}"

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
        if name == "github_ticket_action":
            return self._github_ticket_action(args, user_id)
        if name == "jira_ticket_action":
            return self._jira_ticket_action(args, user_id)
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
                try:
                    result = self._execute_tool(name, args, user_id, workspace_id)
                    ok = True
                except Exception as exc:
                    logger.warning("Action tool %s failed: %s", name, exc)
                    result = str(exc)
                    ok = False
                if stream_events:
                    events.append(sse_event(ToolCompleteEvent(ok=ok, result=result)))
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
