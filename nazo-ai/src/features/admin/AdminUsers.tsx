import { useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Users, Check, ShieldCheck, ShieldOff } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { Avatar } from '@/components/common/Avatar'
import { useStore, useCurrentUser } from '@/store'
import { setUserRole } from '@/api/client'
import { SIGNATURE_BY_ID } from '@/data/signatures'
import { useLocalized } from '@/i18n'
import { riseItem, staggerContainer } from '@/lib/motion'
import type { RoleId } from '@/types'
import { cn } from '@/lib/cn'

const ROLE_LABEL: Record<RoleId, { en: string; ar: string }> = {
  admin: { en: 'Admin', ar: 'مشرف' },
  requester: { en: 'Requester', ar: 'مُقدّم طلب' },
  dtManager: { en: 'Approver · 1', ar: 'معتمِد · 1' },
  director: { en: 'Approver · 2', ar: 'معتمِد · 2' },
  gm: { en: 'Approver · 3', ar: 'معتمِد · 3' },
  chair: { en: 'Reserve', ar: 'احتياطي' },
  broadcaster: { en: 'Broadcaster', ar: 'مذيع' },
  viewer: { en: 'Viewer', ar: 'مشاهد' },
}

export function AdminUsers() {
  const tr = useLocalized()
  const users = useStore((s) => s.users)
  const me = useCurrentUser()
  const hydrate = useStore((s) => s.hydrate)
  const [busy, setBusy] = useState<string | null>(null)

  /** Promote to admin, or hand the identity back its original working role. */
  const toggleAdmin = async (id: string, isAdmin: boolean, fallback: RoleId) => {
    setBusy(id)
    try {
      await setUserRole(id, isAdmin ? fallback : 'admin')
      await hydrate() // capabilities are derived from role — refresh the whole payload
      toast(isAdmin ? tr('Admin access revoked.', 'تم سحب صلاحية المشرف.') : tr('Admin access granted.', 'تم منح صلاحية المشرف.'))
    } catch {
      toast(tr('Could not change that role.', 'تعذّر تغيير الدور.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title={tr('Users', 'المستخدمون')}
        subtitle={tr('People, roles and stored signatures.', 'الأشخاص والأدوار والتوقيعات المخزّنة.')}
        icon={<Users className="size-5" />}
      />

      <motion.div
        variants={staggerContainer(0.05, 0.08)}
        initial="initial"
        animate="animate"
        className="mt-6 rounded-2xl hairline bg-surface shadow-e1 overflow-hidden"
      >
        {/* header row */}
        <div className="hidden md:grid grid-cols-[1.8fr_1.1fr_1.3fr_0.9fr_1fr] gap-4 px-5 py-3 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
          <span>{tr('Name', 'الاسم')}</span>
          <span>{tr('Role', 'الدور')}</span>
          <span>{tr('Unit', 'الوحدة')}</span>
          <span>{tr('Signature', 'التوقيع')}</span>
          <span>{tr('Admin access', 'صلاحية المشرف')}</span>
        </div>

        {users.map((u) => {
          const sig = u.signatureId ? SIGNATURE_BY_ID[u.signatureId] : undefined
          return (
            <motion.div
              key={u.id}
              variants={riseItem}
              className="grid grid-cols-1 md:grid-cols-[1.8fr_1.1fr_1.3fr_0.9fr_1fr] gap-2 md:gap-4 px-5 py-3.5 border-b border-line last:border-0 items-center hover:bg-hover transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar initials={u.initials} color={u.color} size={38} />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink truncate">{tr(u.nameEn, u.nameAr)}</div>
                  <div className="text-[11px] text-ink-muted truncate">{u.email}</div>
                </div>
              </div>
              <div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold',
                    u.role === 'admin' ? 'bg-brand-subtle text-brand' : u.role === 'requester' ? 'bg-accent-subtle text-accent' : u.role === 'chair' ? 'bg-subtle text-ink-muted' : 'bg-ai/12 text-ai',
                  )}
                >
                  {tr(ROLE_LABEL[u.role].en, ROLE_LABEL[u.role].ar)}
                </span>
              </div>
              <div className="text-[12.5px] text-ink-secondary truncate">{tr(u.unitEn, u.unitAr)}</div>
              <div>
                {sig ? (
                  <span className="inline-flex items-center gap-2 rounded-lg hairline bg-app px-2 py-1">
                    <img src={sig.dataUri} alt="signature" className="h-6 w-16 object-contain" />
                    <Check className="size-3.5 text-success" />
                  </span>
                ) : (
                  <span className="text-[11.5px] text-ink-muted">{tr('—', '—')}</span>
                )}
              </div>
              {/* Grant / revoke ADMIN. Capabilities derive from role, so this takes
                  effect immediately. You cannot change your own role (server-enforced). */}
              <div>
                {u.id === me.id ? (
                  <span className="text-[11.5px] text-ink-muted">{tr('You', 'أنت')}</span>
                ) : (
                  <button
                    onClick={() => void toggleAdmin(u.id, u.role === 'admin', 'requester')}
                    disabled={busy === u.id}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50',
                      u.role === 'admin'
                        ? 'bg-brand-subtle text-brand hover:bg-brand/15'
                        : 'hairline bg-app text-ink-secondary hover:bg-hover',
                    )}
                    title={
                      u.role === 'admin'
                        ? tr('Revoke admin access', 'سحب صلاحية المشرف')
                        : tr('Grant admin access', 'منح صلاحية المشرف')
                    }
                  >
                    {u.role === 'admin' ? <ShieldCheck className="size-3.5" /> : <ShieldOff className="size-3.5" />}
                    {u.role === 'admin' ? tr('Admin', 'مشرف') : tr('Make admin', 'تعيين مشرفاً')}
                  </button>
                )}
              </div>
            </motion.div>
          )
        })}
      </motion.div>
    </PageTransition>
  )
}
