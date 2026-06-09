from __future__ import annotations

import base64
from typing import Any

import requests


class JiraConnectorError(Exception):
    pass


class JiraConnectorService:
    def __init__(self, account_repo):
        self._account_repo = account_repo

    def _get_config(self, user_id: int) -> dict[str, Any]:
        cfg = self._account_repo.get_decrypted_config(user_id, "jira")
        if not cfg:
            raise JiraConnectorError("Jira is not configured. Add your site URL, email, token, and default project in Connectors.")
        if not (cfg.get("account_label") or "").strip():
            raise JiraConnectorError("Jira account email is missing from the connector settings.")
        if not (cfg.get("base_url") or "").strip():
            raise JiraConnectorError("Jira site URL is missing from the connector settings.")
        return cfg

    def _auth_header(self, cfg: dict[str, Any]) -> str:
        raw = f"{cfg['account_label']}:{cfg['secret']}".encode("utf-8")
        return base64.b64encode(raw).decode("ascii")

    def _request(self, method: str, cfg: dict[str, Any], path: str, **kwargs) -> requests.Response:
        response = requests.request(
            method,
            f"{cfg['base_url'].rstrip('/')}{path}",
            headers={
                "Authorization": f"Basic {self._auth_header(cfg)}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=30,
            **kwargs,
        )
        if response.status_code >= 400:
            detail = response.text[:400]
            raise JiraConnectorError(f"Jira API {response.status_code}: {detail}")
        return response

    def status(self, user_id: int) -> dict[str, Any]:
        meta = self._account_repo.get_metadata(user_id, "jira")
        if not meta:
            return {"configured": False}
        return {
            "configured": True,
            "display_name": meta["display_name"],
            "account_label": meta.get("account_label"),
            "base_url": meta.get("base_url"),
            "default_project_key": (meta.get("config") or {}).get("project_key"),
            "default_issue_type": (meta.get("config") or {}).get("issue_type"),
        }

    def _resolve_project_key(self, cfg: dict[str, Any], project_key: str | None) -> str:
        chosen = (project_key or (cfg.get("config") or {}).get("project_key") or "").strip()
        if not chosen:
            raise JiraConnectorError("Jira project key is required. Configure a default project or specify it in chat.")
        return chosen

    def search_issues(self, user_id: int, issue_key: str | None = None, jql: str | None = None, limit: int = 10) -> str:
        cfg = self._get_config(user_id)
        if issue_key:
            issue = self._request("GET", cfg, f"/rest/api/3/issue/{issue_key}").json()
            fields = issue.get("fields") or {}
            return (
                f"Jira issue {issue['key']}\n"
                f"Summary: {fields.get('summary', '')}\n"
                f"Status: {(fields.get('status') or {}).get('name', '')}\n"
                f"Type: {(fields.get('issuetype') or {}).get('name', '')}"
            ).strip()

        query = jql or f"project = {self._resolve_project_key(cfg, None)} ORDER BY updated DESC"
        data = self._request(
            "POST",
            cfg,
            "/rest/api/3/search",
            json={"jql": query, "maxResults": max(1, min(limit, 20)), "fields": ["summary", "status", "issuetype"]},
        ).json()
        issues = data.get("issues") or []
        if not issues:
            return "No Jira issues found."
        lines = ["Jira issues:"]
        for issue in issues[:limit]:
            fields = issue.get("fields") or {}
            status_name = ((fields.get("status") or {}).get("name") or "").strip()
            lines.append(f"{issue['key']} [{status_name}] {fields.get('summary', '')}".strip())
        return "\n".join(lines)

    def create_issue(
        self,
        user_id: int,
        project_key: str | None,
        summary: str,
        description: str | None = None,
        issue_type: str | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        key = self._resolve_project_key(cfg, project_key)
        issue_type_name = (issue_type or (cfg.get("config") or {}).get("issue_type") or "Task").strip()
        payload = {
            "fields": {
                "project": {"key": key},
                "summary": summary,
                "issuetype": {"name": issue_type_name},
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": description or ""}],
                        }
                    ],
                },
            }
        }
        item = self._request("POST", cfg, "/rest/api/3/issue", json=payload).json()
        return f"Created Jira issue {item['key']} in project {key}."

    def update_issue(
        self,
        user_id: int,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        fields: dict[str, Any] = {}
        if summary is not None:
            fields["summary"] = summary
        if description is not None:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": description}],
                    }
                ],
            }
        if not fields:
            raise JiraConnectorError("No Jira issue updates were provided.")
        self._request("PUT", cfg, f"/rest/api/3/issue/{issue_key}", json={"fields": fields})
        return f"Updated Jira issue {issue_key}."

    def transition_issue(self, user_id: int, issue_key: str, status_name: str) -> str:
        cfg = self._get_config(user_id)
        transitions = self._request("GET", cfg, f"/rest/api/3/issue/{issue_key}/transitions").json().get("transitions") or []
        target = next((item for item in transitions if (item.get("name") or "").lower() == status_name.lower()), None)
        if not target:
            available = ", ".join(item.get("name", "") for item in transitions if item.get("name"))
            raise JiraConnectorError(
                f"Jira transition '{status_name}' is not available for {issue_key}. Available: {available or 'none'}"
            )
        self._request(
            "POST",
            cfg,
            f"/rest/api/3/issue/{issue_key}/transitions",
            json={"transition": {"id": target["id"]}},
        )
        return f"Moved Jira issue {issue_key} to {target['name']}."
