"""
Repository-level proof that the public agent's note retrieval is locked down:
notes are only ever visible when public_agent_enabled=True AND they sit in the
agent's exact workspace AND they are not a core memory. This is the single
choke point every public-agent code path must go through (see note_repository.py).
"""
from datetime import datetime, timezone

from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.models.workspace import Workspace
from memolink_backend.domain.repositories.note_repository import NoteRepository
from memolink_backend.core.security import hash_password


def _make_user_and_workspaces(db, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db.add(user)
    db.commit()
    db.refresh(user)

    public_ws = Workspace(user_id=user.id, name="Public Portfolio", type="Other")
    private_ws = Workspace(user_id=user.id, name="Private", type="Other")
    db.add_all([public_ws, private_ws])
    db.commit()
    db.refresh(public_ws)
    db.refresh(private_ws)
    return user, public_ws, private_ws


def test_only_enabled_notes_in_the_exact_workspace_are_returned(db_session, fake):
    user, public_ws, private_ws = _make_user_and_workspaces(db_session, fake)
    repo = NoteRepository(db_session)

    enabled_in_public = Note(
        user_id=user.id, workspace_id=public_ws.id, content="Public project info",
        title="Projects", public_agent_enabled=True,
    )
    disabled_in_public = Note(
        user_id=user.id, workspace_id=public_ws.id, content="Not yet published",
        title="Draft", public_agent_enabled=False,
    )
    enabled_in_private = Note(
        user_id=user.id, workspace_id=private_ws.id, content="Private but flagged",
        title="Oops", public_agent_enabled=True,
    )
    db_session.add_all([enabled_in_public, disabled_in_public, enabled_in_private])
    db_session.commit()

    results = repo.get_public_agent_notes_for_workspace(public_ws.id)

    assert [n.id for n in results] == [enabled_in_public.id]


def test_core_memory_notes_are_never_returned_even_if_enabled(db_session, fake):
    user, public_ws, _ = _make_user_and_workspaces(db_session, fake)
    repo = NoteRepository(db_session)

    core_memory = Note(
        user_id=user.id, workspace_id=public_ws.id, content="Secret credential",
        title="Card", public_agent_enabled=True, is_core_memory=True,
    )
    db_session.add(core_memory)
    db_session.commit()

    assert repo.get_public_agent_notes_for_workspace(public_ws.id) == []


def test_deleted_notes_are_excluded(db_session, fake):
    user, public_ws, _ = _make_user_and_workspaces(db_session, fake)
    repo = NoteRepository(db_session)

    deleted = Note(
        user_id=user.id, workspace_id=public_ws.id, content="Gone",
        title="Deleted", public_agent_enabled=True,
    )
    deleted.deleted_at = datetime.now(timezone.utc)
    db_session.add(deleted)
    db_session.commit()

    assert repo.get_public_agent_notes_for_workspace(public_ws.id) == []


def test_no_workspace_passthrough_for_null_workspace_notes(db_session, fake):
    # Unlike the personal search methods, the public-agent path must NOT treat a
    # null workspace_id as "visible everywhere" — it must require an exact match.
    user, public_ws, _ = _make_user_and_workspaces(db_session, fake)
    repo = NoteRepository(db_session)

    orphaned = Note(
        user_id=user.id, workspace_id=None, content="No workspace",
        title="Orphan", public_agent_enabled=True,
    )
    db_session.add(orphaned)
    db_session.commit()

    assert repo.get_public_agent_notes_for_workspace(public_ws.id) == []
