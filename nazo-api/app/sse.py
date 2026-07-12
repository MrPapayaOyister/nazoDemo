# -*- coding: utf-8 -*-
"""The 5-event SSE contract over sse-starlette's EventSourceResponse.

Event names (data is a JSON object):
  stage_started  {stage, label_en, label_ar}
  stage_note     {note_en, note_ar}            HEARTBEAT — emitted at most every
                                               ~2s WHILE the model generates. This
                                               is load-bearing: it keeps the UI's
                                               "thinking" state alive across a 5-8s
                                               hero call so the connection is never
                                               mistaken for a stall.
  result         {card, effects}
  error          {message_en, message_ar, recoverable}
  done           {jobId}

run_action_stream(job_id, stages, produce) drives one action end-to-end:
  * emits stage_started for each declared stage,
  * runs a background heartbeat that pumps stage_note every ~2s while produce()
    is awaited,
  * on success emits result then done,
  * on ANY exception emits a graceful error then done (never a 500 mid-stream).

Each yielded item is a dict {"event": name, "data": json} that EventSourceResponse
serializes into a proper SSE frame.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

logger = logging.getLogger("nazo.sse")

# Heartbeat cadence (seconds). Kept under the 2.5s UI budget from the contract.
HEARTBEAT_INTERVAL = 2.0

# A "stage" declared by an action. label_* name the phase; note_* (optional)
# provide heartbeat copy while that work runs.
Stage = dict[str, str]

# produce() returns the finished payload: {"card": ResultCard, "effects": [...]}.
Produce = Callable[[], Awaitable[dict[str, Any]]]


class SSEError(Exception):
    """A graceful, user-facing action error carrying bilingual copy.

    produce() raises this to emit a specific 'error' frame (e.g. a "coming in
    step 6" notice) instead of the generic fallback message.
    """

    def __init__(
        self,
        message_en: str,
        message_ar: str,
        recoverable: bool = True,
    ) -> None:
        super().__init__(message_en)
        self.message_en = message_en
        self.message_ar = message_ar
        self.recoverable = recoverable


def _frame(event: str, data: dict[str, Any]) -> dict[str, str]:
    """Format one SSE frame for EventSourceResponse."""
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


def stage_started(stage: Stage) -> dict[str, str]:
    return _frame(
        "stage_started",
        {
            "stage": stage.get("stage", ""),
            "label_en": stage.get("label_en", ""),
            "label_ar": stage.get("label_ar", ""),
        },
    )


def stage_note(note_en: str, note_ar: str) -> dict[str, str]:
    return _frame("stage_note", {"note_en": note_en, "note_ar": note_ar})


def result_event(payload: dict[str, Any]) -> dict[str, str]:
    return _frame(
        "result",
        {"card": payload.get("card"), "effects": payload.get("effects", [])},
    )


def error_event(
    message_en: str, message_ar: str, recoverable: bool = True
) -> dict[str, str]:
    return _frame(
        "error",
        {
            "message_en": message_en,
            "message_ar": message_ar,
            "recoverable": recoverable,
        },
    )


def done_event(job_id: str) -> dict[str, str]:
    return _frame("done", {"jobId": job_id})


def _heartbeat_notes(stages: list[Stage]) -> list[tuple[str, str]]:
    """Build the rotating heartbeat copy from the declared stages.

    Prefer explicit note_en/note_ar; fall back to the stage labels. Always
    returns at least one pair so the heartbeat has something to say.
    """
    notes: list[tuple[str, str]] = []
    for st in stages:
        en = st.get("note_en") or st.get("label_en") or "Working…"
        ar = st.get("note_ar") or st.get("label_ar") or "جارٍ العمل…"
        notes.append((en, ar))
    if not notes:
        notes.append(("Working…", "جارٍ العمل…"))
    return notes


async def run_action_stream(
    job_id: str,
    stages: list[Stage],
    produce: Produce,
    *,
    on_success: Optional[Callable[[dict[str, Any]], None]] = None,
    on_error: Optional[Callable[[Exception], None]] = None,
) -> AsyncIterator[dict[str, str]]:
    """Yield the 5-event contract for a single AI action.

    on_success/on_error are optional side-channel callbacks (e.g. to persist the
    AiJob row) invoked with the produced payload / raised exception. They must not
    raise; failures there are logged and swallowed so the stream still closes.
    """
    queue: asyncio.Queue[Optional[dict[str, str]]] = asyncio.Queue()
    _SENTINEL: Optional[dict[str, str]] = None
    stop = asyncio.Event()
    notes = _heartbeat_notes(stages)

    async def worker() -> None:
        try:
            for st in stages:
                await queue.put(stage_started(st))
            payload = await produce()
            await queue.put(result_event(payload))
            if on_success is not None:
                try:
                    on_success(payload)
                except Exception:  # noqa: BLE001
                    logger.exception("ai on_success callback failed for %s", job_id)
        except SSEError as exc:  # explicit, user-facing bilingual error
            logger.info("ai action %s reported: %s", job_id, exc.message_en)
            await queue.put(
                error_event(exc.message_en, exc.message_ar, recoverable=exc.recoverable)
            )
            if on_error is not None:
                try:
                    on_error(exc)
                except Exception:  # noqa: BLE001
                    logger.exception("ai on_error callback failed for %s", job_id)
        except Exception as exc:  # noqa: BLE001 - graceful SSE error, never a 500
            logger.exception("ai action %s failed", job_id)
            await queue.put(
                error_event(
                    "The assistant hit a snag. Please try again.",
                    "واجه المساعد مشكلة. يرجى المحاولة مرة أخرى.",
                    recoverable=True,
                )
            )
            if on_error is not None:
                try:
                    on_error(exc)
                except Exception:  # noqa: BLE001
                    logger.exception("ai on_error callback failed for %s", job_id)
        finally:
            stop.set()
            await queue.put(done_event(job_id))
            await queue.put(_SENTINEL)

    async def heartbeat() -> None:
        i = 0
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL)
            except asyncio.TimeoutError:
                # Re-check stop before emitting: if the timeout fired on the same
                # tick the worker set stop (and enqueued result/done), skip the note
                # so a stage_note can never be observed AFTER done.
                if stop.is_set():
                    break
                en, ar = notes[i % len(notes)]
                await queue.put(stage_note(en, ar))
                i += 1

    worker_task = asyncio.create_task(worker())
    hb_task = asyncio.create_task(heartbeat())
    try:
        while True:
            item = await queue.get()
            if item is _SENTINEL:
                break
            yield item
    finally:
        # On normal completion both tasks are already done, so cancel() is a no-op.
        # On early client disconnect the consumer loop exits while the worker may
        # still be suspended inside the up-to-60s httpx LLM request; cancel it
        # BEFORE awaiting so cancellation propagates into the httpx call and frees
        # the vLLM generation promptly instead of blocking aclose() until it ends.
        stop.set()
        hb_task.cancel()
        worker_task.cancel()
        for task in (hb_task, worker_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:  # noqa: BLE001
                logger.exception("ai task cleanup for %s", job_id)
