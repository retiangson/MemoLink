from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import RequestContainer, get_request_container

router = APIRouter(prefix="/connectors", tags=["connectors"])


class GitHubConnectorBody(BaseModel):
    token: str = Field(min_length=1)
    owner: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    base_url: str | None = None
    branch: str | None = None


class JiraConnectorBody(BaseModel):
    site_url: str = Field(min_length=1)
    email: str = Field(min_length=1)
    token: str = Field(min_length=1)
    project_key: str = Field(min_length=1)
    issue_type: str | None = None


@router.get("")
def list_connectors(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"connectors": c.connectors().list_connectors(user_id)}


@router.put("/github")
def save_github_connector(
    body: GitHubConnectorBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    token = body.token.strip()
    owner = body.owner.strip()
    repo = body.repo.strip()
    if not token or not owner or not repo:
        raise HTTPException(status_code=400, detail="GitHub token, owner, and repo are required")
    c.connectors().save_github(
        user_id=user_id,
        token=token,
        owner=owner,
        repo=repo,
        base_url=body.base_url,
        branch=body.branch,
    )
    return {"ok": True}


@router.delete("/github")
def delete_github_connector(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    if not c.connectors().delete_github(user_id):
        raise HTTPException(status_code=404, detail="GitHub connector not configured")
    return {"ok": True}


@router.put("/jira")
def save_jira_connector(
    body: JiraConnectorBody,
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    site_url = body.site_url.strip()
    email = body.email.strip()
    token = body.token.strip()
    project_key = body.project_key.strip()
    if not site_url or not email or not token or not project_key:
        raise HTTPException(status_code=400, detail="Jira site URL, email, token, and project key are required")
    c.connectors().save_jira(
        user_id=user_id,
        site_url=site_url,
        email=email,
        token=token,
        project_key=project_key,
        issue_type=body.issue_type,
    )
    return {"ok": True}


@router.delete("/jira")
def delete_jira_connector(
    user_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    if not c.connectors().delete_jira(user_id):
        raise HTTPException(status_code=404, detail="Jira connector not configured")
    return {"ok": True}
