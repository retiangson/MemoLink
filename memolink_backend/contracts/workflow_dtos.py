"""
Workflow Agent DTOs
===================
Contracts for the two-phase Workflow Agent with Human Approval.

Phase 1 — Plan:   POST /api/workflow/plan
Phase 2 — Execute: POST /api/workflow/execute  (SSE stream)
"""

from typing import List, Optional, Any, Dict
from pydantic import BaseModel


# ── Phase 1: Plan ─────────────────────────────────────────────────────────────

class WorkflowPlanRequest(BaseModel):
    conversation_id: int
    prompt: str
    workspace_id: Optional[int] = None
    model: Optional[str] = None


class WorkflowAction(BaseModel):
    id: str                     # e.g. "a1", "a2" — stable client-side identifier
    type: str                   # one of the 8 action types
    label: str                  # human-readable: "Create reminder: Submit report"
    preview: str                # short outcome preview: "⏰ due 2026-06-06"
    params: Dict[str, Any]      # action-specific payload passed to executor


class WorkflowPlanResponse(BaseModel):
    message_id: int             # DB ID of the __WORKFLOW_PLAN__ assistant message
    conversation_id: int
    understanding: str          # AI's plain-English summary of the request
    actions: List[WorkflowAction]


# ── Phase 2: Execute ──────────────────────────────────────────────────────────

class WorkflowExecuteRequest(BaseModel):
    conversation_id: int
    actions: List[WorkflowAction]   # only the user-approved subset
    workspace_id: Optional[int] = None
    model: Optional[str] = None
