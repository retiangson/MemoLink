from types import SimpleNamespace

from memolink_backend.business.services.workflow_service import WorkflowService
from tests.fakes.conversation_repository import FakeConversationRepository
from tests.fakes.embedding_service import FakeEmbeddingService
from tests.fakes.note_repository import FakeNoteRepository
from tests.fakes.reminder_repository import FakeReminderRepository


class _FakeChatCompletions:
    def __init__(self, responses):
        self._responses = list(responses)

    def create(self, *args, **kwargs):
        content = self._responses.pop(0)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )


class _FakeClient:
    def __init__(self, responses):
        self.chat = SimpleNamespace(completions=_FakeChatCompletions(responses))


def _build_service(responses):
    note_repo = FakeNoteRepository()
    note_repo.create_note(1, "Deployment", "Use Azure App Service and PostgreSQL.", "manual", workspace_id=7)
    conv_repo = FakeConversationRepository()
    conv_repo.create_conversation(1, "Test", workspace_id=7)
    service = WorkflowService(
        conv_repo=conv_repo,
        note_repo=note_repo,
        reminder_repo=FakeReminderRepository(),
        embedding_service=FakeEmbeddingService(),
    )
    service._client = _FakeClient(responses)
    return service


def test_suggest_extracts_first_json_object_from_noisy_model_output():
    service = _build_service([
        'Here you go:\n{"actions":[{"id":"a1","type":"search_web","label":"Search: deployment","params":{"query":"deploy MemoLink"}}]}\nAdditional note that should be ignored.'
    ])

    actions = service.suggest(
        message="This is a long enough AI response to trigger workflow suggestions. " * 3,
        workspace_id=7,
        user_id=1,
        user_message="How do we deploy MemoLink?",
    )

    assert len(actions) == 1
    assert actions[0].type == "search_web"
    assert actions[0].params["query"] == "deploy MemoLink"


def test_suggest_returns_empty_list_when_model_output_is_not_parseable_json():
    service = _build_service([
        "actions: save note; reminder tomorrow; search the web"
    ])

    actions = service.suggest(
        message="This is a long enough AI response to trigger workflow suggestions. " * 3,
        workspace_id=7,
        user_id=1,
        user_message="Help me organise this",
    )

    assert actions == []


def test_plan_extracts_json_from_fenced_output_with_extra_text():
    service = _build_service([
        'Sure, here is the plan.\n```json\n{"understanding":"Prepare deployment workflow","actions":[{"id":"a1","type":"search_web","label":"Search deployment","preview":"🌐 search","params":{"query":"MemoLink deployment"}}]}\n```\nThanks.'
    ])

    result = service.plan(
        user_id=1,
        conversation_id=1,
        prompt="Plan how to deploy MemoLink",
        workspace_id=7,
        model="gpt-5",
    )

    assert result.understanding == "Prepare deployment workflow"
    assert len(result.actions) == 1
    assert result.actions[0].type == "search_web"
