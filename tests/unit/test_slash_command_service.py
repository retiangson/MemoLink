from types import SimpleNamespace
import re

from memolink_backend.business.services import slash_command_service as scs
from memolink_backend.business.services.slash_command_service import SlashCommandService, _parse
from memolink_backend.contracts.slash_command_dtos import SlashCommandRequestDTO
from memolink_backend.contracts.slash_command_dtos import EquationSolveRequestDTO
from pydantic import ValidationError
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
    assert 'data-equation-label="Final answer"' in updated.content
    assert 'data-memolink-equation-latex="x = 3"' in updated.content


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


def test_complete_equation_appends_escaped_completion(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Sequence", "<p>1 + 2 + 3 + ...</p>", "manual")
    service = _build_service(repo)
    monkeypatch.setattr(
        service,
        "_ai",
        lambda *args, **kwargs: '{"original":"1 + 2 + 3 + ...","completed":"1 + 2 + 3 + ... + n = n(n+1)/2","steps":["Pair first and last terms","There are n/2 pairs"],"explanation":"Works for positive integer <script>n</script>."}',
    )

    updated = service.complete_equation(7, note.id, "gpt-5")

    assert "Equation Completion" in updated.content
    assert "n(n+1)/2" in updated.content
    assert "&lt;script&gt;n&lt;/script&gt;" in updated.content
    assert "<script>" not in updated.content


def test_equation_steps_render_intermediate_formulas(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Algebra", "<p>2x + 4 = 10</p>", "manual")
    service = _build_service(repo)
    monkeypatch.setattr(
        service,
        "_ai",
        lambda *args, **kwargs: '{"equation":"2x + 4 = 10","equation_latex":"2x+4=10","steps":[{"explanation":"Subtract 4","latex":"2x=6","result":"2x = 6"},{"explanation":"Divide by 2","latex":"x=3","result":"x = 3"}],"answer":"x = 3","answer_latex":"x=3","verification":"6 + 4 = 10"}',
    )

    updated = service.solve_equation(7, note.id, "gpt-5")

    assert 'data-equation-label="Step 1 formula"' in updated.content
    assert 'data-memolink-equation-latex="2x=6"' in updated.content
    assert 'data-equation-label="Step 2 formula"' in updated.content


def test_complete_equation_rejects_ambiguous_ai_response(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Incomplete", "x +", "manual")
    service = _build_service(repo)
    monkeypatch.setattr(service, "_ai", lambda *args, **kwargs: '{"original":"x +","completed":"","steps":[]}')

    try:
        service.complete_equation(7, note.id)
    except RuntimeError as exc:
        assert "incomplete" in str(exc)
    else:
        raise AssertionError("Expected incomplete AI output to be rejected")


def test_solve_equation_accepts_temporary_handwriting_image_for_empty_note(monkeypatch):
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Handwritten", "", "manual")
    service = _build_service(repo)
    captured = {}

    def fake_ai(model, messages, user_id):
        captured["content"] = messages[-1]["content"]
        return '{"equation":"x + 2 = 5","steps":["Subtract 2"],"answer":"x = 3","verification":"3 + 2 = 5"}'

    monkeypatch.setattr(service, "_ai", fake_ai)
    image = "data:image/png;base64,AAAA"
    updated = service.solve_equation(7, note.id, "gpt-5", image, 2)

    assert "Equation Solution" in updated.content
    assert updated.content.startswith("<p><br></p><p><br></p>")
    assert captured["content"][1]["image_url"]["url"] == image


def test_solve_equation_rejects_empty_note_without_image():
    repo = FakeNoteRepository()
    note = repo.create_note(7, "Handwritten", "", "manual")
    service = _build_service(repo)

    try:
        service.solve_equation(7, note.id, "gpt-5")
    except ValueError as exc:
        assert str(exc) == "Add an equation to the note before solving it"
    else:
        raise AssertionError("Expected empty note without image to be rejected")


def test_equation_prompt_omits_image_for_text_only_model():
    prompt = "Solve x + 2 = 5"
    image = "data:image/png;base64,AAAA"

    content = SlashCommandService._equation_user_content(prompt, image, "gpt-3.5-turbo")

    assert content == prompt


def test_solve_equation_includes_embedded_note_image_for_vision_model(monkeypatch):
    repo = FakeNoteRepository()
    image = "data:image/png;base64,AAAA"
    note = repo.create_note(7, "Pasted equation", f'<p>Solve the pasted equation</p><img src="{image}">', "manual")
    service = _build_service(repo)
    captured = {}

    def fake_ai(model, messages, user_id):
        captured["content"] = messages[-1]["content"]
        return '{"equation":"x=1","steps":["Read image"],"answer":"x=1"}'

    monkeypatch.setattr(service, "_ai", fake_ai)
    service.solve_equation(7, note.id, "gpt-5")

    assert captured["content"][1]["image_url"]["url"] == image


def test_embedded_equation_images_reject_remote_and_invalid_sources():
    html_content = '<img src="https://example.com/equation.png"><img src="data:text/plain;base64,AAAA"><img src="data:image/png;base64,not-valid!">'

    assert SlashCommandService._embedded_equation_images(html_content) == []


def test_embedded_note_image_is_omitted_for_text_only_model():
    image = "data:image/jpeg;base64,AAAA"

    content = SlashCommandService._equation_user_content("Solve it", None, "gpt-3.5-turbo", [image])

    assert content == "Solve it"


def test_equation_request_rejects_non_image_data_url():
    try:
        EquationSolveRequestDTO(note_id=1, drawing_image_data_url="data:text/plain;base64,AAAA")
    except ValidationError as exc:
        assert "PNG or JPEG" in str(exc)
    else:
        raise AssertionError("Expected non-image data URL to be rejected")


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
