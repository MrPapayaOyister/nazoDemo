import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { motion } from 'framer-motion'
import { Check, ChevronDown, UserRound, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore, useCurrentUser } from '@/store'
import { useLocalized } from '@/i18n'
import { Avatar } from '@/components/common/Avatar'
import { DEFAULT_ROUTE_BY_ROLE } from '@/app/routes'
import type { RoleId } from '@/types'
import { cn } from '@/lib/cn'

export function UserSwitcher() {
  const users = useStore((s) => s.users)
  const current = useCurrentUser()
  const switchUser = useStore((s) => s.switchUser)
  const signOut = useStore((s) => s.signOut)
  const navigate = useNavigate()
  const tr = useLocalized()

  const onPick = (id: string, role: RoleId) => {
    switchUser(id)
    navigate(DEFAULT_ROUTE_BY_ROLE[role])
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2.5 rounded-xl ps-1.5 pe-2.5 py-1.5 hover:bg-hover transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          <Avatar initials={current.initials} color={current.color} size={30} />
          <span className="hidden sm:block text-start leading-tight">
            <span className="block text-[13px] font-semibold text-ink">
              {tr(current.nameEn, current.nameAr)}
            </span>
            <span className="block text-[11px] text-ink-muted">
              {tr(current.titleEn, current.titleAr)}
            </span>
          </span>
          <ChevronDown className="size-4 text-ink-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content asChild align="end" sideOffset={10}>
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="z-50 w-[19rem] rounded-2xl bg-surface hairline shadow-e3 p-1.5"
          >
            <DropdownMenu.Item
              onSelect={() => navigate('/profile')}
              className="flex items-center gap-3 rounded-xl px-2 py-2 cursor-pointer outline-none transition-colors data-[highlighted]:bg-hover"
            >
              <span className="grid place-items-center size-[34px] rounded-full bg-brand-subtle text-brand shrink-0">
                <UserRound className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink">
                  {tr('My Profile', 'ملفّي الشخصي')}
                </span>
                <span className="block text-[11px] text-ink-muted">
                  {tr('Identity, preferences & signature', 'الهوية والتفضيلات والتوقيع')}
                </span>
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1.5 h-px bg-line" />

            <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              {tr('Switch account', 'تبديل الحساب')}
            </div>
            {users.map((u) => {
              const active = u.id === current.id
              return (
                <DropdownMenu.Item
                  key={u.id}
                  onSelect={() => onPick(u.id, u.role)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-2 py-2 cursor-pointer outline-none transition-colors',
                    'data-[highlighted]:bg-hover',
                    active && 'bg-brand-subtle',
                  )}
                >
                  <Avatar initials={u.initials} color={u.color} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {tr(u.nameEn, u.nameAr)}
                    </span>
                    <span className="block text-[11px] text-ink-muted truncate">
                      {tr(u.titleEn, u.titleAr)}
                    </span>
                  </span>
                  {active && <Check className="size-4 text-brand shrink-0" />}
                </DropdownMenu.Item>
              )
            })}

            <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
            <DropdownMenu.Item
              onSelect={() => signOut()}
              className="flex items-center gap-3 rounded-xl px-2 py-2 cursor-pointer outline-none transition-colors data-[highlighted]:bg-danger-subtle text-ink-secondary data-[highlighted]:text-danger"
            >
              <span className="grid place-items-center size-[34px] rounded-full bg-subtle shrink-0">
                <LogOut className="size-[17px]" />
              </span>
              <span className="text-[13px] font-semibold">{tr('Sign out', 'تسجيل الخروج')}</span>
            </DropdownMenu.Item>
          </motion.div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
