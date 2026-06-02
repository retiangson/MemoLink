"""
Workflow Agent Controller
=========================

POST /api/workflow/plan     Phase 1 — analyse prompt, return proposed actions (JSON)
POST /api/workflow/execute  Phase 2 — execute approved actions (SSE stream)

Both endpoints require a valid JWT.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from memolink_backend.core.security import get_current_user
from memolink_backend.di.request_container import get_request_container, RequestContainer
from memolink_backend.contracts.workflow_dtos import (
    WorkflowPlanRequest, WorkflowPlanResponse,
    WorkflowExecuteRequest,
    WorkflowSuggestRequest, WorkflowSuggestResponse,
)

router = APIRouter(prefix="/workflow", tags=["workflow"])


@router.post("/suggest", response_model=WorkflowSuggestResponse)
def suggest_actions(
    body: WorkflowSuggestRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    """
    Analyse an AI response and return 0–3 suggested quick actions.
    Called automatically by the frontend after every chat response when workflow is enabled.
    """
    actions = container.workflow().suggest(
        message=body.message,
        workspace_id=body.workspace_id,
        user_id=user_id,
    )
    return WorkflowSuggestResponse(actions=actions)


@router.post("/plan", response_model=WorkflowPlanResponse)
def plan_workflow(
    body: WorkflowPlanRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return container.workflow().plan(
        user_id=user_id,
        conversation_id=body.conversation_id,
        prompt=body.prompt,
        workspace_id=body.workspace_id,
        model=body.model,
    )


@router.post("/execute")
def execute_workflow(
    body: WorkflowExecuteRequest,
    user_id: int = Depends(get_current_user),
    container: RequestContainer = Depends(get_request_container),
):
    return StreamingResponse(
        container.workflow().execute_stream(
            user_id=user_id,
            conversation_id=body.conversation_id,
            actions=body.actions,
            workspace_id=body.workspace_id,
            model=body.model,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
