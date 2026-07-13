import { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { Logo } from '@/components/common/Logo'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/ui/Button'
import { LangToggle } from '@/app/LangToggle'
import { ThemeToggle } from '@/app/ThemeToggle'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { USERS } from '@/data/users'
import { DEFAULT_ROUTE_BY_ROLE } from '@/app/routes'
import { ROLE_LABELS } from '@/features/workflow/model'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'

/**
 * The app's entry screen. NOT authentication — the same no-login identity switch,
 * presented as a proper "sign in" chooser. Picking an identity + Sign in calls
 * enterAs(id) (persisted, so a refresh keeps you in) and lands on that role's home.
 */
export function LoginGate() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const enterAs = useStore((s) => s.enterAs)
  const [selected, setSelected] = useState<string>('u_admin')

  const signIn = () => {
    const user = USERS.find((u) => u.id === selected)
    if (!user) return
    enterAs(user.id)
    navigate(DEFAULT_ROUTE_BY_ROLE[user.role])
  }

  return (
    <div className="min-h-screen grid place-items-center bg-app px-4 py-10 relative">
      <div className="absolute top-4 end-4 flex items-center gap-1.5">
        <LangToggle />
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE.emphasized }}
        className="w-full max-w-lg rounded-3xl bg-surface shadow-e3 hairline p-7 sm:p-9"
      >
        {/* brand */}
        <div className="flex flex-col items-center text-center">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.04]">
            <Logo variant="full" className="h-20" />
          </div>
          <h1 className="mt-5 text-2xl font-bold text-ink tracking-tight">
            {tr('Welcome to NAZO', 'مرحباً بك في نازو')}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-muted max-w-sm">
            {tr(
              'Choose who you are to enter the correspondence workspace.',
              'اختر هويتك للدخول إلى مساحة عمل المراسلات.',
            )}
          </p>
        </div>

        {/* identity picker */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {USERS.map((u) => {
            const active = u.id === selected
            return (
              <button
                key={u.id}
                onClick={() => setSelected(u.id)}
                className={cn(
                  'group relative flex items-center gap-3 rounded-2xl p-3 text-start transition-all hairline',
                  active
                    ? 'bg-brand-subtle ring-2 ring-brand shadow-e1'
                    : 'bg-app hover:bg-hover hover:-translate-y-0.5',
                )}
              >
                <Avatar initials={u.initials} color={u.color} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-ink truncate">
                    {tr(u.nameEn, u.nameAr)}
                  </span>
                  <span className="block text-[11px] text-ink-muted truncate">
                    {tr(u.titleEn, u.titleAr)} · {tr(ROLE_LABELS[u.role].en, ROLE_LABELS[u.role].ar)}
                  </span>
                </span>
                {active && (
                  <span className="grid place-items-center size-5 rounded-full bg-brand text-white shrink-0">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <Button variant="primary" size="lg" onClick={signIn} className="mt-6 w-full justify-center">
          {tr('Sign in', 'تسجيل الدخول')}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Button>
        <p className="mt-3 text-center text-[11px] text-ink-muted">
          {tr(
            'Demo access — no password. You can switch identity any time from the top bar.',
            'وصول تجريبي — بدون كلمة مرور. يمكنك تبديل الهوية في أي وقت من الشريط العلوي.',
          )}
        </p>
      </motion.div>
    </div>
  )
}
