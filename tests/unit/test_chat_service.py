from types import SimpleNamespace
import base64
import json
import re

import memolink_backend.business.services.chat_service as chat_module
from memolink_backend.business.services.chat_service import ChatService
from memolink_backend.contracts.chat_dtos import ChatRequestDTO
from tests.fakes.conversation_repository import FakeConversationRepository
from tests.fakes.embedding_service import FakeEmbeddingService
from tests.fakes.note_repository import FakeNoteRepository
from tests.fakes.reminder_repository import FakeReminderRepository


class FakeOpenAIChat:
    def __init__(self, answer):
        self.answer = answer
        self.last_messages = None

    def create(self, **kwargs):
        self.last_messages = kwargs["messages"]
        message = SimpleNamespace(content=self.answer)
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


class FakeEmailService:
    def live_search_sync(self, user_id, query, top_k=1):
        return []


class FakeActionAgent:
    def __init__(self, answer="Agent handled it"):
        self.answer = answer
        self.ask_calls = []
        self.stream_calls = []

    def ask(self, **kwargs):
        self.ask_calls.append(kwargs)
        return chat_module.ChatResponseDTO(
            answer=self.answer,
            sources=[],
            message_id=321,
            routing_reason=kwargs.get("routing_reason"),
        )

    def ask_stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        yield chat_module.sse_event(chat_module.MessageReplaceEvent(content=self.answer))
        yield chat_module.sse_event(
            chat_module.MessageCompleteEvent(
                message_id=654,
                model="gpt-4o-mini",
                routing_reason=kwargs.get("routing_reason"),
            )
        )


def _extract_draft_body(answer: str) -> str:
    match = re.search(r'body_b64="([^"]+)"', answer)
    assert match, answer
    return base64.b64decode(match.group(1)).decode()


def _extract_draft_subject(answer: str) -> str:
    match = re.search(r'subject="([^"]+)"', answer)
    assert match, answer
    return match.group(1)


def test_chat_service_returns_empty_prompt_message():
    service = ChatService(
        conv_repo=FakeConversationRepository(),
        note_repo=FakeNoteRepository(),
        embedding_service=FakeEmbeddingService(),
    )

    result = service.ask(ChatRequestDTO(user_id=1, prompt=" "))

    assert result.answer == "I didn't receive any message."
    assert result.sources == []


def test_chat_service_uses_notes_as_context_and_saves_assistant_message(monkeypatch, fake):
    conv_repo = FakeConversationRepository()
    note_repo = FakeNoteRepository()
    note = note_repo.create_note(1, fake.sentence(nb_words=3), fake.paragraph(), "manual")
    fake_chat = FakeOpenAIChat("Grounded answer")
    monkeypatch.setattr(
        chat_module,
        "_get_client",
        lambda model, user_keys=None: SimpleNamespace(chat=SimpleNamespace(completions=fake_chat)),
    )
    service = ChatService(
        conv_repo=conv_repo,
        note_repo=note_repo,
        embedding_service=FakeEmbeddingService(),
    )

    result = service.ask(ChatRequestDTO(user_id=1, prompt="Summarize my note"))

    assert result.answer == "Grounded answer"
    assert result.sources[0].note_id == note.id
    assert any("USER NOTES CONTEXT" in m["content"] for m in fake_chat.last_messages)
    assert list(conv_repo.messages.values())[-1].role == "assistant"


def test_chat_service_creates_direct_reminder_from_plain_chat_request():
    conv_repo = FakeConversationRepository()
    reminder_repo = FakeReminderRepository()
    service = ChatService(
        conv_repo=conv_repo,
        note_repo=FakeNoteRepository(),
        reminder_repo=reminder_repo,
        embedding_service=FakeEmbeddingService(),
    )

    result = service.ask(
        ChatRequestDTO(
            user_id=1,
            prompt="can you create reminder for me, i have meeting today 4 PM about AI integration.",
        )
    )

    assert result.routing_reason == "Direct: reminder_create"
    assert "Successfully added the reminder" in result.answer
    reminder = reminder_repo.reminders[1]
    assert reminder.text == "Meeting about AI integration"
    assert reminder.due_date == chat_module.date.today().isoformat()
    assert reminder.due_time == "16:00"
    assert list(conv_repo.messages.values())[-1].content == result.answer


def test_chat_service_stream_creates_direct_reminder_from_plain_chat_request():
    reminder_repo = FakeReminderRepository()
    service = ChatService(
        conv_repo=FakeConversationRepository(),
        note_repo=FakeNoteRepository(),
        reminder_repo=reminder_repo,
        embedding_service=FakeEmbeddingService(),
    )

    events = list(
        service.ask_stream(
            ChatRequestDTO(
                user_id=1,
                prompt="please remind me to submit the architecture draft tomorrow at 09:30",
            )
        )
    )

    payloads = [json.loads(event.removeprefix("data: ").strip()) for event in events]
    assert payloads[0]["type"] == "message.replace"
    assert "Successfully added the reminder" in payloads[0]["content"]
    assert payloads[1]["type"] == "message.complete"
    assert payloads[1]["routing_reason"] == "Direct: reminder_create"
    reminder = reminder_repo.reminders[1]
    assert reminder.text == "Submit the architecture draft"
    assert reminder.due_date == (chat_module.date.today() + chat_module.timedelta(days=1)).isoformat()
    assert reminder.due_time == "09:30"


def test_chat_service_auto_routes_note_action_requests_to_action_agent():
    action_agent = FakeActionAgent(answer="I searched your notes and created the note.")
    service = ChatService(
        conv_repo=FakeConversationRepository(),
        note_repo=FakeNoteRepository(),
        reminder_repo=FakeReminderRepository(),
        action_agent=action_agent,
        embedding_service=FakeEmbeddingService(),
    )

    result = service.ask(
        ChatRequestDTO(
            user_id=1,
            prompt="search my notes for architecture decisions and save the result as a note",
        )
    )

    assert result.answer == "I searched your notes and created the note."
    assert result.routing_reason == "Smart: action_agent (notes)"
    assert action_agent.ask_calls[0]["persist_user_message"] is False


def test_chat_service_stream_auto_routes_web_action_requests_to_action_agent():
    action_agent = FakeActionAgent(answer="I searched the web and summarized the latest update.")
    service = ChatService(
        conv_repo=FakeConversationRepository(),
        note_repo=FakeNoteRepository(),
        reminder_repo=FakeReminderRepository(),
        action_agent=action_agent,
        embedding_service=FakeEmbeddingService(),
    )

    events = list(
        service.ask_stream(
            ChatRequestDTO(
                user_id=1,
                prompt="search online for the latest OpenAI enterprise pricing updates and summarize them",
            )
        )
    )

    payloads = [json.loads(event.removeprefix("data: ").strip()) for event in events]
    assert payloads[0]["type"] == "message.replace"
    assert payloads[0]["content"] == "I searched the web and summarized the latest update."
    assert payloads[1]["type"] == "message.complete"
    assert payloads[1]["routing_reason"] == "Smart: action_agent (web)"
    assert action_agent.stream_calls[0]["persist_user_message"] is False


def test_action_agent_decision_does_not_hijack_regular_academic_prompt():
    decision = chat_module.decide_action_agent(
        "Write a full literature review on AI companions in higher education.",
        {"mode": "academic_writer", "needs_web": False},
    )

    assert decision.should_handle is False


def test_chat_service_builds_email_draft_for_send_that_as_email_phrase(monkeypatch):
    conv_repo = FakeConversationRepository()
    conv = conv_repo.create_conversation(1, "Email draft")
    conv_repo.add_message(conv.id, "assistant", "## Research Summary\n\nThis is the generated research content that should be emailed.")

    extractor = FakeOpenAIChat('{"recipient":"rectiangson@gmail.com","note_name":null,"subject":"Research Paper Submission","is_reply":false,"style":null}')
    monkeypatch.setattr(
        chat_module,
        "_get_client",
        lambda model, user_keys=None: SimpleNamespace(chat=SimpleNamespace(completions=extractor)),
    )

    service = ChatService(
        conv_repo=conv_repo,
        note_repo=FakeNoteRepository(),
        embedding_service=FakeEmbeddingService(),
        email_service=FakeEmailService(),
    )

    result = service.ask(ChatRequestDTO(
        user_id=1,
        conversation_id=conv.id,
        prompt="can you send that as email the research we generated to rectiangson@gmail.com",
    ))

    assert '<email_draft to="rectiangson@gmail.com"' in result.answer
    assert "click **Send**" in result.answer
    assert "generated research content" in _extract_draft_body(result.answer)


def test_chat_service_uses_prior_context_when_user_only_replies_with_email_address(monkeypatch):
    conv_repo = FakeConversationRepository()
    conv = conv_repo.create_conversation(1, "Email follow-up")
    conv_repo.add_message(conv.id, "assistant", "## Research Paper\n\nThis is the completed research paper content from the earlier step.")
    conv_repo.add_message(conv.id, "user", "can you send that as email the research we generated to rectiangson")
    conv_repo.add_message(conv.id, "assistant", "What is the email address of Rectiangson and what specific research content should be included in the email?")

    extractor = FakeOpenAIChat('{"recipient":"rectiangson@gmail.com","note_name":null,"subject":"Research Paper Submission - MSE907 Assessment 2","is_reply":false,"style":null}')
    monkeypatch.setattr(
        chat_module,
        "_get_client",
        lambda model, user_keys=None: SimpleNamespace(chat=SimpleNamespace(completions=extractor)),
    )

    service = ChatService(
        conv_repo=conv_repo,
        note_repo=FakeNoteRepository(),
        embedding_service=FakeEmbeddingService(),
        email_service=FakeEmailService(),
    )

    result = service.ask(ChatRequestDTO(
        user_id=1,
        conversation_id=conv.id,
        prompt="rectiangson@gmail.com",
    ))

    assert '<email_draft to="rectiangson@gmail.com"' in result.answer
    assert _extract_draft_subject(result.answer) == "Research Paper Submission - MSE907 Assessment 2"
    assert "completed research paper content" in _extract_draft_body(result.answer)


def test_derive_web_search_query_uses_previous_topic_for_generic_follow_up():
    message_history = [
        {"role": "user", "content": "What is changing with Microsoft enterprise licensing this month?"},
        {"role": "assistant", "content": "I need live search for that."},
        {"role": "user", "content": "can you search online latest news?"},
    ]

    query = chat_module._derive_web_search_query("can you search online latest news?", message_history)

    assert query == "What is changing with Microsoft enterprise licensing this month? latest news"


def test_derive_web_search_query_keeps_explicit_topic_requests():
    message_history = [
        {"role": "user", "content": "search online latest OpenAI enterprise pricing updates"},
    ]

    query = chat_module._derive_web_search_query("search online latest OpenAI enterprise pricing updates", message_history)

    assert query == "search online latest OpenAI enterprise pricing updates"


def test_save_cited_papers_as_notes_skips_existing_long_title_duplicates():
    note_repo = FakeNoteRepository()
    note_repo.save_embedding = lambda note_id, vec: None
    long_title = (
        "A Very Long Paper Title About Context-Aware AI Companions and Retrieval Systems in "
        "Knowledge-Intensive Workflows With Extended Evaluation Details"
    )
    note_repo.create_note(1, long_title, "existing", "academic_search")
    service = ChatService(
        conv_repo=FakeConversationRepository(),
        note_repo=note_repo,
        embedding_service=FakeEmbeddingService(),
    )

    saved = service._save_cited_papers_as_notes(
        draft="Smith (2024) argues that context-aware retrieval improves workflow continuity.",
        papers=[
            {
                "title": long_title,
                "authors": "Jane Smith, John Lee",
                "year": 2024,
                "abstract": "Relevant abstract",
                "doi": "10.1000/example",
                "pdf_url": None,
                "citations": 12,
                "source": "CORE",
                "full_text": "",
            }
        ],
        user_id=1,
        workspace_id=None,
    )

    assert saved == 0
    assert len(note_repo.notes) == 1


# ── Large-context re-routing guard ───────────────────────────────────────────

def test_reroute_large_request_to_gemini_when_oversized():
    # Oversized request on a low-TPM OpenAI model → Gemini (key present)
    model, reason = chat_module._reroute_large_request(
        "gpt-4o", est_tokens=40000, gemini_key="g-key", default_model="gpt-4o-mini",
    )
    assert model == "gemini-2.5-flash" and reason and "Gemini" in reason


def test_reroute_large_request_to_mini_without_gemini_key():
    model, reason = chat_module._reroute_large_request(
        "gpt-4o", est_tokens=40000, gemini_key="", default_model="gpt-4o-mini",
    )
    assert model == "gpt-4o-mini" and reason


def test_reroute_keeps_small_requests_on_gpt4o():
    model, reason = chat_module._reroute_large_request(
        "gpt-4o", est_tokens=5000, gemini_key="g-key", default_model="gpt-4o-mini",
    )
    assert model == "gpt-4o" and reason is None


def test_reroute_ignores_mini_and_other_models():
    # mini already has high TPM; gemini/deepseek have big windows — never re-routed
    for m in ("gpt-4o-mini", "gemini-2.5-flash", "deepseek-chat"):
        model, reason = chat_module._reroute_large_request(m, 99999, "g-key", "gpt-4o-mini")
        assert model == m and reason is None
