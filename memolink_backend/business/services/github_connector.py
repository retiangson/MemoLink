from __future__ import annotations

import re
from typing import Any

import requests


class GitHubConnectorError(Exception):
    pass


class GitHubConnectorService:
    def __init__(self, account_repo):
        self._account_repo = account_repo

    def _get_config(self, user_id: int) -> dict[str, Any]:
        cfg = self._account_repo.get_decrypted_config(user_id, "github")
        if not cfg:
            raise GitHubConnectorError("GitHub is not connected. Connect GitHub and set a default repository in Connectors.")
        return cfg

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _default_repo(self, cfg: dict[str, Any]) -> str | None:
        owner = str((cfg.get("config") or {}).get("owner") or "").strip()
        repo = str((cfg.get("config") or {}).get("repo") or "").strip()
        if owner and repo:
            return f"{owner}/{repo}"
        return None

    def _resolve_repo(self, cfg: dict[str, Any], repo: str | None) -> str:
        chosen = (repo or self._default_repo(cfg) or "").strip().strip("/")
        if not chosen or "/" not in chosen:
            raise GitHubConnectorError("GitHub repository is required. Configure a default repo or specify owner/repo in chat.")
        return chosen

    def _api_base(self, cfg: dict[str, Any]) -> str:
        base = (cfg.get("base_url") or "https://api.github.com").strip().rstrip("/")
        return base

    def _default_branch(self, cfg: dict[str, Any]) -> str | None:
        branch = str((cfg.get("config") or {}).get("default_branch") or "").strip()
        return branch or None

    def _request(self, method: str, cfg: dict[str, Any], path: str, **kwargs) -> requests.Response:
        response = requests.request(
            method,
            f"{self._api_base(cfg)}{path}",
            headers=self._headers(cfg["secret"]),
            timeout=30,
            **kwargs,
        )
        if response.status_code >= 400:
            detail = response.text[:400]
            raise GitHubConnectorError(f"GitHub API {response.status_code}: {detail}")
        return response

    def status(self, user_id: int) -> dict[str, Any]:
        meta = self._account_repo.get_metadata(user_id, "github")
        if not meta:
            return {"configured": False}
        return {
            "configured": True,
            "display_name": meta["display_name"],
            "account_label": meta.get("account_label"),
            "base_url": meta.get("base_url"),
            "default_repo": self._default_repo({"config": meta.get("config", {})}),
            "default_branch": (meta.get("config") or {}).get("default_branch"),
        }

    def get_repo(self, user_id: int, repo: str | None = None) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        data = self._request("GET", cfg, f"/repos/{target_repo}").json()
        description = (data.get("description") or "").strip()
        default_branch = data.get("default_branch") or self._default_branch(cfg) or "main"
        visibility = "private" if data.get("private") else "public"
        return (
            f"GitHub repo {target_repo}\n"
            f"Visibility: {visibility}\n"
            f"Default branch: {default_branch}\n"
            f"Open issues: {data.get('open_issues_count', 0)}\n"
            f"Description: {description or 'No description'}"
        )

    def list_branches(self, user_id: int, repo: str | None = None, query: str | None = None, limit: int = 20) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        items = self._request(
            "GET",
            cfg,
            f"/repos/{target_repo}/branches",
            params={"per_page": max(1, min(limit, 50))},
        ).json()
        if query:
            q = query.strip().lower()
            items = [item for item in items if q in str(item.get("name") or "").lower()]
        if not items:
            return f"No GitHub branches found for {target_repo}."
        lines = [f"GitHub branches for {target_repo}:"]
        for item in items[:limit]:
            lines.append(f"- {item['name']}")
        return "\n".join(lines)

    def list_issues(self, user_id: int, repo: str | None, query: str | None = None, state: str = "open", limit: int = 10) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        if query:
            q = f"repo:{target_repo} is:issue {query}".strip()
            data = self._request("GET", cfg, "/search/issues", params={"q": q, "per_page": max(1, min(limit, 20))}).json()
            items = data.get("items", [])
        else:
            items = self._request(
                "GET",
                cfg,
                f"/repos/{target_repo}/issues",
                params={"state": state, "per_page": max(1, min(limit, 20))},
            ).json()
        if not items:
            return f"No GitHub issues found for {target_repo}."
        lines = [f"GitHub issues for {target_repo}:"]
        for item in items[:limit]:
            lines.append(f"#{item['number']} [{item['state']}] {item['title']}")
        return "\n".join(lines)

    def get_issue(self, user_id: int, repo: str | None, issue_number: int) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        item = self._request("GET", cfg, f"/repos/{target_repo}/issues/{issue_number}").json()
        body = (item.get("body") or "").strip()
        snippet = body[:700] + ("…" if len(body) > 700 else "")
        return f"GitHub issue #{item['number']} in {target_repo}\nTitle: {item['title']}\nState: {item['state']}\n\n{snippet}".strip()

    def list_comments(self, user_id: int, repo: str | None, issue_number: int, limit: int = 10) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        items = self._request(
            "GET",
            cfg,
            f"/repos/{target_repo}/issues/{issue_number}/comments",
            params={"per_page": max(1, min(limit, 20))},
        ).json()
        if not items:
            return f"No comments found on #{issue_number} in {target_repo}."
        lines = [f"Comments on #{issue_number} in {target_repo}:"]
        for item in items[:limit]:
            author = ((item.get("user") or {}).get("login") or "unknown").strip()
            body = (item.get("body") or "").strip().replace("\r", " ").replace("\n", " ")
            snippet = body[:180] + ("…" if len(body) > 180 else "")
            lines.append(f"- {author}: {snippet}")
        return "\n".join(lines)

    def comment_issue(self, user_id: int, repo: str | None, issue_number: int, body: str) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        item = self._request(
            "POST",
            cfg,
            f"/repos/{target_repo}/issues/{issue_number}/comments",
            json={"body": body},
        ).json()
        return f"Added comment to #{issue_number} in {target_repo}: {item.get('html_url') or 'comment created'}"

    def create_issue(
        self,
        user_id: int,
        repo: str | None,
        title: str,
        body: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        payload: dict[str, Any] = {"title": title}
        if body:
            payload["body"] = body
        if labels:
            payload["labels"] = labels
        if assignees:
            payload["assignees"] = assignees
        item = self._request("POST", cfg, f"/repos/{target_repo}/issues", json=payload).json()
        return f"Created GitHub issue #{item['number']} in {target_repo}: {item['title']}"

    def update_issue(
        self,
        user_id: int,
        repo: str | None,
        issue_number: int,
        title: str | None = None,
        body: str | None = None,
        state: str | None = None,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        if state is not None:
            payload["state"] = state
        if labels is not None:
            payload["labels"] = labels
        if assignees is not None:
            payload["assignees"] = assignees
        if not payload:
            raise GitHubConnectorError("No GitHub issue updates were provided.")
        item = self._request("PATCH", cfg, f"/repos/{target_repo}/issues/{issue_number}", json=payload).json()
        return f"Updated GitHub issue #{item['number']} in {target_repo}: [{item['state']}] {item['title']}"

    def start_development(
        self,
        user_id: int,
        repo: str | None,
        issue_number: int | None = None,
        branch_name: str | None = None,
        base_branch: str | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        repo_data = self._request("GET", cfg, f"/repos/{target_repo}").json()
        source_branch = base_branch or repo_data.get("default_branch") or "main"
        ref_data = self._request("GET", cfg, f"/repos/{target_repo}/git/ref/heads/{source_branch}").json()
        sha = ref_data["object"]["sha"]
        if not branch_name:
            suffix = f"issue-{issue_number}" if issue_number else "work"
            branch_name = f"feature/{suffix}"
        branch_name = re.sub(r"[^a-zA-Z0-9._/-]+", "-", branch_name.strip()).strip("-/")
        self._request(
            "POST",
            cfg,
            f"/repos/{target_repo}/git/refs",
            json={"ref": f"refs/heads/{branch_name}", "sha": sha},
        )
        issue_text = f" for issue #{issue_number}" if issue_number else ""
        return f"Started development in {target_repo}{issue_text}. Created branch `{branch_name}` from `{source_branch}`."

    def list_pull_requests(
        self,
        user_id: int,
        repo: str | None,
        state: str = "open",
        base: str | None = None,
        head: str | None = None,
        limit: int = 10,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        params: dict[str, Any] = {"state": state, "per_page": max(1, min(limit, 20))}
        if base:
            params["base"] = base.strip()
        if head:
            owner = target_repo.split("/", 1)[0]
            params["head"] = head if ":" in head else f"{owner}:{head.strip()}"
        items = self._request("GET", cfg, f"/repos/{target_repo}/pulls", params=params).json()
        if not items:
            return f"No GitHub pull requests found for {target_repo}."
        lines = [f"GitHub pull requests for {target_repo}:"]
        for item in items[:limit]:
            lines.append(
                f"#{item['number']} [{item['state']}] {item['title']} "
                f"({((item.get('head') or {}).get('ref'))} -> {((item.get('base') or {}).get('ref'))})"
            )
        return "\n".join(lines)

    def get_pull_request(self, user_id: int, repo: str | None, pull_number: int) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        item = self._request("GET", cfg, f"/repos/{target_repo}/pulls/{pull_number}").json()
        body = (item.get("body") or "").strip()
        snippet = body[:700] + ("…" if len(body) > 700 else "")
        return (
            f"GitHub pull request #{item['number']} in {target_repo}\n"
            f"Title: {item['title']}\n"
            f"State: {item['state']}\n"
            f"Head: {((item.get('head') or {}).get('ref') or '?')}\n"
            f"Base: {((item.get('base') or {}).get('ref') or '?')}\n\n"
            f"{snippet}"
        ).strip()

    def find_pull_request(
        self,
        user_id: int,
        repo: str | None,
        branch_name: str | None = None,
        title_query: str | None = None,
        state: str = "open",
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        params: dict[str, Any] = {"state": state, "per_page": 50}
        if branch_name:
            owner = target_repo.split("/", 1)[0]
            params["head"] = branch_name if ":" in branch_name else f"{owner}:{branch_name.strip()}"
        items = self._request("GET", cfg, f"/repos/{target_repo}/pulls", params=params).json()
        if title_query:
            q = title_query.strip().lower()
            items = [item for item in items if q in str(item.get("title") or "").lower()]
        if not items:
            criteria = branch_name or title_query or "the requested criteria"
            return f"No GitHub pull request found in {target_repo} matching {criteria!r}."
        item = items[0]
        return (
            f"Found GitHub pull request #{item['number']} in {target_repo}: "
            f"[{item['state']}] {item['title']} "
            f"({((item.get('head') or {}).get('ref'))} -> {((item.get('base') or {}).get('ref'))})"
        )

    def create_pull_request(
        self,
        user_id: int,
        repo: str | None,
        title: str,
        head: str,
        base: str | None = None,
        body: str | None = None,
        draft: bool | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        payload: dict[str, Any] = {
            "title": title,
            "head": head.strip(),
            "base": (base or self._default_branch(cfg) or "main").strip(),
        }
        if body:
            payload["body"] = body
        if draft is not None:
            payload["draft"] = draft
        item = self._request("POST", cfg, f"/repos/{target_repo}/pulls", json=payload).json()
        return f"Created GitHub pull request #{item['number']} in {target_repo}: {item['title']}"

    def update_pull_request(
        self,
        user_id: int,
        repo: str | None,
        pull_number: int,
        title: str | None = None,
        body: str | None = None,
        base: str | None = None,
        state: str | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        if base is not None:
            payload["base"] = base
        if state is not None:
            payload["state"] = state
        if not payload:
            raise GitHubConnectorError("No GitHub pull request updates were provided.")
        item = self._request("PATCH", cfg, f"/repos/{target_repo}/pulls/{pull_number}", json=payload).json()
        return f"Updated GitHub pull request #{item['number']} in {target_repo}: [{item['state']}] {item['title']}"

    def merge_pull_request(
        self,
        user_id: int,
        repo: str | None,
        pull_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
        commit_message: str | None = None,
    ) -> str:
        cfg = self._get_config(user_id)
        target_repo = self._resolve_repo(cfg, repo)
        payload: dict[str, Any] = {"merge_method": merge_method}
        if commit_title:
            payload["commit_title"] = commit_title
        if commit_message:
            payload["commit_message"] = commit_message
        item = self._request("PUT", cfg, f"/repos/{target_repo}/pulls/{pull_number}/merge", json=payload).json()
        return f"Merged GitHub pull request #{pull_number} in {target_repo}: {item.get('message') or 'merged'}"
