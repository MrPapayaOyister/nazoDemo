import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCurrentUser } from '@/store'
import { NAV_BY_ROLE } from '@/app/routes'
import { ICONS } from '@/lib/icons'
import { useT, useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

const ROOT_ROUTES = new Set(['/admin', '/requester', '/inbox'])

export function LeftNav() {
  const user = useCurrentUser()
  const sections = NAV_BY_ROLE[user.role]
  const t = useT()
  const tr = useLocalized()

  return (
    <aside className="w-64 shrink-0 bg-navy text-white flex flex-col">
      {/* current identity chip */}
      <div className="px-4 pt-4 pb-3">
        <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {tr(user.titleEn, user.titleAr)}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-white truncate">
            {tr(user.nameEn, user.nameAr)}
          </div>
          <div className="text-[11px] text-white/45 truncate">
            {tr(user.unitEn, user.unitAr)}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-6">
        {sections.map((sec) => (
          <div key={sec.titleKey}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {t(sec.titleKey)}
            </div>
            <div className="space-y-0.5">
              {sec.items.map((item) => {
                const Icon = ICONS[item.icon as keyof typeof ICONS]
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={ROOT_ROUTES.has(item.to)}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-white/12 text-white'
                          : 'text-white/65 hover:bg-white/[0.07] hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span
                            layoutId="navActive"
                            className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-white"
                            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                          />
                        )}
                        {Icon && <Icon className="size-[18px] shrink-0" />}
                        <span className="truncate">{t(item.labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3">
        <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[11px] text-white/40 leading-relaxed">
          {tr('Cinematic vision demo — every action is AI-orchestrated.', 'عرض رؤية سينمائي — كل إجراء يقوده الذكاء الاصطناعي.')}
        </div>
      </div>
    </aside>
  )
}
