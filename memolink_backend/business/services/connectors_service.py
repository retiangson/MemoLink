from __future__ import annotations

from typing import Any


CONNECTOR_CATALOG = [
    {
        "id": "email",
        "label": "Email",
        "kind": "oauth",
        "description": "Sync Gmail, turn emails into notes, and create reminders from deadlines.",
    },
    {
        "id": "teams",
        "label": "Teams",
        "kind": "oauth",
        "description": "Read work chats, reply, and save conversations back into your knowledge base.",
    },
    {
        "id": "github",
        "label": "GitHub",
        "kind": "token",
        "description": "Check issues, create tickets, update tickets, and start development branches from chat.",
    },
    {
        "id": "jira",
        "label": "Jira",
        "kind": "token",
        "description": "Check tickets, create work items, update issues, and move them through workflow from chat.",
    },
]


class ConnectorsService:
    def __init__(self, email_repo, teams_repo, connector_repo, github_service, jira_service):
        self._email_repo = email_repo
        self._teams_repo = teams_repo
        self._connector_repo = connector_repo
        self._github = github_service
        self._jira = jira_service

    def list_connectors(self, user_id: int) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        email_row = self._email_repo.get_by_user_id(user_id)
        teams_row = self._teams_repo.get_by_user_id(user_id)
        github_status = self._github.status(user_id)
        jira_status = self._jira.status(user_id)
        for item in CONNECTOR_CATALOG:
            connector = dict(item)
            if item["id"] == "email":
                connector["connected"] = bool(email_row)
                connector["summary"] = email_row.email_address if email_row else None
            elif item["id"] == "teams":
                connector["connected"] = bool(teams_row)
                connector["summary"] = teams_row.email if teams_row else None
            elif item["id"] == "github":
                connector["connected"] = bool(github_status.get("configured"))
                connector["summary"] = github_status.get("default_repo") or github_status.get("account_label")
                connector["config"] = github_status
            elif item["id"] == "jira":
                connector["connected"] = bool(jira_status.get("configured"))
                connector["summary"] = jira_status.get("default_project_key") or jira_status.get("account_label")
                connector["config"] = jira_status
            result.append(connector)
        return result

    def save_github(self, *, user_id: int, token: str, owner: str, repo: str, base_url: str | None = None, branch: str | None = None):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="github",
            secret=token,
            display_name="GitHub",
            account_label=owner.strip() or None,
            base_url=(base_url or "").strip() or None,
            config={
                "owner": owner.strip(),
                "repo": repo.strip(),
                "default_branch": (branch or "").strip() or None,
            },
        )

    def delete_github(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "github")

    def save_jira(
        self,
        *,
        user_id: int,
        site_url: str,
        email: str,
        token: str,
        project_key: str,
        issue_type: str | None = None,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=token,
            display_name="Jira",
            account_label=email.strip(),
            base_url=site_url.strip().rstrip("/"),
            config={
                "project_key": project_key.strip(),
                "issue_type": (issue_type or "").strip() or "Task",
            },
        )

    def delete_jira(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "jira")
