from types import SimpleNamespace
import base64
import re

import memolink_backend.business.services.chat_service as chat_module
from memolink_backend.business.services.chat_service import ChatService
from memolink_backend.contracts.chat_dtos import ChatRequestDTO
from tests.fakes.conversation_repository import FakeConversationRepository
from tests.fakes.embedding_service import FakeEmbeddingService
from tests.fakes.note_repository import FakeNoteRepository


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
