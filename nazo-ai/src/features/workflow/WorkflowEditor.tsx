import { useEffect, useMemo, useState } from 'react'
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
  Flag,
  PenTool,
  RefreshCw,
  Send,
} from 'lucide-react'
import { useStore } from '@/store'
import { useAI } from '@/ai/useAI'
import { useLocalized, useLang } from '@/i18n'
import { nodeTypes } from '@/features/workflow/nodes'
import { stepsToFlow, type FlowNodeData } from '@/features/workflow/adapter'
import { Button } from '@/components/ui/Button'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'

const KIND_AR: Record<string, string> = {
  start: 'بداية',
  approval: 'اعتماد',
  review: 'مراجعة',
  sign: 'توقيع',
  condition: 'شرط',
  end: 'نهاية',
}

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
  const { run, isRunning, runningAction } = useAI()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const { fitView } = useReactFlow()

  const building = isRunning && runningAction === 'admin.buildWorkflow'

  // Sync canvas from the (AI-built) steps. Fresh mounts replay the drop-in;
  // re-derives on language toggle so the baked reject-edge label follows suit.
  const stepsKey = canvasSteps.map((s) => s.id).join('|')
  useEffect(() => {
    if (canvasSteps.length === 0) {
      setNodes([])
      setEdges([])
      return
    }
    const { nodes: n, edges: e } = stepsToFlow(canvasSteps, lang)
    setNodes(n)
    setEdges(e)
    const id = setTimeout(() => fitView({ padding: 0.25, duration: 600 }), 80)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsKey, lang])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const validity = useMemo(() => {
    const hasStart = nodes.some((n) => n.type === 'start')
    const hasEnd = nodes.some((n) => n.type === 'end')
    const approvals = nodes.filter((n) => ['approval', 'review', 'sign'].includes(n.type ?? '')).length
    const ok = hasStart && hasEnd && approvals > 0
    return { ok, approvals }
  }, [nodes])

  const toggleFlag = (flag: 'rejectable' | 'sign' | 'regenerate') => {
    if (!selected) return
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected.id ? { ...n, data: { ...n.data, [flag]: !n.data[flag] } } : n,
      ),
    )
  }

  const onBuild = () => {
    if (isRunning) return
    run({ actionId: 'admin.buildWorkflow', role: 'admin', workflowId: 'draft', prompt })
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
            <div className="text-[15px] font-bold text-ink leading-tight">{tr('Workflow Canvas', 'لوحة المسار')}</div>
            <div className="text-[11px] text-ink-muted">{tr('Design the approval route — drag, or let AI draw it.', 'صمّم مسار الاعتماد — بالسحب أو دع الذكاء الاصطناعي يرسمه.')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
              validity.ok ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
            )}
          >
            {validity.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {validity.ok ? tr('Valid', 'صالح') : tr('Add steps', 'أضف خطوات')}
          </span>
          <Button
            variant="primary"
            disabled={!validity.ok}
            onClick={() => toast(tr('Workflow saved to the template.', 'تم حفظ المسار في النموذج.'))}
          >
            <Send className="size-4" />
            {tr('Publish', 'نشر')}
          </Button>
        </div>
      </div>

      {/* body: palette | canvas | properties */}
      <div className="flex-1 flex min-h-0">
        <NodePalette />

        <div className="nazo-canvas relative flex-1 min-w-0 min-h-[480px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, n) => setSelectedId(n.id)}
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
                <p className="mt-3 text-sm font-semibold text-ink">{tr('Describe your approval flow below', 'صف مسار الاعتماد بالأسفل')}</p>
                <p className="mt-1 text-[12px] text-ink-muted max-w-[300px] mx-auto">
                  {tr('e.g. “GM Office → DT Manager → Director → GM; each signs, any can reject.”', 'مثال: "مكتب المدير → مدير التحول الرقمي → المدير → المدير العام؛ كلٌّ يوقّع، ويمكن للجميع الرفض."')}
                </p>
              </div>
            </div>
          )}

          {/* mini AI box */}
          <MiniAiBox prompt={prompt} setPrompt={setPrompt} onBuild={onBuild} building={building} />
        </div>

        <PropertiesPanel selected={selected} onToggle={toggleFlag} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const PALETTE = [
  { icon: UserPlus, labelEn: 'Approver', labelAr: 'معتمِد', hintEn: 'Role step', hintAr: 'خطوة دور' },
  { icon: PenTool, labelEn: 'Sign', labelAr: 'توقيع', hintEn: 'Signature', hintAr: 'توقيع' },
  { icon: Flag, labelEn: 'Reject path', labelAr: 'مسار رفض', hintEn: 'Return', hintAr: 'إعادة' },
  { icon: RefreshCw, labelEn: 'Condition', labelAr: 'شرط', hintEn: 'Branch', hintAr: 'تفرّع' },
]

function NodePalette() {
  const tr = useLocalized()
  return (
    <aside className="w-52 shrink-0 border-e border-line bg-surface p-3 overflow-y-auto">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-2 px-1">
        {tr('Nodes', 'العُقد')}
      </div>
      <div className="space-y-1.5">
        {PALETTE.map((p) => {
          const Icon = p.icon
          return (
            <div
              key={p.labelEn}
              className="flex items-center gap-2.5 rounded-xl hairline bg-app px-2.5 py-2 cursor-grab hover:bg-hover hover:border-line-strong transition-colors"
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

function PropertiesPanel({
  selected,
  onToggle,
}: {
  selected: Node<FlowNodeData> | null
  onToggle: (flag: 'rejectable' | 'sign' | 'regenerate') => void
}) {
  const tr = useLocalized()
  return (
    <aside className="w-72 shrink-0 border-s border-line bg-surface p-4 overflow-y-auto">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
        {tr('Properties', 'الخصائص')}
      </div>
      {!selected ? (
        <div className="mt-6 text-center text-[12.5px] text-ink-muted px-2">
          {tr('Select a node to edit its role, unit and flags.', 'اختر عقدة لتعديل الدور والوحدة والخيارات.')}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={tr('Name', 'الاسم')} value={tr(selected.data.labelEn, selected.data.labelAr)} />
          <Field label={tr('Unit', 'الوحدة')} value={tr(selected.data.unitEn, selected.data.unitAr) || '—'} />
          <Field label={tr('Step type', 'نوع الخطوة')} value={tr(selected.data.kind, KIND_AR[selected.data.kind] ?? selected.data.kind)} />
          {['approval', 'review', 'sign'].includes(selected.type ?? '') && (
            <div>
              <div className="text-[11px] font-semibold text-ink-muted mb-2">{tr('Flags', 'الخيارات')}</div>
              <div className="space-y-1.5">
                <FlagToggle label={tr('Rejectable', 'قابل للرفض')} on={!!selected.data.rejectable} onClick={() => onToggle('rejectable')} />
                <FlagToggle label={tr('Sign', 'توقيع')} on={!!selected.data.sign} onClick={() => onToggle('sign')} />
                <FlagToggle label={tr('Regenerate on sign', 'إعادة التوليد عند التوقيع')} on={!!selected.data.regenerate} onClick={() => onToggle('regenerate')} />
              </div>
              {selected.data.sign && !selected.data.regenerate && (
                <p className="mt-2 text-[10.5px] text-warning flex items-start gap-1">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  {tr('Enable Regenerate so signatures actually stamp.', 'فعّل إعادة التوليد لتُختم التوقيعات فعلياً.')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-ink-muted mb-1">{label}</div>
      <div className="rounded-lg hairline bg-app px-3 py-2 text-[13px] text-ink capitalize">{value}</div>
    </div>
  )
}

function FlagToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
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
