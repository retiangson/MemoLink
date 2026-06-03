"""
MemoGraph Controller - REST API for the AI Knowledge Graph feature.

Endpoints
---------
POST /api/memograph/build?workspace_id=<id>
    Triggers a full graph build for the workspace:
    - Clears any existing graph data
    - Extracts entities from all notes via GPT (batches of 5 notes per call)
    - Stores nodes and edges in graph_nodes / graph_edges tables
    - Returns { nodes: <count>, edges: <count> }

GET  /api/memograph?workspace_id=<id>
    Returns the serialised graph for the frontend canvas:
    { nodes: [{id, label, type, source_id}], links: [{source, target, relationship}] }
    Returns empty arrays if no graph has been built yet.

DELETE /api/memograph?workspace_id=<id>
    Deletes all graph nodes for the workspace (edges cascade).

All endpoints require a valid JWT (Bearer token).
workspace_id is required for build and delete; returns empty graph if omitted for GET.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from memolink_backend.core.security import get_current_user
from memolink_backend.core.db import get_db
from memolink_backend.di.request_container import get_request_container, RequestContainer

router = APIRouter(prefix="/memograph", tags=["memograph"])


@router.post("/build")
def build_graph(
    workspace_id: Optional[int] = None,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    if not workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required")
    result = container.memograph().build(user_id, workspace_id, db)
    return result


@router.get("")
def get_graph(
    workspace_id: Optional[int] = None,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    if not workspace_id:
        return {"nodes": [], "links": []}
    return container.memograph().get_graph(user_id, workspace_id)


@router.delete("")
def clear_graph(
    workspace_id: Optional[int] = None,
    user_id: int = Depends(get_current_user),
    db: Session = Depends(get_db),
    container: RequestContainer = Depends(get_request_container),
):
    if workspace_id:
        container.memograph().clear(user_id, workspace_id, db)
    return {"ok": True}
