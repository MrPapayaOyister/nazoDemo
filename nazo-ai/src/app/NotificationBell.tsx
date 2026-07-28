import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Clock, RotateCcw, CheckCircle2, Share2, BellOff } from 'lucide-react'
import { useStore } from '@/store'
import { useLocalized, useLang } from '@/i18n'
import { listNotifications, unreadNotificationCount, markNotificationRead, markAllNotificationsRead } from '@/api/client'
import type { AppNotification, NotificationType } from '@/types'
import { cn } from '@/lib/cn'

const POLL_MS = 20000

const ICON: Record<NotificationType, typeof Bell> = {
  awaiting: Clock,
  returned: RotateCcw,
  completed: CheckCircle2,
  template_shared: Share2,
}
const TONE: Record<NotificationType, string> = {
  awaiting: 'bg-ai/12 text-ai',
  returned: 'bg-warning-subtle text-warning',
  completed: 'bg-success-subtle text-success',
  template_shared: 'bg-brand-subtle text-brand',
}

function useNotifText() {
  const tr = useLocalized()
  return (n: AppNotification) => {
    const p = (n.payload ?? {}) as Record<string, string>
    const subject = tr(p.titleEn ?? p.templateNameEn ?? '', p.titleAr ?? p.templateNameAr ?? '')
    const head =
      n.type === 'awaiting'
        ? tr('Awaiting your action', 'بانتظار إجرائك')
        : n.type === 'returned'
          ? tr('Returned for changes', 'أُعيدت للتعديل')
          : n.type === 'completed'
            ? tr('Completed', 'اكتملت')
            : tr('Template shared with you', 'تمّت مشاركة نموذج معك')
    return { head, subject }
  }
}

export function NotificationBell() {
  const tr = useLocalized()
  const lang = useLang()
  const navigate = useNavigate()
  const currentUserId = useStore((s) => s.currentUserId)
  const notifText = useNotifText()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [count, setCount] = useState(0)
  // The identity a request was ISSUED for. A response is applied only if the identity
  // hasn't changed since — so a slow poll for the previous user (or the default identity
  // before a persisted session restores on refresh) can never overwrite the current
  // user's count/list (out-of-order + rehydrate races).
  const idRef = useRef(currentUserId)
  idRef.current = currentUserId

  const refreshCount = useCallback(() => {
    const issuedFor = idRef.current
    unreadNotificationCount()
      .then((c) => {
        if (idRef.current === issuedFor) setCount(c)
      })
      .catch(() => {})
  }, [])
  const refreshList = useCallback(() => {
    const issuedFor = idRef.current
    listNotifications()
      .then((list) => {
        if (idRef.current === issuedFor) setItems(list)
      })
      .catch(() => {})
  }, [])

  // Poll the cheap unread-count; reset + refetch whenever the identity switches.
  useEffect(() => {
    setOpen(false)
    setCount(0)
    setItems([])
    refreshCount()
    const t = window.setInterval(refreshCount, POLL_MS)
    return () => window.clearInterval(t)
  }, [currentUserId, refreshCount])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) refreshList()
  }

  const onItem = async (n: AppNotification) => {
    if (!n.readAt) {
      await markNotificationRead(n.id).catch(() => {})
      refreshCount()
    }
    setOpen(false)
    if (n.correspondenceId) navigate(`/correspondence/${n.correspondenceId}`)
  }

  const markAll = async () => {
    await markAllNotificationsRead().catch(() => {})
    refreshCount()
    refreshList()
  }

  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    } catch {
      return iso
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={tr('Notifications', 'الإشعارات')}
        className="relative grid place-items-center size-9 rounded-lg text-ink-secondary hover:bg-hover hover:text-ink transition-colors"
      >
        <Bell className="size-[18px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-danger text-white text-[10px] font-bold leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 mt-2 w-80 max-h-[70vh] z-50 flex flex-col rounded-2xl bg-surface shadow-e2 hairline overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line">
              <span className="text-[13px] font-semibold text-ink">{tr('Notifications', 'الإشعارات')}</span>
              {items.some((n) => !n.readAt) && (
                <button
                  onClick={markAll}
                  className="ms-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
                >
                  <CheckCheck className="size-3.5" />
                  {tr('Mark all read', 'تعليم الكل كمقروء')}
                </button>
              )}
            </div>

            <div className="overflow-y-auto">
              {items.length === 0 ? (
                <div className="grid place-items-center gap-1.5 py-8 text-center">
                  <BellOff className="size-5 text-ink-muted/60" />
                  <span className="text-[12px] text-ink-muted">{tr('No notifications', 'لا توجد إشعارات')}</span>
                </div>
              ) : (
                items.map((n) => {
                  const Icon = ICON[n.type]
                  const { head, subject } = notifText(n)
                  return (
                    <button
                      key={n.id}
                      onClick={() => onItem(n)}
                      className={cn(
                        'w-full flex items-start gap-2.5 px-4 py-2.5 text-start border-b border-line last:border-0 transition-colors hover:bg-hover',
                        !n.readAt && 'bg-brand-subtle/30',
                      )}
                    >
                      <span className={cn('mt-0.5 grid place-items-center size-7 rounded-lg shrink-0', TONE[n.type])}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-ink">{head}</span>
                        {subject && <span className="block text-[11.5px] text-ink-secondary truncate">{subject}</span>}
                        <span className="block text-[10.5px] text-ink-muted mt-0.5">{fmt(n.createdAt)}</span>
                      </span>
                      {!n.readAt && <span className="mt-1.5 size-2 rounded-full bg-brand shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
