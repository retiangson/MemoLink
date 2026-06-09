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


class FakeGitHubService:
    def status(self, user_id: int):
        return {
            "configured": True,
            "display_name": "GitHub",
            "account_label": "octocat",
            "default_repo": "octocat/hello-world",
        }

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


class FakeJiraService:
    def status(self, user_id: int):
        return {
            "configured": True,
            "display_name": "Jira",
            "account_label": "me@example.com",
            "default_project_key": "MEMO",
            "default_issue_type": "Task",
        }

    def search_issues(self, user_id, issue_key=None, jql=None, limit=10):
        return f"search:{issue_key}:{jql}:{limit}"

    def create_issue(self, user_id, project_key=None, summary=None, description=None, issue_type=None):
        return f"create:{project_key}:{summary}:{issue_type}"

    def update_issue(self, user_id, issue_key=None, summary=None, description=None):
        return f"update:{issue_key}:{summary}"

    def transition_issue(self, user_id, issue_key=None, status_name=None):
        return f"transition:{issue_key}:{status_name}"


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


def test_action_agent_decision_triggers_for_ticket_request():
    decision = decide_action_agent("Please create a ticket for the login bug and move it into progress.")

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
