// Phase 2a — compact share-management panel for a SAVED template. Lets the owner
// (or admin) grant use / edit / manage access to a specific person or a whole role,
// and revoke it. All authority is enforced server-side; this is the management UI.
import { useCallback, useEffect, useState } from 'react'
import { Share2, X, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { listTemplateShares, shareTemplate, unshareTemplate } from '@/api/client'
import { ROLE_LABELS } from '@/features/workflow/model'
import type { RoleId, TemplateShare, TemplateShareCapability } from '@/types'

/** Friendly access levels → capability sets (kept in the template-ACL vocabulary). */
const LEVELS: { key: string; caps: TemplateShareCapability[]; en: string; ar: string }[] = [
  { key: 'use', caps: ['use'], en: 'Can use', ar: 'يمكنه الاستخدام' },
  { key: 'edit', caps: ['use', 'edit_template'], en: 'Can edit', ar: 'يمكنه التعديل' },
  { key: 'manage', caps: ['use', 'edit_template', 'share'], en: 'Can manage', ar: 'يمكنه الإدارة' },
]

// Only the 6 actor roles are meaningful share targets (viewers/broadcasters get
// access through their own restricted model, never a template edit/use grant).
const SHARE_ROLES: RoleId[] = ['requester', 'dtManager', 'director', 'gm', 'chair', 'admin']

export function TemplateSharePanel({ templateId }: { templateId: string }) {
  const tr = useLocalized()
  const users = useStore((s) => s.users)
  const [shares, setShares] = useState<TemplateShare[]>([])
  const [target, setTarget] = useState('') // 'user:<id>' | 'role:<roleId>'
  const [level, setLevel] = useState('use')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listTemplateShares(templateId)
      .then(setShares)
      .catch(() => setShares([]))
  }, [templateId])
  useEffect(() => load(), [load])

  const actorUsers = users.filter((u) => (u.accessLevel ?? 'actor') === 'actor')

  const onAdd = async () => {
    if (!target || busy) return
    const [kind, ref] = target.split(':')
    const caps = LEVELS.find((l) => l.key === level)?.caps ?? ['use']
    setBusy(true)
    try {
      await shareTemplate(templateId, { granteeKind: kind as 'user' | 'role', granteeRef: ref, capabilities: caps })
      setTarget('')
      load()
    } catch {
      /* server-enforced; a failure just leaves the list unchanged */
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (id: string) => {
    try {
      await unshareTemplate(templateId, id)
    } finally {
      load()
    }
  }

  const granteeLabel = (s: TemplateShare) => {
    if (s.granteeKind === 'user') {
      const u = users.find((x) => x.id === s.granteeRef)
      return u ? tr(u.nameEn, u.nameAr) : s.granteeRef
    }
    const rl = ROLE_LABELS[s.granteeRef as RoleId]
    return rl ? `${tr(rl.en, rl.ar)} · ${tr('role', 'دور')}` : s.granteeRef
  }

  return (
    <div className="mb-4 rounded-2xl hairline bg-surface shadow-e1 p-4 space-y-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <Share2 className="size-4 text-brand" />
        {tr('Sharing', 'المشاركة')}
      </div>

      {shares.length === 0 ? (
        <div className="text-[12px] text-ink-muted">{tr('Not shared with anyone yet.', 'لم تتم مشاركته مع أحد بعد.')}</div>
      ) : (
        <ul className="space-y-1.5">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0 truncate text-ink-secondary">
                {granteeLabel(s)} <span className="text-ink-muted">· {s.capabilities.join(', ')}</span>
              </span>
              <button
                onClick={() => void onRemove(s.id)}
                className="shrink-0 text-ink-muted hover:text-danger transition-colors"
                title={tr('Remove access', 'إزالة الوصول')}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg hairline bg-app text-ink text-[12px] px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <option value="">{tr('Choose a person or role…', 'اختر شخصاً أو دوراً…')}</option>
          <optgroup label={tr('Roles', 'الأدوار')}>
            {SHARE_ROLES.map((r) => (
              <option key={r} value={`role:${r}`}>
                {tr(ROLE_LABELS[r].en, ROLE_LABELS[r].ar)}
              </option>
            ))}
          </optgroup>
          <optgroup label={tr('People', 'الأشخاص')}>
            {actorUsers.map((u) => (
              <option key={u.id} value={`user:${u.id}`}>
                {tr(u.nameEn, u.nameAr)}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-lg hairline bg-app text-ink text-[12px] px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {LEVELS.map((l) => (
            <option key={l.key} value={l.key}>
              {tr(l.en, l.ar)}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => void onAdd()} disabled={!target || busy}>
          <UserPlus className="size-3.5" />
          {tr('Share', 'مشاركة')}
        </Button>
      </div>
    </div>
  )
}
