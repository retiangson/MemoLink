from types import SimpleNamespace

from memolink_backend.business.services.action_agent import ActionAgentRunner, decide_action_agent
from memolink_backend.business.services.connectors_service import ConnectorsService


class FakeEmailRepo:
    def __init__(self, row=None):
        self.row = row

    def get_by_user_id(self, user_id: int):
        return self.row


class FakeTeamsRepo:
    def __init__(self, row=None):
        self.row = row

    def get_by_user_id(self, user_id: int):
        return self.row


class FakeConnectorRepo:
    def __init__(self):
        self.saved = {}

    def upsert(self, **kwargs):
        self.saved[(kwargs["user_id"], kwargs["connector_type"])] = kwargs
        return SimpleNamespace(**kwargs)

    def delete_by_user_and_type(self, user_id: int, connector_type: str):
        return self.saved.pop((user_id, connector_type), None) is not None

    def get_decrypted_config(self, user_id: int, connector_type: str):
        return self.saved.get((user_id, connector_type))

    def get_metadata(self, user_id: int, connector_type: str):
        row = self.saved.get((user_id, connector_type))
        if not row:
            return None
        return {
            "display_name": row["display_name"],
            "account_label": row.get("account_label"),
            "base_url": row.get("base_url"),
            "config": row.get("config") or {},
        }


class FakeGitHubService:
    def status(self, user_id: int):
        return {
            "configured": True,
            "display_name": "GitHub",
            "account_label": "octocat",
            "default_repo": "octocat/hello-world",
        }

    def get_repo(self, user_id, repo=None):
        return f"repo:{repo}"

    def list_branches(self, user_id, repo, query=None, limit=20):
        return f"branches:{repo}:{query}:{limit}"

    def list_issues(self, user_id, repo, query=None, state="open"):
        return f"list:{repo}:{query}:{state}"

    def get_issue(self, user_id, repo, issue_number):
        return f"get:{repo}:{issue_number}"

    def create_issue(self, user_id, repo, title, body=None, labels=None, assignees=None):
        return f"create:{repo}:{title}"

    def update_issue(self, user_id, repo, issue_number, title=None, body=None, state=None, labels=None, assignees=None):
        return f"update:{repo}:{issue_number}:{state}"

    def start_development(self, user_id, repo, issue_number=None, branch_name=None, base_branch=None):
        return f"branch:{repo}:{issue_number}:{branch_name}:{base_branch}"

    def list_comments(self, user_id, repo, issue_number, limit=10):
        return f"comments:{repo}:{issue_number}:{limit}"

    def comment_issue(self, user_id, repo, issue_number, body):
        return f"comment:{repo}:{issue_number}:{body}"

    def list_pull_requests(self, user_id, repo, state="open", base=None, head=None, limit=10):
        return f"prs:{repo}:{state}:{base}:{head}:{limit}"

    def get_pull_request(self, user_id, repo, pull_number):
        return f"pr:{repo}:{pull_number}"

    def find_pull_request(self, user_id, repo, branch_name=None, title_query=None, state="open"):
        return f"find-pr:{repo}:{branch_name}:{title_query}:{state}"

    def create_pull_request(self, user_id, repo, title, head, base=None, body=None, draft=None):
        return f"create-pr:{repo}:{title}:{head}:{base}:{draft}"

    def update_pull_request(self, user_id, repo, pull_number, title=None, body=None, base=None, state=None):
        return f"update-pr:{repo}:{pull_number}:{title}:{base}:{state}"

    def merge_pull_request(self, user_id, repo, pull_number, merge_method="merge", commit_title=None, commit_message=None):
        return f"merge-pr:{repo}:{pull_number}:{merge_method}:{commit_title}:{commit_message}"


class FakeJiraService:
    def status(self, user_id: int):
        return {
            "configured": True,
            "display_name": "Jira",
            "account_label": "MemoLink Cloud",
            "default_project_key": "MEMO",
            "default_issue_type": "Task",
        }

    def search_issues(self, user_id, issue_key=None, jql=None, limit=10):
        return f"search:{issue_key}:{jql}:{limit}"

    def get_issue(self, user_id, issue_key):
        return f"get:{issue_key}"

    def create_issue(self, user_id, project_key=None, summary=None, description=None, issue_type=None):
        return f"create:{project_key}:{summary}:{issue_type}"

    def update_issue(self, user_id, issue_key=None, summary=None, description=None):
        return f"update:{issue_key}:{summary}"

    def transition_issue(self, user_id, issue_key=None, status_name=None):
        return f"transition:{issue_key}:{status_name}"

    def list_transitions(self, user_id, issue_key=None):
        return f"transitions:{issue_key}"

    def comment_issue(self, user_id, issue_key=None, body=None):
        return f"comment:{issue_key}:{body}"

    def list_comments(self, user_id, issue_key=None):
        return f"comments:{issue_key}"


class FakeConversationRepo:
    def add_message(self, conversation_id, role, content, model=None):
        return SimpleNamespace(id=1)

    def get_messages_paginated(self, conversation_id, limit=20, before_id=None):
        return []


class FakeNoteRepo:
    def create_note(self, user_id, title, content, source, workspace_id=None):
        return SimpleNamespace(id=9, title=title)

    def update_note(self, note_id, title, content):
        return SimpleNamespace(id=note_id, title=title or "Updated")

    def get_for_user(self, user_id, workspace_id=None):
        return []


class FakeReminderRepo:
    def create(self, user_id, text, reminder_type, workspace_id=None, description=None, due_date=None, due_time=None):
        return SimpleNamespace(id=3, text=text, due_date=due_date, due_time=due_time)


def test_connectors_service_lists_known_connectors_with_status():
    service = ConnectorsService(
        email_repo=FakeEmailRepo(SimpleNamespace(email_address="person@example.com")),
        teams_repo=FakeTeamsRepo(SimpleNamespace(email="person@tenant.com")),
        connector_repo=FakeConnectorRepo(),
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    connectors = service.list_connectors(1)

    assert [item["id"] for item in connectors] == ["email", "teams", "github", "jira"]
    assert connectors[0]["connected"] is True
    assert connectors[0]["summary"] == "person@example.com"
    assert connectors[2]["summary"] == "octocat/hello-world"
    assert connectors[3]["summary"] == "MEMO"


def test_save_github_settings_preserves_oauth_secret_and_account_label():
    repo = FakeConnectorRepo()
    service = ConnectorsService(
        email_repo=FakeEmailRepo(),
        teams_repo=FakeTeamsRepo(),
        connector_repo=repo,
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    service.save_github_oauth(user_id=1, token="oauth-token", account_label="octocat")
    service.save_github_settings(
        user_id=1,
        owner="retiangson",
        repo="MemoLink",
        branch="main",
        base_url="https://api.github.com",
    )

    saved = repo.get_decrypted_config(1, "github")
    assert saved["secret"] == "oauth-token"
    assert saved["account_label"] == "octocat"
    assert saved["config"]["owner"] == "retiangson"
    assert saved["config"]["repo"] == "MemoLink"
    assert saved["config"]["default_branch"] == "main"


def test_save_jira_settings_preserves_oauth_secret_and_refresh_token():
    repo = FakeConnectorRepo()
    service = ConnectorsService(
        email_repo=FakeEmailRepo(),
        teams_repo=FakeTeamsRepo(),
        connector_repo=repo,
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    service.save_jira_oauth(
        user_id=1,
        access_token="jira-access",
        refresh_token="jira-refresh",
        token_expiry="later",
        site_name="MemoLink Cloud",
        site_url="https://memolink.atlassian.net",
        cloud_id="cloud-123",
    )
    service.save_jira_settings(user_id=1, project_key="MEMO", issue_type="Story")

    saved = repo.get_decrypted_config(1, "jira")
    assert saved["secret"] == "jira-access"
    assert saved["refresh_secret"] == "jira-refresh"
    assert saved["config"]["auth_type"] == "oauth"
    assert saved["config"]["project_key"] == "MEMO"
    assert saved["config"]["issue_type"] == "Story"


def test_action_agent_decision_triggers_for_ticket_request():
    decision = decide_action_agent("Please create a ticket for the login bug and move it into progress.")

    assert decision.should_handle is True
    assert decision.reason == "Smart: action_agent (connectors)"


def test_action_agent_decision_triggers_for_pull_request_request():
    decision = decide_action_agent("Can you create a GitHub pull request from feature/discussion-mode-routing to main and comment if one already exists?")

    assert decision.should_handle is True
    assert decision.reason == "Smart: action_agent (connectors)"


def test_action_agent_executes_github_and_jira_connector_tools():
    runner = ActionAgentRunner(
        conv_repo=FakeConversationRepo(),
        note_repo=FakeNoteRepo(),
        reminder_repo=FakeReminderRepo(),
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    github_result = runner._execute_tool(
        "github_ticket_action",
        {"operation": "start_development", "repo": "octocat/hello-world", "issue_number": 42},
        user_id=1,
        workspace_id=None,
    )
    jira_result = runner._execute_tool(
        "jira_ticket_action",
        {"operation": "transition", "issue_key": "MEMO-42", "status_name": "In Progress"},
        user_id=1,
        workspace_id=None,
    )

    assert github_result == "branch:octocat/hello-world:42:None:None"
    assert jira_result == "transition:MEMO-42:In Progress"


def test_action_agent_executes_github_pull_request_and_comment_tools():
    runner = ActionAgentRunner(
        conv_repo=FakeConversationRepo(),
        note_repo=FakeNoteRepo(),
        reminder_repo=FakeReminderRepo(),
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    create_pr_result = runner._execute_tool(
        "github_ticket_action",
        {
            "operation": "create_pull_request",
            "repo": "octocat/hello-world",
            "title": "Refine discussion routing",
            "head_branch": "feature/discussion-mode-routing",
            "base_branch": "main",
            "draft": False,
        },
        user_id=1,
        workspace_id=None,
    )
    comment_result = runner._execute_tool(
        "github_ticket_action",
        {
            "operation": "comment",
            "repo": "octocat/hello-world",
            "pull_number": 12,
            "comment": "I'm here, the project is MemoLink.",
        },
        user_id=1,
        workspace_id=None,
    )

    assert create_pr_result == "create-pr:octocat/hello-world:Refine discussion routing:feature/discussion-mode-routing:main:False"
    assert comment_result == "comment:octocat/hello-world:12:I'm here, the project is MemoLink."


def test_action_agent_executes_jira_comment_and_transition_listing_tools():
    runner = ActionAgentRunner(
        conv_repo=FakeConversationRepo(),
        note_repo=FakeNoteRepo(),
        reminder_repo=FakeReminderRepo(),
        github_service=FakeGitHubService(),
        jira_service=FakeJiraService(),
    )

    transitions_result = runner._execute_tool(
        "jira_ticket_action",
        {"operation": "list_transitions", "issue_key": "MEMO-42"},
        user_id=1,
        workspace_id=None,
    )
    comment_result = runner._execute_tool(
        "jira_ticket_action",
        {"operation": "comment", "issue_key": "MEMO-42", "comment": "Starting work now."},
        user_id=1,
        workspace_id=None,
    )

    assert transitions_result == "transitions:MEMO-42"
    assert comment_result == "comment:MEMO-42:Starting work now."
