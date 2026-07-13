import { Bell, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import { useLocalized } from '@/i18n'
import { APP_NAME } from '@/lib/constants'
import { Logo } from '@/components/common/Logo'
import { GlobalSearch } from '@/app/GlobalSearch'
import { LangToggle } from '@/app/LangToggle'
import { ThemeToggle } from '@/app/ThemeToggle'
import { UserSwitcher } from '@/app/UserSwitcher'

export function TopBar() {
  const tr = useLocalized()
  const aiOpen = useStore((s) => s.ui.aiPanelOpen)
  const toggleAi = useStore((s) => s.toggleAiPanel)

  return (
    <header className="h-16 shrink-0 flex items-stretch bg-surface border-b border-line">
      {/* brand — aligned over the navy rail */}
      <div className="w-64 shrink-0 flex items-center gap-2.5 px-5 bg-navy text-white">
        <Logo variant="mark" className="size-8" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">{APP_NAME}</div>
          <div className="text-[10px] text-white/45 -mt-0.5">{tr('Correspondence management', 'إدارة المراسلات')}</div>
        </div>
      </div>

      {/* main bar */}
      <div className="flex-1 flex items-center gap-3 px-5">
        <GlobalSearch />

        <div className="ms-auto flex items-center gap-1.5">
          {!aiOpen && (
            <button
              onClick={toggleAi}
              className="flex items-center gap-1.5 rounded-lg px-2.5 h-9 text-[13px] font-medium text-ai hover:bg-ai/10 transition-colors"
            >
              <Sparkles className="size-4" />
              <span className="hidden lg:inline">AI</span>
            </button>
          )}
          <LangToggle />
          <ThemeToggle />
          <button
            aria-label="Notifications"
            className="relative grid place-items-center size-9 rounded-lg text-ink-secondary hover:bg-hover hover:text-ink transition-colors"
          >
            <Bell className="size-[18px]" />
            <span className="absolute top-2 end-2 size-1.5 rounded-full bg-danger" />
          </button>
          <div className="w-px h-6 bg-line mx-1" />
          <UserSwitcher />
        </div>
      </div>
    </header>
  )
}
