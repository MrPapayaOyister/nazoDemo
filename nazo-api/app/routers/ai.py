# -*- coding: utf-8 -*-
"""SSE surface for the conversational AI actions (Phase 3 Step 5).

POST /api/ai/{action_id}
  body: AiContext {role?, currentUserId?, corrId?, docId?, targetId?, workflowId?,
                   stage?, prompt?}
  returns: text/event-stream emitting the 5-event contract (app/sse.py):
           stage_started · stage_note (heartbeat) · result · error · done

The request-scoped Session from Depends(get_session) is only used to validate the
caller and record the AiJob BEFORE streaming begins — it is closed once the
endpoint returns. All work that happens DURING streaming (LLM calls, effect
building, AiJob finalization) opens its own fresh Session bound to the shared
engine, because the streaming body runs after the dependency session is gone.

Errors never surface as a 500 mid-stream: run_action_stream converts any handler
exception into a graceful 'error' event, then 'done'.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel
from sqlmodel import Session
from sse_starlette.sse import EventSourceResponse

from app.db import engine
from app.deps import get_current_user, get_session
from app.models import AiJob, AppUser
from app.services import ai_actions, workflow
from app.sse import run_action_stream

logger = logging.getLogger("nazo.ai.router")

router = APIRouter(prefix="/api/ai", tags=["ai"])

# No-cache / no-buffering headers so the stream flushes immediately through any
# reverse proxy (EventSourceResponse also sets the SSE content-type + keep-alive).
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


class AiContextBody(BaseModel):
    role: Optional[str] = None
    currentUserId: Optional[str] = None
    corrId: Optional[str] = None
    docId: Optional[str] = None
    targetId: Optional[str] = None
    workflowId: Optional[str] = None
    stage: Optional[int] = None
    prompt: Optional[str] = None
    # Create-draft field values carried from the frontend store (the draft is not
    # yet a Correspondence, so its values live only client-side). Used by
    # requester.checkErrors to validate an unsent draft on /requester/new.
    values: Optional[dict[str, str]] = None
    # Template-generation controls (admin.generateTemplate).
    size: Optional[str] = None  # 'small' | 'medium' | 'large' (default large downstream)
    lang: Optional[str] = None  # 'en' | 'ar' explicit override (else auto-detected)


def _finalize_job(job_id: str, *, status: str, output: Optional[dict] = None, error: Optional[str] = None) -> None:
    """Update the AiJob row in a fresh session (called during streaming)."""
    try:
        with Session(engine) as s:
            job = s.get(AiJob, job_id)
            if job is None:
                return
            job.status = status
            if output is not None:
                job.output = output
            if error is not None:
                job.error = error
            s.add(job)
            s.commit()
    except Exception:  # noqa: BLE001 - job bookkeeping must never break the stream
        logger.exception("failed to finalize AiJob %s", job_id)


@router.post("/{action_id}")
def run_ai_action(
    body: AiContextBody = AiContextBody(),
    action_id: str = Path(..., description="dotted AiActionId, e.g. requester.autoFill"),
    session: Session = Depends(get_session),
    current_user: AppUser = Depends(get_current_user),
) -> EventSourceResponse:
    # Resolve identity: header-derived current_user is the source of truth; the
    # body may override role/currentUserId for the scenario context.
    user_id = body.currentUserId or current_user.id
    role = body.role or current_user.role

    # Capture identity as PRIMITIVES now, while current_user is still attached to
    # the live request session. The streaming phase runs after that session closes
    # (and on the event-loop thread), so touching the detached ORM object there
    # risks a DetachedInstanceError. produce() rebuilds a fallback from these.
    header_user_id = current_user.id
    fallback_role = current_user.role
    fallback_title = current_user.title_en
    fallback_name = current_user.name_en

    ctx: dict[str, Any] = {
        "actionId": action_id,
        "role": role,
        "currentUserId": user_id,
        "corrId": body.corrId,
        "docId": body.docId,
        "targetId": body.targetId,
        "workflowId": body.workflowId,
        "stage": body.stage,
        "prompt": body.prompt,
        "values": body.values,
        "size": body.size,
        "lang": body.lang,
    }

    # Record the job as running BEFORE streaming (request session is still open).
    job_id = workflow.gen_id("aijob")
    job = AiJob(
        id=job_id,
        action_id=action_id,
        status="running",
        correspondence_id=body.corrId,
        input={k: v for k, v in ctx.items() if v is not None},
        output={},
        error=None,
        created_at=workflow.now_iso(),
    )
    session.add(job)
    session.commit()

    stages = ai_actions.stages_for(action_id)

    async def produce() -> dict[str, Any]:
        # Fresh session for the streaming phase (the dependency session is closed by
        # the time this runs). The LLM call is awaited HERE on the event loop — not
        # off-loaded to a thread — so that on client disconnect run_action_stream's
        # worker_task.cancel() propagates CancelledError into the in-flight httpx
        # request and tears the vLLM generation down promptly. The synchronous DB
        # gets are brief; keeping them here is the accepted tradeoff for reliable
        # cancellation. (Under real concurrency, split DB off-loop per the review.)
        with Session(engine) as s:
            user: Any = s.get(AppUser, user_id) or s.get(AppUser, header_user_id)
            if user is None:
                # Bogus currentUserId and no header row: synthesize a lightweight
                # identity from the captured primitives rather than touching the
                # detached request-session ORM object across sessions/threads.
                user = SimpleNamespace(
                    id=user_id or header_user_id,
                    role=fallback_role,
                    title_en=fallback_title,
                    name_en=fallback_name,
                )
            return await ai_actions.run_action(s, user, action_id, ctx)

    def _schedule_finalize(**kwargs: Any) -> None:
        # on_success/on_error are sync callbacks invoked from the streaming worker
        # on the event loop; push the blocking DB commit onto the default executor
        # so it does not stall the loop mid-stream.
        try:
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, functools.partial(_finalize_job, job_id, **kwargs))
        except RuntimeError:  # no running loop (defensive) — do it inline
            _finalize_job(job_id, **kwargs)

    def on_success(payload: dict[str, Any]) -> None:
        _schedule_finalize(status="done", output=payload)

    def on_error(exc: Exception) -> None:
        _schedule_finalize(status="error", error=str(exc))

    generator = run_action_stream(
        job_id,
        stages,
        produce,
        on_success=on_success,
        on_error=on_error,
    )
    return EventSourceResponse(generator, headers=_SSE_HEADERS)
