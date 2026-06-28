from types import SimpleNamespace
import re

from memolink_backend.business.services import slash_command_service as scs
from memolink_backend.business.services.slash_command_service import SlashCommandService, _parse
from memolink_backend.contracts.slash_command_dtos import SlashCommandRequestDTO
from tests.fakes.conversation_repository import FakeConversationRepository
from tests.fakes.embedding_service import FakeEmbeddingService
from tests.fakes.note_repository import FakeNoteRepository
from tests.fakes.reminder_repository import FakeReminderRepository


class _DiscussionNoteRepository(FakeNoteRepository):
    def find_by_title_for_user(self, user_id, title, workspace_id=None):
        title_l = (title or "").strip().lower()
        for note in self.get_for_user(user_id, workspace_id):
            if (note.title or "").strip().lower() == title_l:
                return note
        return None

    def search_hybrid(self, query_text, query_vector, top_k=10, workspace_id=None, user_id=None):
        query_terms = set(re.findall(r"[a-z0-9]+", query_text.lower()))
        notes = self.get_for_user(user_id, workspace_id)
        ranked = sorted(
            notes,
            key=lambda note: (
                len(query_terms.intersection(set(re.findall(r"[a-z0-9]+", ((note.title or "") + " " + (note.content or "")).lower())))),
                note.id,
            ),
            reverse=True,
        )
        return ranked[:top_k]


class _FakeChatCompletions:
    def create(self, model, messages, **kwargs):
        prompt = messages[-1]["content"]
        content = "Final answer" if "Full discussion:" in prompt else "I support this direction. [AGREE]"
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )


class _FakeClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_FakeChatCompletions())


class _FailingChatCompletions:
    def create(self, model, messages, **kwargs):
        raise KeyError("id")


class _FailingClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_FailingChatCompletions())


class _BusyFailingChatCompletions:
    def create(self, model, messages, **kwargs):
        raise RuntimeError("Error code: 503 - [{'error': {'code': 503, 'message': 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', 'status': 'UNAVAILABLE'}}]")


class _BusyFailingClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_BusyFailingChatCompletions())


class _GeminiBusyThenLiteCompletions:
    def __init__(self, model, calls):
        self.model = model
        self.calls = calls

    def create(self, model, messages, **kwargs):
        self.calls.append(model)
        if model == "gemini-2.5-flash":
            raise RuntimeError("Error code: 503 - [{'error': {'code': 503, 'message': 'This model is currently experiencing high demand.', 'status': 'UNAVAILABLE'}}]")
        prompt = messages[-1]["content"]
        content = "Final answer" if "Full discussion:" in prompt else "Here is the fallback Gemini contribution. [AGREE]"
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )


class _ModelAwareClient:
    def __init__(self, completions):
        self.chat = SimpleNamespace(completions=completions)


def _build_service(note_repo):
    return SlashCommandService(
        note_repo=note_repo,
        conv_repo=FakeConversationRepository(),
        reminder_repo=FakeReminderRepository(),
        embedding_service=FakeEmbeddingService(),
        db=SimpleNamespace(commit=lambda: None, execute=lambda *args, **kwargs: None),
    )


def test_solve_equation_appends_escaped_step_by_step_solution(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Algebra", "<p>Solve x + 2 = 5</p>", "manual")
    service = _build_service(repo)
    monkeypatch.setattr(
        service,
        "_ai",
        lambda *args, **kwargs: '{"equation":"x + 2 = 5","steps":["Subtract <script>alert(1)</script> 2 from both sides","x = 3"],"answer":"x = 3","verification":"3 + 2 = 5"}',
    )

    updated = service.solve_equation(7, note.id, "gpt-5")

    assert "Equation Solution" in updated.content
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in updated.content
    assert "<script>" not in updated.content
    assert "<strong>Answer:</strong> x = 3" in updated.content


def test_solve_equation_rejects_note_owned_by_another_user():
    repo = FakeNoteRepository()
    note = repo.create_note(8, "Private", "x = 1", "manual")
    service = _build_service(repo)

    try:
        service.solve_equation(7, note.id)
    except LookupError as exc:
        assert str(exc) == "Note not found"
    else:
        raise AssertionError("Expected ownership check to reject the note")


def test_solve_equation_rejects_invalid_ai_response(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Algebra", "x + 2 = 5", "manual")
    service = _build_service(repo)
    monkeypatch.setattr(service, "_ai", lambda *args, **kwargs: "not json")

    try:
        service.solve_equation(7, note.id)
    except RuntimeError as exc:
        assert "invalid" in str(exc)
    else:
        raise AssertionError("Expected malformed AI output to be rejected")


def test_parse_discussion_bare_question_keeps_question_text():
    parsed = _parse("/Discussion how should I approach AI integration?")
    assert parsed is not None
    assert parsed.command == "discussion"
    assert parsed.target == "how should I approach AI integration?"
    assert parsed.instruction is None
    assert parsed.is_all is False


def test_discussion_without_named_note_uses_relevant_notes_only(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "AI Integration", "Rollout notes for the platform", "manual", workspace_id=7)
    note_repo.create_note(1, "Architecture", "Discussion context for tradeoffs", "manual", workspace_id=7)
    service = _build_service(note_repo)

    monkeypatch.setattr(scs, "_get_client", lambda model, user_keys=None: _FakeClient())

    dto = SlashCommandRequestDTO(
        command="/Discussion how should I approach AI integration?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Discussion: AI Integration" in text
    assert "Goal:* how should I approach AI integration?" in text
    assert "Participants:* GPT" in text
    assert "Using notes:* AI Integration" in text
    assert "Conclusion - Best Approach" in text


def test_discussion_prefers_relevant_notes_for_question(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "Gardening", "Tomatoes and soil health", "manual", workspace_id=7)
    note_repo.create_note(1, "Deployment", "Use Azure App Service, PostgreSQL, and static frontend hosting", "manual", workspace_id=7)
    note_repo.create_note(1, "Architecture", "Backend and UI deployment tradeoffs", "manual", workspace_id=7)
    service = _build_service(note_repo)

    monkeypatch.setattr(scs, "_get_client", lambda model, user_keys=None: _FakeClient())

    dto = SlashCommandRequestDTO(
        command="/Discussion how do we deploy MemoLink, what is the best to serve DB, UI, and back-end?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Using notes:*" in text
    assert "Deployment" in text
    assert "Architecture" in text
    assert "Gardening" not in text


def test_discussion_without_relevant_notes_stays_general(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "Assessment 2", "Academic report requirements and rubric notes", "manual", workspace_id=7)
    note_repo.create_note(1, "Deployment", "Use Azure App Service and PostgreSQL", "manual", workspace_id=7)
    service = _build_service(note_repo)

    monkeypatch.setattr(scs, "_get_client", lambda model, user_keys=None: _FakeClient())

    dto = SlashCommandRequestDTO(
        command="/Discussion I will order pizza what flavor should i order?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Discussion: General Discussion" in text
    assert "Using notes:*" not in text
    assert "No notes found in this workspace." not in text


def test_discussion_does_not_fake_consensus_when_models_unavailable(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "Deployment", "Use Azure App Service, PostgreSQL, and static frontend hosting", "manual", workspace_id=7)
    service = _build_service(note_repo)

    monkeypatch.setattr(scs, "_get_client", lambda model, user_keys=None: _FailingClient())

    dto = SlashCommandRequestDTO(
        command="/Discussion how do we deploy MemoLink?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Discussion models are currently unavailable for this request." in text
    assert "reached agreement" not in text


def test_discussion_hides_raw_busy_provider_errors(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "Deployment", "Use Azure App Service, PostgreSQL, and static frontend hosting", "manual", workspace_id=7)
    service = _build_service(note_repo)

    monkeypatch.setattr(scs.settings, "gemini_api_key", "test-gemini-key", raising=False)
    monkeypatch.setattr(scs, "_get_client", lambda model, user_keys=None: _BusyFailingClient())

    dto = SlashCommandRequestDTO(
        command="/Discussion how do we deploy MemoLink?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Error code: 503" not in text
    assert "high demand" not in text
    assert "temporarily unavailable due to provider load" in text


def test_discussion_uses_gemini_fallback_before_skipping(monkeypatch):
    note_repo = _DiscussionNoteRepository()
    note_repo.create_note(1, "Deployment", "Use Azure App Service, PostgreSQL, and static frontend hosting", "manual", workspace_id=7)
    service = _build_service(note_repo)
    calls = []

    monkeypatch.setattr(scs.settings, "gemini_api_key", "test-gemini-key", raising=False)

    def _factory(model, user_keys=None):
        return _ModelAwareClient(_GeminiBusyThenLiteCompletions(model, calls))

    monkeypatch.setattr(scs, "_get_client", _factory)

    dto = SlashCommandRequestDTO(
        command="/Discussion how do we deploy MemoLink?",
        user_id=1,
        conversation_id=123,
        workspace_id=7,
        model="gpt-5",
    )

    chunks = list(service.execute_stream(dto))
    text = "".join(chunk for chunk in chunks if chunk.startswith("data: "))

    assert "Gemini is temporarily unavailable" not in text
    assert "Here is the fallback Gemini contribution." in text
    assert "gemini-2.5-flash" in calls
    assert "gemini-2.5-flash-lite" in calls
