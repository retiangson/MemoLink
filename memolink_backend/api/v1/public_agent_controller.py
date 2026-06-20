"""
Public Portfolio Agent controllers.

Two routers live here on purpose:
- `router` — authenticated, owner-scoped management of PublicAgent rows (create,
  list, get, update, enable/disable, delete, regenerate token). Available to any
  logged-in user, not just admins, subject to the `public_portfolio_agent_min_level`
  access-tier gate below.
- `public_router` — the single unauthenticated endpoint a visitor's browser/widget
  calls. It never accepts a user id and never touches anything outside the
  PublicAgentService's retrieval path.

Both routers are gated by the `public_portfolio_agent_enabled` feature flag — when
the flag is off, the whole feature returns 404, as if it doesn't exist. The
authenticated `router` additionally requires the caller's `access_level` to meet
`public_portfolio_agent_min_level` (admins always pass).
"""
import time
from collections import defaultdict, deque
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from memolink_backend.core.db import get_db
from memolink_backend.core.security import get_current_user, get_current_user_info, UserInfo, level_meets
from memolink_backend.di.request_container import RequestContainer, get_request_container
from memolink_backend.contracts.public_agent_dtos import (
    PublicAgentCreateDTO,
    PublicAgentUpdateDTO,
    PublicAgentGetDTO,
    PublicAgentDeleteDTO,
    PublicAgentRegenerateTokenDTO,
    PublicAgentResponseDTO,
    PublicAgentChatRequestDTO,
    PublicAgentChatResponseDTO,
)
from memolink_backend.business.services.public_agent_service import (
    PublicAgentNotFoundError,
    PublicAgentDisabledError,
    PublicAgentDomainNotAllowedError,
    PublicAgentAccessDeniedError,
)

router = APIRouter(prefix="/public-agents", tags=["public-agents"])
public_router = APIRouter(prefix="/public/agents", tags=["public-agent-chat"])


def _feature_flag_enabled(db: Session) -> bool:
    row = db.execute(
        text("SELECT value FROM feature_flags WHERE key = 'public_portfolio_agent_enabled'")
    ).fetchone()
    return (row[0] if row else "false") == "true"


def require_public_agent_feature(db: Session = Depends(get_db)) -> None:
    if not _feature_flag_enabled(db):
        raise HTTPException(status_code=404, detail="Not found")


# Available to any logged-in user (not admin-only) once the feature flag is on,
# subject to the same per-feature access-level tiering as every other feature
# (see features_controller.py's _LEVEL_GATED). Admins always pass regardless of tier.
def require_public_agent_level(
    user_info: UserInfo = Depends(get_current_user_info),
    db: Session = Depends(get_db),
) -> None:
    if user_info.is_admin:
        return
    row = db.execute(
        text("SELECT value FROM feature_flags WHERE key = 'public_portfolio_agent_min_level'")
    ).fetchone()
    min_level = row[0] if row else "regular"
    if not level_meets(user_info.access_level, min_level):
        raise HTTPException(status_code=403, detail="Public Portfolio Agents require a higher access level")


# ── Simple in-memory rate limiter for the public chat endpoint ───────────────
# Sliding window per (agent token, client ip). Deliberately minimal — this is a
# single-process extension point. If the backend ever scales to multiple
# processes/instances, swap `_rate_limit_buckets` for a shared store (e.g. Redis)
# behind the same `_check_rate_limit` function signature; nothing else needs to change.
_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_REQUESTS = 20
_rate_limit_buckets: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(key: str) -> None:
    now = time.monotonic()
    bucket = _rate_limit_buckets[key]
    while bucket and now - bucket[0] > _RATE_LIMIT_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many requests — please slow down and try again shortly")
    bucket.append(now)


# ── Authenticated management ──────────────────────────────────────────────────

@router.post("", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def create_public_agent(
    dto: PublicAgentCreateDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.public_agent().create_agent(dto, owner_id)


@router.post("/list", response_model=list[PublicAgentResponseDTO], dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def list_public_agents(
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return c.public_agent().list_agents(owner_id)


@router.post("/get", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def get_public_agent(
    dto: PublicAgentGetDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.public_agent().get_agent(dto.agent_id, owner_id))


@router.post("/update", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def update_public_agent(
    dto: PublicAgentUpdateDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.public_agent().update_agent(dto, owner_id))


@router.post("/enable", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def enable_public_agent(
    dto: PublicAgentGetDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.public_agent().set_enabled(dto.agent_id, owner_id, True))


@router.post("/disable", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def disable_public_agent(
    dto: PublicAgentGetDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.public_agent().set_enabled(dto.agent_id, owner_id, False))


@router.post("/regenerate-token", response_model=PublicAgentResponseDTO, dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def regenerate_public_agent_token(
    dto: PublicAgentRegenerateTokenDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return _handle(lambda: c.public_agent().regenerate_token(dto.agent_id, owner_id))


@router.post("/delete", dependencies=[Depends(require_public_agent_feature), Depends(require_public_agent_level)])
def delete_public_agent(
    dto: PublicAgentDeleteDTO,
    owner_id: int = Depends(get_current_user),
    c: RequestContainer = Depends(get_request_container),
):
    return {"ok": _handle(lambda: c.public_agent().delete_agent(dto.agent_id, owner_id))}


def _origin_from_referer(referer: Optional[str]) -> Optional[str]:
    if not referer:
        return None
    parsed = urlparse(referer)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _handle(fn):
    try:
        return fn()
    except PublicAgentNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PublicAgentAccessDeniedError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ── Public, unauthenticated chat ──────────────────────────────────────────────

@public_router.post(
    "/{agent_token}/chat",
    response_model=PublicAgentChatResponseDTO,
    dependencies=[Depends(require_public_agent_feature)],
)
def public_agent_chat(
    agent_token: str,
    dto: PublicAgentChatRequestDTO,
    request: Request,
    c: RequestContainer = Depends(get_request_container),
):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(f"{agent_token}:{client_ip}")

    origin = request.headers.get("origin") or _origin_from_referer(request.headers.get("referer"))
    try:
        return c.public_agent().answer_public_chat(agent_token, dto.message, origin)
    except PublicAgentNotFoundError:
        raise HTTPException(status_code=404, detail="Agent not found")
    except PublicAgentDisabledError:
        raise HTTPException(status_code=403, detail="This agent is not currently available")
    except PublicAgentDomainNotAllowedError:
        raise HTTPException(status_code=403, detail="This site is not permitted to use this agent")
