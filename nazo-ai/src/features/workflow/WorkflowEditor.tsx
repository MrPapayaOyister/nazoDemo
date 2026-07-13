import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion } from 'framer-motion'
import {
  Sparkles,
  Workflow as WorkflowIcon,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  UserPlus,
  PenTool,
  ShieldCheck,
  Plus,
  Send,
  ShieldQuestion,
  Users as UsersIcon,
  Briefcase,
  CircleDashed,
} from 'lucide-react'
import { useStore } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized, useLang } from '@/i18n'
import { nodeTypes } from '@/features/workflow/nodes'
import { stepsToFlow, type FlowNodeData } from '@/features/workflow/adapter'
import {
  ACTION_LABELS,
  ALL_ACTIONS,
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  baseActionsForType,
  deriveActions,
  isUnassigned,
  legacyFlagsFromActions,
  resolveAssignee,
  typeFromActions,
  validateWorkflowGraph,
  type WFValidation,
} from '@/features/workflow/model'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/ui/Button'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { genId } from '@/data/ids'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import type {
  RoleId,
  Template,
  User,
  WorkflowAction,
  WorkflowStep,
  WorkflowStepType,
} from '@/types'

const STEP_TYPES: WorkflowStepType[] = ['Approving', 'Reviewing', 'Signing']
const TYPE_LABELS: Record<WorkflowStepType, { en: string; ar: string }> = {
  Approving: { en: 'Approve', ar: 'اعتماد' },
  Reviewing: { en: 'Review', ar: 'مراجعة' },
  Signing: { en: 'Sign', ar: 'توقيع' },
}

/** Palette kinds a drop can create (linear-only: no conditions / parallel). */
const NODE_KINDS = [
  { kind: 'approval', icon: UserPlus, labelEn: 'Approver', labelAr: 'معتمِد', hintEn: 'Approve step', hintAr: 'خطوة اعتماد' },
  { kind: 'review', icon: ShieldCheck, labelEn: 'Reviewer', labelAr: 'مراجع', hintEn: 'Review step', hintAr: 'خطوة مراجعة' },
  { kind: 'sign', icon: PenTool, labelEn: 'Signer', labelAr: 'موقّع', hintEn: 'Sign step', hintAr: 'خطوة توقيع' },
] as const

function seedForKind(kind: string): Partial<WorkflowStep> {
  if (kind === 'sign') return { type: 'Signing', actions: ['approve', 'sign'] }
  if (kind === 'review') return { type: 'Reviewing', actions: ['review'] }
  return { type: 'Approving', actions: ['approve'] }
}

const DND_MIME = 'application/nazo-node'

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  )
}

function EditorInner() {
  const tr = useLocalized()
  const lang = useLang()
  const canvasSteps = useStore((s) => s.canvasSteps)
  const users = useStore((s) => s.users)
  const customSignatures = useStore((s) => s.customSignatures)
  const studioDraft = useStore((s) => s.studioDraft)
  const addCanvasStep = useStore((s) => s.addCanvasStep)
  const publishTemplate = useStore((s) => s.publishTemplate)
  const { run, isRunning, runningAction } = useAI()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const { fitView, screenToFlowPosition } = useReactFlow()

  const building = isRunning && runningAction === 'admin.buildWorkflow'

  // Live signature-asset predicate (seed ink OR a custom drawn signature).
  const hasSignatureAsset = useCallback(
    (u: User) => {
      const sigId = u.signatureId ?? `sig_${u.id}`
      return !!(customSignatures[sigId] ?? SIGNATURE_BY_ID[sigId])
    },
    [customSignatures],
  )

  const validation: WFValidation = useMemo(
    () => validateWorkflowGraph(canvasSteps, users, hasSignatureAsset),
    [canvasSteps, users, hasSignatureAsset],
  )
  const hasErrors = validation.errors.length > 0
  // Unassigned nodes are a soft warning while editing, but Publish requires every
  // node to be assigned to a user or role.
  const unassignedCount = useMemo(() => canvasSteps.filter(isUnassigned).length, [canvasSteps])
  const canPublish = !hasErrors && unassignedCount === 0 && !!studioDraft

  // canvasSteps is the SINGLE SOURCE OF TRUTH — re-derive the flow on any change
  // (add/remove/reorder/config) or a language toggle. fitView only when the node
  // count changes so config edits don't yank the viewport.
  const stepsSig = JSON.stringify(canvasSteps)
  const prevCount = useRef(-1)
  useEffect(() => {
    if (canvasSteps.length === 0) {
      setNodes([])
      setEdges([])
      prevCount.current = 0
      return
    }
    const { nodes: n, edges: e } = stepsToFlow(canvasSteps, lang)
    setNodes(n.map((node) => ({ ...node, selected: node.data.stepId === selectedId })))
    setEdges(e)
    if (n.length !== prevCount.current) {
      prevCount.current = n.length
      const id = setTimeout(() => fitView({ padding: 0.25, duration: 600 }), 80)
      return () => clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsSig, lang, selectedId])

  const selectedStep = canvasSteps.find((s) => s.id === selectedId) ?? null

  const onBuild = () => {
    if (isRunning) return
    run({ actionId: 'admin.buildWorkflow', role: 'admin', workflowId: 'draft', prompt })
  }

  const onValidate = () => {
    if (isRunning) return
    run({ actionId: 'admin.validateWorkflow', role: 'admin', workflowId: 'draft' })
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DND_MIME)
      if (!kind) return
      // Layout is index-derived; we still resolve the drop point for parity.
      screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addCanvasStep(null, seedForKind(kind))
    },
    [addCanvasStep, screenToFlowPosition],
  )

  const onPublish = () => {
    if (hasErrors) return
    if (unassignedCount > 0) {
      toast(
        tr(
          `${unassignedCount} step(s) still need an assignee.`,
          `${unassignedCount} خطوة بحاجة إلى إسناد.`,
        ),
      )
      return
    }
    if (studioDraft) {
      const tpl: Template = {
        id: genId('tpl'),
        nameEn: studioDraft.titleEn || 'Untitled Template',
        nameAr: studioDraft.titleAr || studioDraft.titleEn || 'نموذج بدون عنوان',
        lang: studioDraft.lang,
        category: studioDraft.category,
        descEn: 'Published from the workflow canvas.',
        descAr: 'منشور من لوحة المسار.',
        docHtml: studioDraft.docHtml,
        variables: studioDraft.variables,
        workflow: canvasSteps,
        updatedAt: '2026-07-10T09:12:00Z',
        usageCount: 0,
      }
      void publishTemplate(tpl)
      toast(tr('Template published with this workflow.', 'تم نشر النموذج بهذا المسار.'))
    } else {
      // No draft to publish the workflow into — the chain belongs to a template.
      toast(tr('Generate or open a template first to publish this workflow.', 'أنشئ نموذجاً أو افتح واحداً أولاً لنشر هذا المسار.'))
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* header */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-line bg-surface">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center size-9 rounded-xl bg-brand-subtle text-brand">
            <WorkflowIcon className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-bold text-ink leading-tight">{tr('Workflow Builder', 'منشئ المسار')}</div>
            <div className="text-[11px] text-ink-muted">{tr('Add, reorder, assign and validate — then publish.', 'أضف ورتّب وأسنِد وتحقّق — ثم انشر.')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusBadge validation={validation} />
          <Button variant="secondary" onClick={onValidate} disabled={isRunning}>
            <ShieldQuestion className="size-4" />
            {tr('Validate', 'تحقّق')}
          </Button>
          <Button
            variant="primary"
            disabled={!canPublish}
            onClick={onPublish}
            title={
              unassignedCount > 0
                ? tr(`${unassignedCount} step(s) still unassigned`, `${unassignedCount} خطوة غير مُسنَدة`)
                : undefined
            }
          >
            <Send className="size-4" />
            {tr('Publish', 'نشر')}
          </Button>
        </div>
      </div>

      {/* body: palette | canvas | properties */}
      <div className="flex-1 flex min-h-0">
        <NodePalette onAdd={() => addCanvasStep(null)} />

        <div
          className="nazo-canvas relative flex-1 min-w-0 min-h-[480px]"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, n) => setSelectedId((n.data as FlowNodeData).stepId ?? null)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.4}
            maxZoom={1.6}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="var(--border-strong)" />
            <Controls className="!shadow-e2 !border !border-line !rounded-xl overflow-hidden" showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className="!rounded-xl !border !border-line overflow-hidden"
              nodeColor="var(--brand)"
              maskColor="color-mix(in srgb, var(--bg-app) 70%, transparent)"
            />
          </ReactFlow>

          {/* empty state */}
          {nodes.length === 0 && !building && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="text-center">
                <span className="inline-grid place-items-center size-14 rounded-2xl bg-ai/10 text-ai animate-breathe">
                  <Sparkles className="size-7" />
                </span>
                <p className="mt-3 text-sm font-semibold text-ink">{tr('Drag a node in, or describe your flow below', 'اسحب عقدة أو صف مسارك بالأسفل')}</p>
                <p className="mt-1 text-[12px] text-ink-muted max-w-[320px] mx-auto">
                  {tr('e.g. “GM Office → DT Manager → Director → GM; each signs, any can reject.”', 'مثال: "مكتب المدير → مدير التحول الرقمي → المدير → المدير العام؛ كلٌّ يوقّع، ويمكن للجميع الرفض."')}
                </p>
              </div>
            </div>
          )}

          {/* mini AI box */}
          <MiniAiBox prompt={prompt} setPrompt={setPrompt} onBuild={onBuild} building={building} />
        </div>

        <ConfigPanel
          step={selectedStep}
          users={users}
          hasSignatureAsset={hasSignatureAsset}
          validation={validation}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StatusBadge({ validation }: { validation: WFValidation }) {
  const tr = useLocalized()
  const { errors, warnings } = validation
  if (errors.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold bg-danger-subtle text-danger">
        <AlertTriangle className="size-3.5" />
        {errors.length} {tr('error(s)', 'خطأ')}
      </span>
    )
  }
  if (warnings.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold bg-warning-subtle text-warning">
        <AlertTriangle className="size-3.5" />
        {warnings.length} {tr('warning(s)', 'تنبيه')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold bg-success-subtle text-success">
      <CheckCircle2 className="size-3.5" />
      {tr('Valid', 'صالح')}
    </span>
  )
}

function NodePalette({ onAdd }: { onAdd: () => void }) {
  const tr = useLocalized()
  const onDragStart = (e: React.DragEvent, kind: string) => {
    e.dataTransfer.setData(DND_MIME, kind)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <aside className="w-52 shrink-0 border-e border-line bg-surface p-3 overflow-y-auto">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-2 px-1">
        {tr('Nodes', 'العُقد')}
      </div>
      <div className="space-y-1.5">
        {NODE_KINDS.map((p) => {
          const Icon = p.icon
          return (
            <div
              key={p.kind}
              draggable
              onDragStart={(e) => onDragStart(e, p.kind)}
              className="flex items-center gap-2.5 rounded-xl hairline bg-app px-2.5 py-2 cursor-grab active:cursor-grabbing hover:bg-hover hover:border-line-strong transition-colors"
            >
              <span className="grid place-items-center size-7 rounded-lg bg-brand-subtle text-brand shrink-0">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink">{tr(p.labelEn, p.labelAr)}</span>
                <span className="block text-[10px] text-ink-muted">{tr(p.hintEn, p.hintAr)}</span>
              </span>
            </div>
          )
        })}
      </div>
      <button
        onClick={onAdd}
        className="mt-2.5 w-full flex items-center justify-center gap-1.5 rounded-xl hairline border-dashed bg-app px-2.5 py-2 text-[12px] font-medium text-ink-secondary hover:bg-hover hover:text-ink transition-colors"
      >
        <Plus className="size-3.5" />
        {tr('Add step', 'إضافة خطوة')}
      </button>
      <p className="mt-3 px-1 text-[10.5px] text-ink-muted leading-relaxed">
        {tr('Drag onto the canvas, or describe the flow to the AI below.', 'اسحبها إلى اللوحة أو صف المسار للذكاء الاصطناعي بالأسفل.')}
      </p>
    </aside>
  )
}

function MiniAiBox({
  prompt,
  setPrompt,
  onBuild,
  building,
}: {
  prompt: string
  setPrompt: (v: string) => void
  onBuild: () => void
  building: boolean
}) {
  const tr = useLocalized()
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.5 }}
      className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[min(560px,90%)] z-10"
    >
      <div className="rounded-2xl bg-surface/95 glass border border-ai/25 shadow-e-ai p-2 flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-xl bg-ai/12 text-ai shrink-0">
          <Sparkles className={cn('size-4', building && 'animate-breathe')} />
        </span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onBuild()}
          disabled={building}
          placeholder={tr('Describe your approval flow…', 'صف مسار الاعتماد…')}
          className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-muted outline-none px-1"
        />
        <Button variant="aiGradient" size="sm" onClick={onBuild} disabled={building}>
          {building ? <Sparkles className="size-4 animate-breathe" /> : <Wand2 className="size-4" />}
          {building ? tr('Building…', 'جارٍ البناء…') : tr('Build', 'بناء')}
        </Button>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Per-node config panel — bound to the selected canvasStep.
// ---------------------------------------------------------------------------
function ConfigPanel({
  step,
  users,
  hasSignatureAsset,
  validation,
}: {
  step: WorkflowStep | null
  users: User[]
  hasSignatureAsset: (u: User) => boolean
  validation: WFValidation
}) {
  const tr = useLocalized()
  const setCanvasStep = useStore((s) => s.setCanvasStep)

  return (
    <aside className="w-72 shrink-0 border-s border-line bg-surface flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
          {tr('Step settings', 'إعدادات الخطوة')}
        </div>
        {!step ? (
          <div className="mt-6 text-center text-[12.5px] text-ink-muted px-2">
            {tr('Select a node to edit its assignment, actions and type.', 'اختر عقدة لتعديل الإسناد والإجراءات والنوع.')}
          </div>
        ) : (
          <StepConfig
            step={step}
            users={users}
            hasSignatureAsset={hasSignatureAsset}
            onPatch={(patch) => setCanvasStep(step.id, patch)}
          />
        )}
      </div>
      <IssuesList validation={validation} />
    </aside>
  )
}

function StepConfig({
  step,
  users,
  hasSignatureAsset,
  onPatch,
}: {
  step: WorkflowStep
  users: User[]
  hasSignatureAsset: (u: User) => boolean
  onPatch: (patch: Partial<WorkflowStep>) => void
}) {
  const tr = useLocalized()
  const assignment = step.assignment ?? { kind: 'role' as const, ref: step.role }
  const actions = deriveActions(step)
  const resolved = resolveAssignee(step, users)

  const setRole = (role: RoleId) => {
    const owner = users.find((u) => u.role === role)
    onPatch({
      assignment: { kind: 'role', ref: role },
      role,
      unitEn: owner?.unitEn ?? step.unitEn,
      unitAr: owner?.unitAr ?? step.unitAr,
    })
  }
  const setUser = (u: User) => {
    onPatch({
      assignment: { kind: 'user', ref: u.id },
      role: u.role,
      unitEn: u.unitEn,
      unitAr: u.unitAr,
    })
  }
  const clearAssignment = () => {
    onPatch({ assignment: { kind: 'unassigned', ref: '' }, unitEn: '', unitAr: '' })
  }

  const writeActions = (next: WorkflowAction[]) => {
    const { rejectable, sign } = legacyFlagsFromActions(next)
    onPatch({ actions: next, rejectable, sign, type: typeFromActions(next) })
  }
  const toggleAction = (a: WorkflowAction) => {
    const next = actions.includes(a) ? actions.filter((x) => x !== a) : [...actions, a]
    writeActions(next)
  }
  const setType = (type: WorkflowStepType) => {
    // Rebuild the base decision from the type; preserve reject & request-revision.
    const keep = actions.filter((a) => a === 'reject' || a === 'request-revision')
    const next = [...baseActionsForType(type), ...keep]
    const { rejectable, sign } = legacyFlagsFromActions(next)
    onPatch({ actions: next, rejectable, sign, type })
  }

  const signNoSig = actions.includes('sign') && resolved && !resolved.signatureId
  const signNoAsset =
    !signNoSig && actions.includes('sign') && resolved && !hasSignatureAsset(resolved)

  return (
    <div className="space-y-5">
      {/* resolved assignee preview */}
      <div className="flex items-center gap-2.5 rounded-xl hairline bg-app px-3 py-2.5">
        <Avatar initials={resolved?.initials ?? '?'} color={resolved?.color} size={32} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate">
            {resolved ? tr(resolved.nameEn, resolved.nameAr) : tr('Unassigned', 'غير مُسنَد')}
          </div>
          <div className="text-[10.5px] text-ink-muted truncate">
            {resolved ? tr(resolved.titleEn, resolved.titleAr) : tr('Resolve the assignment below', 'حدّد الإسناد أدناه')}
          </div>
        </div>
      </div>

      {/* ASSIGNMENT */}
      <div>
        <SectionLabel>{tr('Assignment', 'الإسناد')}</SectionLabel>
        <Segmented
          options={[
            { value: 'unassigned', icon: CircleDashed, label: tr('None', 'بلا') },
            { value: 'role', icon: Briefcase, label: tr('Role', 'دور') },
            { value: 'user', icon: UsersIcon, label: tr('User', 'مستخدم') },
          ]}
          value={assignment.kind}
          onChange={(v) => {
            if (v === assignment.kind) return
            if (v === 'unassigned') clearAssignment()
            else if (v === 'role') setRole(ASSIGNABLE_ROLES.includes(step.role) ? step.role : ASSIGNABLE_ROLES[0])
            else setUser(resolved ?? users[0])
          }}
        />
        {assignment.kind === 'unassigned' ? (
          <div className="mt-2 rounded-lg bg-warning-subtle px-3 py-2 text-[11.5px] text-warning">
            {tr('Choose Role or User above to assign this step.', 'اختر دوراً أو مستخدماً بالأعلى لإسناد هذه الخطوة.')}
          </div>
        ) : assignment.kind === 'role' ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {ASSIGNABLE_ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  'rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition-colors text-start',
                  assignment.kind === 'role' && assignment.ref === r
                    ? 'bg-brand text-white'
                    : 'hairline bg-app text-ink-secondary hover:bg-hover',
                )}
              >
                {tr(ROLE_LABELS[r].en, ROLE_LABELS[r].ar)}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {users.map((u) => {
              const on = assignment.kind === 'user' && assignment.ref === u.id
              return (
                <button
                  key={u.id}
                  onClick={() => setUser(u)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors',
                    on ? 'bg-ai/10 ring-1 ring-ai/40' : 'hairline bg-app hover:bg-hover',
                  )}
                >
                  <Avatar initials={u.initials} color={u.color} size={22} />
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block text-[12px] font-medium text-ink truncate">{tr(u.nameEn, u.nameAr)}</span>
                    <span className="block text-[10px] text-ink-muted truncate">{tr(u.titleEn, u.titleAr)}</span>
                  </span>
                  {u.signatureId && <PenTool className="size-3 text-ink-muted shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ACTIONS */}
      <div>
        <SectionLabel>{tr('Actions', 'الإجراءات')}</SectionLabel>
        <div className="space-y-1.5">
          {ALL_ACTIONS.map((a) => (
            <Toggle
              key={a}
              label={tr(ACTION_LABELS[a].en, ACTION_LABELS[a].ar)}
              on={actions.includes(a)}
              onClick={() => toggleAction(a)}
            />
          ))}
        </div>
        {signNoSig && (
          <p className="mt-2 text-[10.5px] text-danger flex items-start gap-1">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            {tr('This signer owns no signature — Publish is blocked.', 'هذا الموقّع لا يملك توقيعاً — النشر متوقّف.')}
          </p>
        )}
        {signNoAsset && (
          <p className="mt-2 text-[10.5px] text-warning flex items-start gap-1">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            {tr('No signature drawn yet for this signer.', 'لم يُرسم توقيع لهذا الموقّع بعد.')}
          </p>
        )}
      </div>

      {/* TYPE + REGENERATE */}
      <div>
        <SectionLabel>{tr('Step type', 'نوع الخطوة')}</SectionLabel>
        <Segmented
          options={STEP_TYPES.map((t) => ({ value: t, label: tr(TYPE_LABELS[t].en, TYPE_LABELS[t].ar) }))}
          value={step.type}
          onChange={(v) => setType(v as WorkflowStepType)}
        />
        <div className="mt-2">
          <Toggle
            label={tr('Regenerate on sign', 'إعادة التوليد عند التوقيع')}
            on={!!step.regenerate}
            onClick={() => onPatch({ regenerate: !step.regenerate })}
          />
        </div>
        {step.sign && !step.regenerate && (
          <p className="mt-2 text-[10.5px] text-warning flex items-start gap-1">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            {tr('Enable Regenerate so signatures actually stamp.', 'فعّل إعادة التوليد لتُختم التوقيعات فعلياً.')}
          </p>
        )}
      </div>
    </div>
  )
}

function IssuesList({ validation }: { validation: WFValidation }) {
  const tr = useLocalized()
  const { errors, warnings } = validation
  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <div className="shrink-0 border-t border-line p-3 max-h-56 overflow-y-auto bg-app/50">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
        {tr('Validation', 'التحقّق')}
      </div>
      <div className="space-y-1.5">
        {errors.map((e, i) => (
          <div key={`e${i}`} className="flex items-start gap-1.5 rounded-lg bg-danger-subtle px-2 py-1.5 text-[11px] text-danger">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            <span>{tr(e.en, e.ar)}</span>
          </div>
        ))}
        {warnings.map((w, i) => (
          <div key={`w${i}`} className="flex items-start gap-1.5 rounded-lg bg-warning-subtle px-2 py-1.5 text-[11px] text-warning">
            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
            <span>{tr(w.en, w.ar)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small controls.
// ---------------------------------------------------------------------------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold text-ink-muted mb-2">{children}</div>
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: typeof Briefcase }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg hairline bg-app p-0.5">
      {options.map((o) => {
        const Icon = o.icon
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11.5px] font-semibold transition-colors',
              on ? 'bg-surface text-ink shadow-e1' : 'text-ink-muted hover:text-ink-secondary',
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors',
        on ? 'bg-ai/10 text-ai' : 'hairline bg-app text-ink-secondary hover:bg-hover',
      )}
    >
      {label}
      <span className={cn('relative h-4 w-7 rounded-full transition-colors', on ? 'bg-ai' : 'bg-line-strong')}>
        <span className={cn('absolute top-0.5 size-3 rounded-full bg-white transition-all', on ? 'start-3.5' : 'start-0.5')} />
      </span>
    </button>
  )
}
