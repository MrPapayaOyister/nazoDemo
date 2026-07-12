import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Flag, PenTool, RefreshCw, Play, CheckCircle2, ShieldCheck } from 'lucide-react'
import { USERS } from '@/data/users'
import { Avatar } from '@/components/common/Avatar'
import { useLocalized } from '@/i18n'
import type { FlowNodeData } from '@/features/workflow/adapter'
import { cn } from '@/lib/cn'

const H = Position.Left
const OUT = Position.Right

function userFor(role: string) {
  return USERS.find((u) => u.role === role)
}

function RoleNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData
  const tr = useLocalized()
  const u = userFor(d.role)
  const KindIcon = d.kind === 'sign' ? PenTool : d.kind === 'review' ? ShieldCheck : CheckCircle2
  return (
    <div
      className={cn(
        'rf-enter w-[210px] rounded-2xl bg-surface border shadow-e2 transition-all',
        selected ? 'border-ai ring-2 ring-ai/30' : 'border-line',
      )}
      style={{ ['--i' as string]: String(d.order ?? 0) }}
    >
      <Handle type="target" position={H} className="!size-2.5 !bg-brand !border-2 !border-surface" />
      <div className="px-3 pt-2.5 pb-2 flex items-center gap-2 border-b border-line">
        <Avatar initials={u?.initials ?? '?'} color={u?.color} size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-ink truncate">{tr(d.labelEn, d.labelAr)}</div>
          <div className="text-[10.5px] text-ink-muted truncate">{tr(d.unitEn, d.unitAr)}</div>
        </div>
        {typeof d.order === 'number' && (
          <span className="grid place-items-center size-5 rounded-md bg-brand-subtle text-brand text-[10px] font-bold shrink-0">
            {d.order}
          </span>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 rounded-md bg-ai/10 text-ai px-1.5 py-0.5 text-[10px] font-semibold">
          <KindIcon className="size-3" />
          {d.kind === 'sign' ? tr('Sign', 'توقيع') : d.kind === 'review' ? tr('Review', 'مراجعة') : tr('Approve', 'اعتماد')}
        </span>
        {d.rejectable && (
          <span className="inline-flex items-center gap-1 rounded-md bg-danger-subtle text-danger px-1.5 py-0.5 text-[10px] font-semibold">
            <Flag className="size-3" />
            {tr('Reject', 'رفض')}
          </span>
        )}
        {d.regenerate && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-subtle text-accent px-1.5 py-0.5 text-[10px] font-semibold">
            <RefreshCw className="size-3" />
            {tr('Regen', 'إعادة')}
          </span>
        )}
      </div>
      <Handle type="source" position={OUT} className="!size-2.5 !bg-brand !border-2 !border-surface" />
    </div>
  )
}

function StartNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  const tr = useLocalized()
  return (
    <div className="rf-enter w-[190px] rounded-2xl bg-accent/10 border border-accent/40 shadow-e1 px-3 py-2.5" style={{ ['--i' as string]: String(d.order ?? 0) }}>
      <div className="flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-xl bg-accent/15 text-accent shrink-0">
          <Play className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink truncate">{tr(d.labelEn, d.labelAr)}</div>
          <div className="text-[10.5px] text-ink-muted truncate">{tr(d.unitEn, d.unitAr)}</div>
        </div>
      </div>
      <Handle type="source" position={OUT} className="!size-2.5 !bg-accent !border-2 !border-surface" />
    </div>
  )
}

function EndNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  const tr = useLocalized()
  return (
    <div className="rf-enter w-[180px] rounded-2xl bg-navy text-white shadow-e2 px-3 py-2.5" style={{ ['--i' as string]: String(d.order ?? 0) }}>
      <div className="flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-xl bg-white/15 shrink-0">
          <CheckCircle2 className="size-4" />
        </span>
        <div className="text-[12.5px] font-semibold truncate">{tr(d.labelEn, d.labelAr)}</div>
      </div>
      <Handle type="target" position={H} className="!size-2.5 !bg-white !border-2 !border-navy" />
    </div>
  )
}

export const nodeTypes = {
  start: StartNode,
  approval: RoleNode,
  review: RoleNode,
  sign: RoleNode,
  end: EndNode,
}
