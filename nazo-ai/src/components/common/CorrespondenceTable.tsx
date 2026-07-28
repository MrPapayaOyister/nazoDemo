import { useNavigate } from 'react-router-dom'
import type { Correspondence } from '@/types'
import { useStore } from '@/store'
import { USERS } from '@/data/users'
import { TEMPLATE_BY_ID } from '@/data/seed'
import { StatusBadge } from '@/components/common/StatusBadge'
import { ChainStepper, signedRolesOf } from '@/components/common/ChainStepper'
import { useLocalized, useLang } from '@/i18n'

function fmtDate(iso: string | undefined, lang: string): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Phase 5 — the table alternate to the card grid. Rows self-navigate to the viewer
 * (same target as CorrespondenceCard/TaskCard). Variable resolution mirrors TrackingPage
 * (override-first) done once per row inline — no per-row hooks. Horizontally scrolls on
 * narrow viewports so the page body never scrolls sideways.
 */
export function CorrespondenceTable({ rows }: { rows: Correspondence[] }) {
  const tr = useLocalized()
  const lang = useLang()
  const navigate = useNavigate()
  const templates = useStore((s) => s.templates)

  return (
    <div className="mt-6 overflow-x-auto rounded-2xl hairline bg-surface shadow-e1">
      <table className="w-full min-w-[720px] border-collapse text-start">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-muted">
            <th className="px-4 py-3 text-start font-semibold">{tr('Correspondence', 'المراسلة')}</th>
            <th className="px-4 py-3 text-start font-semibold">{tr('Status', 'الحالة')}</th>
            <th className="px-4 py-3 text-start font-semibold">{tr('Progress', 'التقدّم')}</th>
            <th className="px-4 py-3 text-start font-semibold">{tr('Requester', 'مقدّم الطلب')}</th>
            <th className="px-4 py-3 text-start font-semibold">{tr('Updated', 'آخر تحديث')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const vars =
              c.variablesOverride ??
              templates.find((t) => t.id === c.templateId)?.variables ??
              TEMPLATE_BY_ID[c.templateId]?.variables ??
              []
            const signed = signedRolesOf(c.values, vars)
            const requester = USERS.find((u) => u.id === c.requesterId)
            const open = () => navigate(`/correspondence/${c.id}`)
            return (
              // Native table row/cell semantics are preserved (headers associate with
              // cells for assistive tech). The title cell holds the real focusable
              // control — its accessible name is the title + ref — while the whole-row
              // onClick is a mouse-only convenience.
              <tr
                key={c.id}
                onClick={open}
                className="border-b border-line last:border-0 cursor-pointer transition-colors hover:bg-hover"
              >
                <td className="px-4 py-3 max-w-[320px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      open()
                    }}
                    className="text-start rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <div className="text-[13px] font-semibold text-ink truncate">{tr(c.titleEn, c.titleAr)}</div>
                    <div className="text-[11px] text-ink-muted font-mono">{c.ref}</div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3">
                  <ChainStepper steps={c.workflow} currentIndex={c.currentStepIndex} status={c.status} signedRoles={signed} variant="mini" />
                </td>
                <td className="px-4 py-3 text-[12.5px] text-ink-secondary whitespace-nowrap">
                  {requester ? tr(requester.nameEn, requester.nameAr) : '—'}
                </td>
                <td className="px-4 py-3 text-[12px] text-ink-muted whitespace-nowrap">{fmtDate(c.updatedAt, lang)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
