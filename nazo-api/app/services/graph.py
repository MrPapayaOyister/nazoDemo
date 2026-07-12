"""Position-less node/edge read-model for the xyflow canvas.

The backend emits pure graph topology (no x/y) and the client lays it out with
dagre. Nodes: a synthetic 'start', one node per CorrespondenceStep, a synthetic
'end'. Edges: 'forward' edges chaining consecutive CHAIN steps (start -> ... ->
end) and a dashed 'detour' edge parent -> detour for each detour step. Reject
routing is not a separate edge — each node carries `rejectable` so the canvas can
draw its own reject affordance.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.models import AppUser, Correspondence, CorrespondenceStep


def _label(step: CorrespondenceStep, users: dict[str, AppUser]) -> str:
    user = users.get(step.assignee_id)
    name = user.name_en if user else step.assignee_id
    return f"{step.role} · {name}"


def _node_kind(step: CorrespondenceStep) -> str:
    return "detour" if step.detour_of_step_id is not None else step.type


def project(session: Session, corr_id: str) -> dict[str, Any]:
    """Project a correspondence's steps into {nodes, edges} (no coordinates)."""
    corr = session.get(Correspondence, corr_id)
    if corr is None:
        raise KeyError(corr_id)

    steps = list(
        session.exec(
            select(CorrespondenceStep).where(
                CorrespondenceStep.correspondence_id == corr_id
            )
        ).all()
    )
    steps.sort(key=lambda s: (s.step_order, s.id))
    users = {u.id: u for u in session.exec(select(AppUser)).all()}

    chain = [s for s in steps if s.detour_of_step_id is None]
    detours = [s for s in steps if s.detour_of_step_id is not None]

    nodes: list[dict[str, Any]] = [
        {"id": "start", "kind": "start", "label": "Start", "status": "done", "data": {}},
    ]
    for s in steps:
        nodes.append(
            {
                "id": s.id,
                "kind": _node_kind(s),
                "label": _label(s, users),
                "status": s.status,
                "data": {
                    "stepOrder": s.step_order,
                    "role": s.role,
                    "assigneeId": s.assignee_id,
                    "type": s.type,
                    "sign": s.sign,
                    "rejectable": s.rejectable,
                    "detourOfStepId": s.detour_of_step_id,
                    "unitEn": s.unit_en,
                    "unitAr": s.unit_ar,
                },
            }
        )
    nodes.append(
        {"id": "end", "kind": "end", "label": "End", "status": corr.status, "data": {}}
    )

    edges: list[dict[str, Any]] = []
    # Forward spine through the chain steps.
    if chain:
        edges.append(
            {"id": "e_start", "source": "start", "target": chain[0].id, "kind": "forward"}
        )
        for a, b in zip(chain, chain[1:]):
            edges.append(
                {"id": f"e_{a.id}_{b.id}", "source": a.id, "target": b.id, "kind": "forward"}
            )
        edges.append(
            {"id": "e_end", "source": chain[-1].id, "target": "end", "kind": "forward"}
        )
    else:
        edges.append({"id": "e_start_end", "source": "start", "target": "end", "kind": "forward"})

    # Dashed detour edges parent -> detour.
    for d in detours:
        edges.append(
            {
                "id": f"e_detour_{d.id}",
                "source": d.detour_of_step_id,
                "target": d.id,
                "kind": "detour",
            }
        )

    return {"nodes": nodes, "edges": edges}
