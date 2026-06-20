"""
PublicAgentService.answer_public_chat is the single funnel a visitor's message goes
through. These tests cover the spec's required scenarios: workspace scoping,
enabled-flag scoping, disabled-agent rejection, invalid-token rejection,
no-match fallback, and domain-restriction behavior. The OpenAI completion call
itself is stubbed out (`_complete`) so these tests never hit the network and
only exercise the retrieval/guard logic that actually matters for safety.
"""
import pytest

from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.models.workspace import Workspace
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.domain.repositories.public_agent_repository import PublicAgentRepository
from memolink_backend.business.services.public_agent_service import (
    PublicAgentService,
    PublicAgentNotFoundError,
    PublicAgentDisabledError,
    PublicAgentDomainNotAllowedError,
    FALLBACK_MESSAGE,
)
from memolink_backend.core.security import hash_password


@pytest.fixture
def setup(db_session, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    public_ws = Workspace(user_id=user.id, name="Public Portfolio", type="Other")
    private_ws = Workspace(user_id=user.id, name="Private", type="Other")
    db_session.add_all([public_ws, private_ws])
    db_session.commit()
    db_session.refresh(public_ws)
    db_session.refresh(private_ws)

    note_repo = NoteRepository(db_session)
    agent_repo = PublicAgentRepository(db_session)
    service = PublicAgentService(public_agent_repo=agent_repo, note_repo=note_repo, embedding_service=None)
    # Stub the LLM call so tests never hit OpenAI; just echo back that context was seen.
    service._complete = lambda agent, message, context: "STUBBED ANSWER" if context else FALLBACK_MESSAGE

    return user, public_ws, private_ws, note_repo, agent_repo, service


def test_invalid_token_raises_not_found(setup):
    *_, service = setup
    with pytest.raises(PublicAgentNotFoundError):
        service.answer_public_chat("does-not-exist", "Hello", origin=None)


def test_disabled_agent_raises_disabled_error(setup):
    user, public_ws, _, _, agent_repo, service = setup
    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=False, allowed_domains=None,
    )

    with pytest.raises(PublicAgentDisabledError):
        service.answer_public_chat(agent.token, "Hello", origin=None)


def test_no_public_notes_returns_exact_fallback_sentence(setup):
    user, public_ws, _, _, agent_repo, service = setup
    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True, allowed_domains=None,
    )

    result = service.answer_public_chat(agent.token, "What projects has Ronald built?", origin=None)

    assert result.answer == FALLBACK_MESSAGE
    assert result.sources == []


def test_private_workspace_notes_are_never_used_even_if_enabled(setup):
    user, public_ws, private_ws, note_repo, agent_repo, service = setup
    note_repo.create_note(user_id=user.id, title="Private", content="Top secret plans", source="manual", workspace_id=private_ws.id)
    private_note = note_repo.db.query(Note).filter(Note.workspace_id == private_ws.id).first()
    private_note.public_agent_enabled = True
    note_repo.db.commit()

    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True, allowed_domains=None,
    )

    result = service.answer_public_chat(agent.token, "What are Ronald's private memories?", origin=None)

    assert result.answer == FALLBACK_MESSAGE
    assert result.sources == []


def test_enabled_public_note_in_agent_workspace_is_used(setup):
    user, public_ws, _, note_repo, agent_repo, service = setup
    note_repo.create_note(user_id=user.id, title="Projects", content="Built MemoLink, a RAG app.", source="manual", workspace_id=public_ws.id)
    public_note = note_repo.db.query(Note).filter(Note.workspace_id == public_ws.id).first()
    public_note.public_agent_enabled = True
    note_repo.db.commit()

    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True, allowed_domains=None,
    )

    result = service.answer_public_chat(agent.token, "What projects has Ronald built?", origin=None)

    assert result.answer == "STUBBED ANSWER"
    assert [s.note_id for s in result.sources] == [public_note.id]


def test_domain_restriction_blocks_disallowed_origin(setup):
    user, public_ws, _, note_repo, agent_repo, service = setup
    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True,
        allowed_domains="https://ronald.dev",
    )

    with pytest.raises(PublicAgentDomainNotAllowedError):
        service.answer_public_chat(agent.token, "Hello", origin="https://evil.example")


def test_domain_restriction_fails_closed_with_no_origin(setup):
    user, public_ws, _, note_repo, agent_repo, service = setup
    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True,
        allowed_domains="https://ronald.dev",
    )

    with pytest.raises(PublicAgentDomainNotAllowedError):
        service.answer_public_chat(agent.token, "Hello", origin=None)


def test_domain_restriction_allows_listed_origin(setup):
    user, public_ws, _, note_repo, agent_repo, service = setup
    note_repo.create_note(user_id=user.id, title="Projects", content="Built MemoLink.", source="manual", workspace_id=public_ws.id)
    public_note = note_repo.db.query(Note).filter(Note.workspace_id == public_ws.id).first()
    public_note.public_agent_enabled = True
    note_repo.db.commit()

    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True,
        allowed_domains="https://ronald.dev",
    )

    result = service.answer_public_chat(agent.token, "What projects?", origin="https://ronald.dev")
    assert result.answer == "STUBBED ANSWER"


def test_no_restriction_configured_allows_any_origin(setup):
    user, public_ws, _, note_repo, agent_repo, service = setup
    agent = agent_repo.create(
        name="Portfolio Bot", workspace_id=public_ws.id, created_by=user.id,
        description=None, system_prompt=None, public_enabled=True, allowed_domains=None,
    )

    result = service.answer_public_chat(agent.token, "Hello", origin="https://anything.example")
    assert result.answer == FALLBACK_MESSAGE  # no notes published, but not blocked by domain check
