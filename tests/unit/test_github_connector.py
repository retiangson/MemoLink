from types import SimpleNamespace

from memolink_backend.business.services.github_connector import GitHubConnectorService


class FakeAccountRepo:
    def get_decrypted_config(self, user_id: int, connector_type: str):
        assert connector_type == "github"
        return {
            "secret": "gh-token",
            "base_url": None,
            "config": {
                "owner": "octocat",
                "repo": "hello-world",
                "default_branch": "main",
            },
        }

    def get_metadata(self, user_id: int, connector_type: str):
        return None


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text

    def json(self):
        return self._payload


def test_create_pull_request_uses_pulls_endpoint(monkeypatch):
    service = GitHubConnectorService(FakeAccountRepo())
    calls = []

    def fake_request(method, url, headers=None, timeout=None, **kwargs):
        calls.append((method, url, kwargs.get("json"), kwargs.get("params")))
        return FakeResponse(payload={"number": 14, "title": "Refine discussion routing"})

    monkeypatch.setattr("memolink_backend.business.services.github_connector.requests.request", fake_request)

    result = service.create_pull_request(
        1,
        None,
        "Refine discussion routing",
        head="feature/discussion-mode-routing",
        base="main",
        body="Adds cleaner discussion routing.",
        draft=False,
    )

    assert result == "Created GitHub pull request #14 in octocat/hello-world: Refine discussion routing"
    assert calls == [
        (
            "POST",
            "https://api.github.com/repos/octocat/hello-world/pulls",
            {
                "title": "Refine discussion routing",
                "head": "feature/discussion-mode-routing",
                "base": "main",
                "body": "Adds cleaner discussion routing.",
                "draft": False,
            },
            None,
        )
    ]


def test_comment_issue_uses_issue_comments_endpoint(monkeypatch):
    service = GitHubConnectorService(FakeAccountRepo())
    calls = []

    def fake_request(method, url, headers=None, timeout=None, **kwargs):
        calls.append((method, url, kwargs.get("json")))
        return FakeResponse(payload={"html_url": "https://github.com/octocat/hello-world/issues/14#issuecomment-1"})

    monkeypatch.setattr("memolink_backend.business.services.github_connector.requests.request", fake_request)

    result = service.comment_issue(1, None, 14, "I'm here, the project is MemoLink.")

    assert result == "Added comment to #14 in octocat/hello-world: https://github.com/octocat/hello-world/issues/14#issuecomment-1"
    assert calls == [
        (
            "POST",
            "https://api.github.com/repos/octocat/hello-world/issues/14/comments",
            {"body": "I'm here, the project is MemoLink."},
        )
    ]


def test_find_pull_request_filters_by_branch_and_title(monkeypatch):
    service = GitHubConnectorService(FakeAccountRepo())
    calls = []

    def fake_request(method, url, headers=None, timeout=None, **kwargs):
        calls.append((method, url, kwargs.get("params")))
        return FakeResponse(
            payload=[
                {
                    "number": 14,
                    "state": "open",
                    "title": "Refine discussion routing",
                    "head": {"ref": "feature/discussion-mode-routing"},
                    "base": {"ref": "main"},
                }
            ]
        )

    monkeypatch.setattr("memolink_backend.business.services.github_connector.requests.request", fake_request)

    result = service.find_pull_request(
        1,
        None,
        branch_name="feature/discussion-mode-routing",
        title_query="discussion routing",
    )

    assert "Found GitHub pull request #14 in octocat/hello-world" in result
    assert calls == [
        (
            "GET",
            "https://api.github.com/repos/octocat/hello-world/pulls",
            {"state": "open", "per_page": 50, "head": "octocat:feature/discussion-mode-routing"},
        )
    ]
