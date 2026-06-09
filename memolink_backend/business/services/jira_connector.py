from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from memolink_backend.core.config import settings


ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token"


class JiraConnectorError(Exception):
    pass


class JiraConnectorService:
    def __init__(self, account_repo):
        self._account_repo = account_repo

    def _get_config(self, user_id: int) -> dict[str, Any]:
        cfg = self._account_repo.get_decrypted_config(user_id, "jira")
        if not cfg:
            raise JiraConnectorError("Jira is not connected. Connect Jira and set a default project in Connectors.")
        return cfg

    def _auth_type(self, cfg: dict[str, Any]) -> str:
        return str((cfg.get("config") or {}).get("auth_type") or "token").strip().lower()

    def _api_headers(self, access_token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _basic_headers(self, cfg: dict[str, Any]) -> dict[str, str]:
        import base64

        account_label = (cfg.get("account_label") or "").strip()
        if not account_label:
            raise JiraConnectorError("Jira account email is missing from the connector settings.")
        raw = f"{account_label}:{cfg['secret']}".encode("utf-8")
        return {
            "Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _token_needs_refresh(self, cfg: dict[str, Any]) -> bool:
        expiry = cfg.get("token_expiry")
        return bool(expiry and isinstance(expiry, datetime) and expiry <= datetime.now(timezone.utc) + timedelta(minutes=2))

    def _refresh_oauth_token(self, user_id: int, cfg: dict[str, Any]) -> dict[str, Any]:
        refresh_token = (cfg.get("refresh_secret") or "").strip()
        cloud_id = str((cfg.get("config") or {}).get("cloud_id") or "").strip()
        if not refresh_token:
            raise JiraConnectorError("Jira refresh token is missing. Reconnect Jira.")
        if not settings.jira_client_id or not settings.jira_client_secret:
            raise JiraConnectorError("Jira OAuth is not fully configured on the server.")

        response = requests.post(
            ATLASSIAN_TOKEN_URL,
            json={
                "grant_type": "refresh_token",
                "client_id": settings.jira_client_id,
                "client_secret": settings.jira_client_secret,
                "refresh_token": refresh_token,
            },
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=30,
        )
        if response.status_code >= 400:
            raise JiraConnectorError(f"Failed to refresh Jira OAuth token: {response.text[:400]}")

        payload = response.json()
        access_token = (payload.get("access_token") or "").strip()
        next_refresh = (payload.get("refresh_token") or refresh_token).strip()
        expires_in = int(payload.get("expires_in") or 3600)
        if not access_token:
            raise JiraConnectorError("Jira OAuth refresh did not return an access token.")

        config = dict(cfg.get("config") or {})
        self._account_repo.upsert(
            user_id=user_id,
            connector_type="jira",
            secret=access_token,
            refresh_secret=next_refresh,
            token_expiry=datetime.now(timezone.utc) + timedelta(seconds=expires_in),
            display_name="Jira",
            account_label=cfg.get("account_label"),
            base_url=f"https://api.atlassian.com/ex/jira/{cloud_id}" if cloud_id else cfg.get("base_url"),
            config=config,
        )
        return self._get_config(user_id)

    def _request(self, method: str, user_id: int, path: str, **kwargs) -> requests.Response:
        cfg = self._get_config(user_id)
        auth_type = self._auth_type(cfg)
        if auth_type == "oauth":
            if self._token_needs_refresh(cfg):
                cfg = self._refresh_oauth_token(user_id, cfg)
            headers = self._api_headers(cfg["secret"])
            base_url = (cfg.get("base_url") or "").strip().rstrip("/")
            if not base_url:
                raise JiraConnectorError("Jira API base URL is missing. Reconnect Jira.")
        else:
            headers = self._basic_headers(cfg)
            base_url = (cfg.get("base_url") or "").strip().rstrip("/")
            if not base_url:
                raise JiraConnectorError("Jira site URL is missing from the connector settings.")

        response = requests.request(
            method,
            f"{base_url}{path}",
            headers=headers,
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
        config = meta.get("config") or {}
        return {
            "configured": True,
            "display_name": meta["display_name"],
            "account_label": meta.get("account_label"),
            "base_url": meta.get("base_url"),
            "site_url": config.get("site_url"),
            "site_name": config.get("site_name"),
            "default_project_key": config.get("project_key"),
            "default_issue_type": config.get("issue_type"),
            "auth_type": config.get("auth_type") or "token",
        }

    def _resolve_project_key(self, cfg: dict[str, Any], project_key: str | None) -> str:
        chosen = (project_key or (cfg.get("config") or {}).get("project_key") or "").strip()
        if not chosen:
            raise JiraConnectorError("Jira project key is required. Configure a default project or specify it in chat.")
        return chosen

    def get_issue(self, user_id: int, issue_key: str) -> str:
        issue = self._request("GET", user_id, f"/rest/api/3/issue/{issue_key}").json()
        fields = issue.get("fields") or {}
        description = self._extract_adf_text(fields.get("description"))
        description_snippet = description[:600] + ("…" if len(description) > 600 else "")
        return (
            f"Jira issue {issue['key']}\n"
            f"Summary: {fields.get('summary', '')}\n"
            f"Status: {(fields.get('status') or {}).get('name', '')}\n"
            f"Type: {(fields.get('issuetype') or {}).get('name', '')}\n\n"
            f"{description_snippet}"
        ).strip()

    def search_issues(self, user_id: int, issue_key: str | None = None, jql: str | None = None, limit: int = 10) -> str:
        if issue_key:
            return self.get_issue(user_id, issue_key)

        cfg = self._get_config(user_id)
        query = jql or f"project = {self._resolve_project_key(cfg, None)} ORDER BY updated DESC"
        data = self._request(
            "POST",
            user_id,
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
                "description": self._plain_text_to_adf(description or ""),
            }
        }
        item = self._request("POST", user_id, "/rest/api/3/issue", json=payload).json()
        return f"Created Jira issue {item['key']} in project {key}."

    def update_issue(
        self,
        user_id: int,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
    ) -> str:
        fields: dict[str, Any] = {}
        if summary is not None:
            fields["summary"] = summary
        if description is not None:
            fields["description"] = self._plain_text_to_adf(description)
        if not fields:
            raise JiraConnectorError("No Jira issue updates were provided.")
        self._request("PUT", user_id, f"/rest/api/3/issue/{issue_key}", json={"fields": fields})
        return f"Updated Jira issue {issue_key}."

    def list_transitions(self, user_id: int, issue_key: str) -> str:
        transitions = self._request("GET", user_id, f"/rest/api/3/issue/{issue_key}/transitions").json().get("transitions") or []
        if not transitions:
            return f"No Jira transitions are available for {issue_key}."
        lines = [f"Jira transitions for {issue_key}:"]
        for item in transitions:
            lines.append(f"- {item.get('name', '')}")
        return "\n".join(lines)

    def transition_issue(self, user_id: int, issue_key: str, status_name: str) -> str:
        transitions = self._request("GET", user_id, f"/rest/api/3/issue/{issue_key}/transitions").json().get("transitions") or []
        target = next((item for item in transitions if (item.get("name") or "").lower() == status_name.lower()), None)
        if not target:
            available = ", ".join(item.get("name", "") for item in transitions if item.get("name"))
            raise JiraConnectorError(
                f"Jira transition '{status_name}' is not available for {issue_key}. Available: {available or 'none'}"
            )
        self._request(
            "POST",
            user_id,
            f"/rest/api/3/issue/{issue_key}/transitions",
            json={"transition": {"id": target["id"]}},
        )
        return f"Moved Jira issue {issue_key} to {target['name']}."

    def list_comments(self, user_id: int, issue_key: str, limit: int = 10) -> str:
        data = self._request(
            "GET",
            user_id,
            f"/rest/api/3/issue/{issue_key}/comment",
            params={"maxResults": max(1, min(limit, 20))},
        ).json()
        comments = data.get("comments") or []
        if not comments:
            return f"No comments found on {issue_key}."
        lines = [f"Comments on {issue_key}:"]
        for item in comments[:limit]:
            author = (((item.get("author") or {}).get("displayName")) or "unknown").strip()
            body = self._extract_adf_text(item.get("body"))
            snippet = body[:180] + ("…" if len(body) > 180 else "")
            lines.append(f"- {author}: {snippet}")
        return "\n".join(lines)

    def comment_issue(self, user_id: int, issue_key: str, body: str) -> str:
        self._request(
            "POST",
            user_id,
            f"/rest/api/3/issue/{issue_key}/comment",
            json={"body": self._plain_text_to_adf(body)},
        )
        return f"Added a Jira comment to {issue_key}."

    def _plain_text_to_adf(self, text: str) -> dict[str, Any]:
        return {
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": text or ""}],
                }
            ],
        }

    def _extract_adf_text(self, body: Any) -> str:
        chunks: list[str] = []

        def visit(node: Any) -> None:
            if isinstance(node, dict):
                if node.get("type") == "text" and isinstance(node.get("text"), str):
                    chunks.append(node["text"])
                for value in node.values():
                    visit(value)
            elif isinstance(node, list):
                for item in node:
                    visit(item)

        visit(body)
        return " ".join(part.strip() for part in chunks if part and part.strip())
