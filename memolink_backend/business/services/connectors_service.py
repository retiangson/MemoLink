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
        "kind": "oauth",
        "description": "Work with repos, branches, issues, pull requests, comments, merges, and development branches from chat.",
    },
    {
        "id": "jira",
        "label": "Jira",
        "kind": "oauth",
        "description": "Check tickets, create work items, update issues, comment on them, and move them through workflow from chat.",
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

    def save_github_oauth(
        self,
        *,
        user_id: int,
        token: str,
        account_label: str | None,
        base_url: str | None = None,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="github",
            secret=token,
            display_name="GitHub",
            account_label=(account_label or "").strip() or None,
            base_url=(base_url or "").strip() or None,
            config={},
        )

    def save_github_settings(
        self,
        *,
        user_id: int,
        owner: str | None = None,
        repo: str | None = None,
        base_url: str | None = None,
        branch: str | None = None,
    ):
        existing = self._connector_repo.get_decrypted_config(user_id, "github")
        if not existing:
            raise ValueError("Connect GitHub before saving repository settings.")

        prior_config = dict(existing.get("config") or {})
        owner_value = None if owner is None else owner.strip()
        repo_value = None if repo is None else repo.strip()
        if owner_value is None and repo_value is None:
            resolved_owner = str(prior_config.get("owner") or "")
            resolved_repo = str(prior_config.get("repo") or "")
        else:
            if bool(owner_value) != bool(repo_value):
                raise ValueError("GitHub owner and repository must be provided together.")
            resolved_owner = owner_value or ""
            resolved_repo = repo_value or ""
        branch_value = prior_config.get("default_branch") if branch is None else ((branch or "").strip() or None)
        base_url_value = existing.get("base_url") if base_url is None else ((base_url or "").strip() or None)
        merged_config = {
            "owner": resolved_owner,
            "repo": resolved_repo,
            "default_branch": branch_value,
        }
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="github",
            secret=existing["secret"],
            display_name="GitHub",
            account_label=existing.get("account_label"),
            base_url=base_url_value,
            config=merged_config,
        )

    def delete_github(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "github")

    def save_jira_oauth(
        self,
        *,
        user_id: int,
        access_token: str,
        refresh_token: str | None,
        token_expiry,
        site_name: str | None,
        site_url: str,
        cloud_id: str,
    ):
        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=access_token,
            display_name="Jira",
            account_label=(site_name or "").strip() or None,
            base_url=f"https://api.atlassian.com/ex/jira/{cloud_id.strip()}",
            config={
                "auth_type": "oauth",
                "site_name": (site_name or "").strip() or None,
                "site_url": site_url.strip().rstrip("/"),
                "cloud_id": cloud_id.strip(),
                "project_key": "",
                "issue_type": "Task",
            },
            refresh_secret=(refresh_token or "").strip() or None,
            token_expiry=token_expiry,
        )

    def save_jira_settings(
        self,
        *,
        user_id: int,
        project_key: str | None = None,
        issue_type: str | None = None,
    ):
        existing = self._connector_repo.get_decrypted_config(user_id, "jira")
        if not existing:
            raise ValueError("Connect Jira before saving project settings.")

        prior_config = dict(existing.get("config") or {})
        resolved_project_key = str(prior_config.get("project_key") or "")
        if project_key is not None:
            resolved_project_key = project_key.strip()
        resolved_issue_type = str(prior_config.get("issue_type") or "Task")
        if issue_type is not None:
            resolved_issue_type = issue_type.strip() or "Task"

        merged_config = dict(prior_config)
        merged_config["project_key"] = resolved_project_key
        merged_config["issue_type"] = resolved_issue_type

        return self._connector_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=existing["secret"],
            display_name="Jira",
            account_label=existing.get("account_label"),
            base_url=existing.get("base_url"),
            config=merged_config,
            refresh_secret=existing.get("refresh_secret"),
            token_expiry=existing.get("token_expiry"),
        )

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
                "auth_type": "token",
                "project_key": project_key.strip(),
                "issue_type": (issue_type or "").strip() or "Task",
                "site_url": site_url.strip().rstrip("/"),
            },
        )

    def delete_jira(self, user_id: int) -> bool:
        return self._connector_repo.delete_by_user_and_type(user_id, "jira")
