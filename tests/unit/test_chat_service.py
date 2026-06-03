from types import SimpleNamespace

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
