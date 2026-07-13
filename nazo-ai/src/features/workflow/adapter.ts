import { Position, type Edge, type Node } from '@xyflow/react'
import type { Lang, RoleId, WorkflowAction, WorkflowStep } from '@/types'
import { USERS } from '@/data/users'
import { deriveActions, isUnassigned, resolveAssignee } from '@/features/workflow/model'

export interface FlowNodeData {
  labelEn: string
  labelAr: string
  role: RoleId | 'requester'
  unitEn: string
  unitAr: string
  kind: 'start' | 'approval' | 'review' | 'sign' | 'end'
  order?: number
  rejectable?: boolean
  sign?: boolean
  regenerate?: boolean
  /** True when the step is placed but not yet assigned to a user/role. */
  unassigned?: boolean
  /** The canvasStep id this node mirrors (undefined for start/end). Lets node
   *  toolbars call the store CRUD directly. */
  stepId?: string
  /** Derived action set, drives the capability badges. */
  actions?: WorkflowAction[]
  [key: string]: unknown
}

// Canonical scripted-chain node ids (master §3.1 rule 6). Only used when a role
// appears once; duplicates fall back to n_<stepId> so ids stay unique.
const NODE_ID_BY_ROLE: Partial<Record<RoleId, string>> = {
  dtManager: 'n_dt',
  director: 'n_dir',
  gm: 'n_gm',
}

function kindFor(step: WorkflowStep): FlowNodeData['kind'] {
  if (step.type === 'Reviewing') return 'review'
  if (step.type === 'Signing') return 'sign'
  return 'approval'
}

/** Convert the data-model WorkflowStep[] into React Flow nodes + edges. */
export function stepsToFlow(
  steps: WorkflowStep[],
  lang: Lang = 'en',
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const rejectLabel = lang === 'ar' ? 'رفض' : 'Reject'
  const y = 150
  const gap = 260
  const requester = USERS.find((u) => u.role === 'requester')

  const nodes: Node<FlowNodeData>[] = [
    {
      id: 'n_start',
      type: 'start',
      position: { x: 0, y },
      width: 190,
      height: 66,
      measured: { width: 190, height: 66 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        labelEn: 'Requester',
        labelAr: 'مقدّم الطلب',
        role: 'requester',
        unitEn: requester?.unitEn ?? 'GM Office',
        unitAr: requester?.unitAr ?? 'مكتب المدير العام',
        kind: 'start',
        order: 0,
      },
    },
  ]

  const usedIds = new Set<string>(['n_start', 'n_end'])
  steps.forEach((step, i) => {
    const u = resolveAssignee(step, USERS)
    const unassigned = isUnassigned(step)
    const actions = deriveActions(step)
    // Prefer the canonical role id when free & unique, else derive from step id.
    const preferred = NODE_ID_BY_ROLE[step.role]
    const nodeId = preferred && !usedIds.has(preferred) ? preferred : `n_${step.id}`
    usedIds.add(nodeId)
    nodes.push({
      id: nodeId,
      type: kindFor(step) === 'review' ? 'review' : kindFor(step) === 'sign' ? 'sign' : 'approval',
      position: { x: gap * (i + 1), y },
      width: 210,
      height: 96,
      measured: { width: 210, height: 96 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        labelEn: u ? u.nameEn : unassigned ? 'Unassigned' : step.role,
        labelAr: u ? u.nameAr : unassigned ? 'غير مُسنَدة' : step.role,
        role: step.role,
        unitEn: unassigned ? '' : step.unitEn,
        unitAr: unassigned ? '' : step.unitAr,
        kind: kindFor(step),
        order: i + 1,
        rejectable: actions.includes('reject'),
        sign: actions.includes('sign'),
        regenerate: step.regenerate,
        unassigned,
        stepId: step.id,
        actions,
      },
    })
  })

  nodes.push({
    id: 'n_end',
    type: 'end',
    position: { x: gap * (steps.length + 1), y },
    width: 180,
    height: 58,
    measured: { width: 180, height: 58 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { labelEn: 'Signed & Archived', labelAr: 'موقّع ومؤرشف', role: 'requester', unitEn: '', unitAr: '', kind: 'end', order: steps.length + 1 },
  })

  // main flow edges
  const edges: Edge[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e_${nodes[i].id}_${nodes[i + 1].id}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'var(--brand)', strokeWidth: 2 },
    })
  }

  // reject edges (dashed red back to start) for each approval node
  nodes
    .filter((n) => n.data.rejectable)
    .forEach((n) => {
      edges.push({
        id: `e_reject_${n.id}`,
        source: n.id,
        target: 'n_start',
        type: 'smoothstep',
        label: rejectLabel,
        style: { stroke: 'var(--danger)', strokeWidth: 1.5, strokeDasharray: '5 4' },
        labelStyle: { fill: 'var(--danger)', fontSize: 10, fontWeight: 600 },
      })
    })

  return { nodes, edges }
}
