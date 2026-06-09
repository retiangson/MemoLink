from datetime import datetime, timedelta, timezone

from memolink_backend.business.services.jira_connector import JiraConnectorService


class FakeRepo:
    def __init__(self, cfg):
        self.cfg = cfg
        self.saved = None

    def get_decrypted_config(self, user_id, connector_type):
        return self.cfg

    def get_metadata(self, user_id, connector_type):
        return {
            "display_name": self.cfg.get("display_name", "Jira"),
            "account_label": self.cfg.get("account_label"),
            "base_url": self.cfg.get("base_url"),
            "config": self.cfg.get("config") or {},
        }

    def upsert(self, **kwargs):
        self.saved = kwargs
        updated = dict(self.cfg)
        updated["secret"] = kwargs["secret"]
        updated["refresh_secret"] = kwargs.get("refresh_secret")
        updated["token_expiry"] = kwargs.get("token_expiry")
        updated["base_url"] = kwargs.get("base_url")
        updated["account_label"] = kwargs.get("account_label")
        updated["config"] = kwargs.get("config") or {}
        self.cfg = updated
        return updated


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def test_jira_comment_uses_oauth_bearer_headers(monkeypatch):
    repo = FakeRepo(
        {
            "display_name": "Jira",
            "account_label": "MemoLink Cloud",
            "base_url": "https://api.atlassian.com/ex/jira/cloud-123",
            "secret": "access-token",
            "refresh_secret": "refresh-token",
            "token_expiry": datetime.now(timezone.utc) + timedelta(hours=1),
            "config": {"auth_type": "oauth", "cloud_id": "cloud-123", "project_key": "MEMO", "issue_type": "Task"},
        }
    )
    seen = {}

    def fake_request(method, url, headers=None, timeout=None, **kwargs):
        seen["method"] = method
        seen["url"] = url
        seen["headers"] = headers
        seen["json"] = kwargs.get("json")
        return FakeResponse()

    monkeypatch.setattr("memolink_backend.business.services.jira_connector.requests.request", fake_request)

    service = JiraConnectorService(repo)
    result = service.comment_issue(1, "MEMO-42", "Starting work now.")

    assert result == "Added a Jira comment to MEMO-42."
    assert seen["method"] == "POST"
    assert seen["url"].endswith("/rest/api/3/issue/MEMO-42/comment")
    assert seen["headers"]["Authorization"] == "Bearer access-token"


def test_list_transitions_returns_available_transition_names(monkeypatch):
    repo = FakeRepo(
        {
            "display_name": "Jira",
            "account_label": "me@example.com",
            "base_url": "https://memolink.atlassian.net",
            "secret": "api-token",
            "refresh_secret": None,
            "token_expiry": None,
            "config": {"auth_type": "token", "project_key": "MEMO", "issue_type": "Task"},
        }
    )

    def fake_request(method, url, headers=None, timeout=None, **kwargs):
        return FakeResponse(payload={"transitions": [{"name": "To Do"}, {"name": "In Progress"}, {"name": "Done"}]})

    monkeypatch.setattr("memolink_backend.business.services.jira_connector.requests.request", fake_request)

    service = JiraConnectorService(repo)
    result = service.list_transitions(1, "MEMO-42")

    assert "Jira transitions for MEMO-42:" in result
    assert "- In Progress" in result
