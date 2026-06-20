"""
API-level coverage for the Public Portfolio Agent feature: feature-flag gating,
owner-scoped management, and the unauthenticated public chat endpoint's
security behavior (workspace/enabled-flag scoping, disabled-agent rejection,
invalid-token rejection, no-match fallback, domain restriction, rate limiting,
and non-persistence of widget chat history).
"""
from sqlalchemy import text

from memolink_backend.core.security import hash_password
from memolink_backend.domain.models.conversation import Conversation
from memolink_backend.domain.models.message import Message
from memolink_backend.domain.models.note import Note
from memolink_backend.domain.models.user_model import User
from memolink_backend.domain.models.workspace import Workspace
from memolink_backend.business.services.public_agent_service import PublicAgentService, FALLBACK_MESSAGE
from tests.helpers.api_client import api_client


def _set_flag(db, key, value):
    db.execute(text("CREATE TABLE IF NOT EXISTS feature_flags (key VARCHAR PRIMARY KEY, value TEXT)"))
    db.execute(text("DELETE FROM feature_flags WHERE key = :k"), {"k": key})
    db.execute(text("INSERT INTO feature_flags (key, value) VALUES (:k, :v)"), {"k": key, "v": value})
    db.commit()


def _make_user(db, fake):
    user = User(email=fake.unique.email(), password=hash_password("Password123"))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_workspace(db, user, name="Public Portfolio"):
    ws = Workspace(user_id=user.id, name=name, type="Other")
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


def test_feature_flag_off_hides_management_and_chat_endpoints(db_session, fake):
    db_session.execute(text("CREATE TABLE IF NOT EXISTS feature_flags (key VARCHAR PRIMARY KEY, value TEXT)"))
    db_session.commit()
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)
    # flag intentionally left unset -> require_public_agent_feature treats it as "false"

    with api_client(db_session, user_id=user.id) as client:
        create = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id})
        chat = client.post("/api/public/agents/some-token/chat", json={"message": "hi"})

    assert create.status_code == 404
    assert chat.status_code == 404


def test_create_list_get_update_enable_disable_delete(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        created = client.post("/api/public-agents", json={"name": "Portfolio Bot", "workspace_id": ws.id})
        assert created.status_code == 200
        agent = created.json()
        assert agent["public_enabled"] is False  # off by default
        assert len(agent["token"]) >= 32  # hard-to-guess, non-sequential

        listed = client.post("/api/public-agents/list")
        assert listed.status_code == 200
        assert [a["id"] for a in listed.json()] == [agent["id"]]

        got = client.post("/api/public-agents/get", json={"agent_id": agent["id"]})
        assert got.status_code == 200

        updated = client.post("/api/public-agents/update", json={"agent_id": agent["id"], "name": "Renamed"})
        assert updated.status_code == 200
        assert updated.json()["name"] == "Renamed"

        enabled = client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})
        assert enabled.status_code == 200
        assert enabled.json()["public_enabled"] is True

        disabled = client.post("/api/public-agents/disable", json={"agent_id": agent["id"]})
        assert disabled.status_code == 200
        assert disabled.json()["public_enabled"] is False

        old_token = agent["token"]
        regenerated = client.post("/api/public-agents/regenerate-token", json={"agent_id": agent["id"]})
        assert regenerated.status_code == 200
        assert regenerated.json()["token"] != old_token

        deleted = client.post("/api/public-agents/delete", json={"agent_id": agent["id"]})
        assert deleted.status_code == 200
        assert deleted.json() == {"ok": True}

        missing = client.post("/api/public-agents/get", json={"agent_id": agent["id"]})
        assert missing.status_code == 404


def test_owner_scoping_rejects_other_users(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    owner = _make_user(db_session, fake)
    intruder = _make_user(db_session, fake)
    ws = _make_workspace(db_session, owner)

    with api_client(db_session, user_id=owner.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()

    with api_client(db_session, user_id=intruder.id) as client:
        got = client.post("/api/public-agents/get", json={"agent_id": agent["id"]})
        deleted = client.post("/api/public-agents/delete", json={"agent_id": agent["id"]})

    assert got.status_code == 403
    assert deleted.status_code == 403


def test_public_chat_invalid_token_returns_404(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")

    with api_client(db_session) as client:
        resp = client.post("/api/public/agents/not-a-real-token/chat", json={"message": "Hello"})

    assert resp.status_code == 404


def test_public_chat_disabled_agent_returns_403(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()

    with api_client(db_session) as client:
        resp = client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "Hello"})

    assert resp.status_code == 403


def test_public_chat_no_match_returns_exact_fallback(db_session, fake, monkeypatch):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    monkeypatch.setattr(PublicAgentService, "_complete", lambda self, agent, message, context: "STUBBED")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        resp = client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "What are Ronald's private memories?"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == FALLBACK_MESSAGE
    assert body["sources"] == []


def test_public_chat_answers_only_from_public_workspace_notes(db_session, fake, monkeypatch):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    monkeypatch.setattr(
        PublicAgentService, "_complete",
        lambda self, agent, message, context: "STUBBED ANSWER" if context else FALLBACK_MESSAGE,
    )
    user = _make_user(db_session, fake)
    public_ws = _make_workspace(db_session, user, "Public Portfolio")
    private_ws = _make_workspace(db_session, user, "Private")

    public_note = Note(user_id=user.id, workspace_id=public_ws.id, title="Projects", content="Built MemoLink.", public_agent_enabled=True)
    private_note = Note(user_id=user.id, workspace_id=private_ws.id, title="Diary", content="Private thoughts.", public_agent_enabled=True)
    db_session.add_all([public_note, private_note])
    db_session.commit()

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": public_ws.id}).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        resp = client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "What projects has Ronald built?"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "STUBBED ANSWER"
    assert [s["note_id"] for s in body["sources"]] == [public_note.id]


def test_public_chat_domain_restriction_blocks_unlisted_origin(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post(
            "/api/public-agents",
            json={"name": "Bot", "workspace_id": ws.id, "allowed_domains": "https://ronald.dev"},
        ).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        resp = client.post(
            f"/api/public/agents/{agent['token']}/chat",
            json={"message": "Hello"},
            headers={"Origin": "https://evil.example"},
        )

    assert resp.status_code == 403


def test_public_chat_does_not_persist_widget_history_server_side(db_session, fake, monkeypatch):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    monkeypatch.setattr(PublicAgentService, "_complete", lambda self, agent, message, context: "STUBBED")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "Hello"})
        client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "Hello again"})

    assert db_session.query(Conversation).count() == 0
    assert db_session.query(Message).count() == 0


def test_public_chat_rejects_oversized_message(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        resp = client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "x" * 5000})

    assert resp.status_code == 422


def test_management_endpoints_respect_access_level_gate(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    _set_flag(db_session, "public_portfolio_agent_min_level", "pro")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id, access_level="regular") as client:
        blocked = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id})
    assert blocked.status_code == 403

    with api_client(db_session, user_id=user.id, access_level="pro") as client:
        allowed = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id})
    assert allowed.status_code == 200

    with api_client(db_session, user_id=user.id, access_level="regular", is_admin=True) as client:
        admin_bypass = client.post("/api/public-agents", json={"name": "Bot 2", "workspace_id": ws.id})
    assert admin_bypass.status_code == 200


def test_avatar_create_update_clear_and_size_validation(db_session, fake):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)
    small_avatar = "data:image/png;base64,iVBORw0KGgo="

    with api_client(db_session, user_id=user.id) as client:
        created = client.post(
            "/api/public-agents",
            json={"name": "Bot", "workspace_id": ws.id, "avatar_url": small_avatar},
        )
        assert created.status_code == 200
        agent = created.json()
        assert agent["avatar_url"] == small_avatar

        rejected_non_image = client.post(
            "/api/public-agents",
            json={"name": "Bot2", "workspace_id": ws.id, "avatar_url": "not-a-data-url"},
        )
        assert rejected_non_image.status_code == 422

        rejected_too_large = client.post(
            "/api/public-agents",
            json={"name": "Bot3", "workspace_id": ws.id, "avatar_url": "data:image/png;base64," + ("A" * 700_001)},
        )
        assert rejected_too_large.status_code == 422

        new_avatar = "data:image/png;base64,iVBORw0KGgoNEW="
        updated = client.post(
            "/api/public-agents/update",
            json={"agent_id": agent["id"], "avatar_url": new_avatar},
        )
        assert updated.status_code == 200
        assert updated.json()["avatar_url"] == new_avatar

        cleared = client.post(
            "/api/public-agents/update",
            json={"agent_id": agent["id"], "clear_avatar": True},
        )
        assert cleared.status_code == 200
        assert cleared.json()["avatar_url"] is None


def test_public_chat_rate_limit_returns_429_after_threshold(db_session, fake, monkeypatch):
    _set_flag(db_session, "public_portfolio_agent_enabled", "true")
    monkeypatch.setattr(PublicAgentService, "_complete", lambda self, agent, message, context: "STUBBED")
    user = _make_user(db_session, fake)
    ws = _make_workspace(db_session, user)

    with api_client(db_session, user_id=user.id) as client:
        agent = client.post("/api/public-agents", json={"name": "Bot", "workspace_id": ws.id}).json()
        client.post("/api/public-agents/enable", json={"agent_id": agent["id"]})

    with api_client(db_session) as client:
        statuses = [
            client.post(f"/api/public/agents/{agent['token']}/chat", json={"message": "Hello"}).status_code
            for _ in range(21)
        ]

    assert statuses[:20] == [200] * 20
    assert statuses[20] == 429
