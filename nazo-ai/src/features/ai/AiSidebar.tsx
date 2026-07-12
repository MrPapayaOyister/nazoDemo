import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, ChevronRight, ArrowUp, Undo2, ArrowUpRight } from 'lucide-react'
import { useStore, useCurrentUser } from '@/store'
import { useAI } from '@/ai/useAI'
import { getChips } from '@/ai/chips'
import { useT, useLocalized } from '@/i18n'
import { ICONS } from '@/lib/icons'
import { EASE, aiReveal } from '@/lib/motion'
import type { AiActionId, AiMessage, ResultCard } from '@/types'
import { cn } from '@/lib/cn'

export function AiSidebar() {
  const open = useStore((s) => s.ui.aiPanelOpen)
  const toggle = useStore((s) => s.toggleAiPanel)

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 360 : 52 }}
      transition={{ duration: 0.5, ease: EASE.emphasized }}
      className="shrink-0 overflow-hidden border-s border-line bg-surface"
    >
      {open ? <PanelBody onCollapse={toggle} /> : <Rail onOpen={toggle} />}
    </motion.aside>
  )
}

function Rail({ onOpen }: { onOpen: () => void }) {
  const running = useStore((s) => s.ai.isRunning)
  return (
    <button
      onClick={onOpen}
      aria-label="Open AI panel"
      className="w-[52px] h-full flex flex-col items-center pt-4 gap-3 hover:bg-hover transition-colors"
    >
      <span className={cn('grid place-items-center size-9 rounded-xl bg-ai/12 text-ai', running && 'animate-breathe')}>
        <Sparkles className="size-[18px]" />
      </span>
    </button>
  )
}

function PanelBody({ onCollapse }: { onCollapse: () => void }) {
  const t = useT()
  const tr = useLocalized()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { run, isRunning, messages } = useAI()
  const [input, setInput] = useState('')

  const hasDraft = useStore((s) => !!s.studioDraft)
  // suggest-variables / translate need an existing draft; hide them until one
  // exists so they can't post a "done" card with nothing to act on.
  const chips = getChips(location.pathname, user.role).filter((c) =>
    hasDraft || (c.actionId !== 'admin.suggestVariables' && c.actionId !== 'admin.translateTemplate'),
  )
  const viewerCorrId = useStore((s) => s.viewer.corrId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastResultId = [...messages].reverse().find((m) => m.role === 'result')?.id

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const fire = (actionId: AiActionId, prompt?: string) => {
    if (isRunning) return
    run({
      actionId,
      role: user.role,
      currentUserId: user.id,
      corrId: viewerCorrId ?? undefined,
      prompt,
    })
  }

  const onSend = () => {
    if (!input.trim() || isRunning || !chips.length) return
    // Capture the typed text BEFORE clearing so the live SSE bridge receives the
    // prompt the Step-6a handlers (generateTemplate / buildWorkflow) require.
    const text = input.trim()
    setInput('')
    fire(chips[0].actionId, text)
  }

  return (
    <div className="w-[360px] h-full flex flex-col">
      {/* header */}
      <div className="px-4 pt-4 pb-3 bg-ai/[0.06] border-b border-line">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className={cn('grid place-items-center size-9 rounded-xl bg-ai/12 text-ai', isRunning && 'animate-breathe')}>
              <Sparkles className="size-[18px]" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-ink">{t('ai.title')}</div>
              <div className="text-[11px] text-ink-muted">{t('ai.subtitle')}</div>
            </div>
          </div>
          <button
            onClick={onCollapse}
            aria-label="Collapse AI panel"
            className="grid place-items-center size-7 rounded-lg text-ink-muted hover:bg-hover hover:text-ink transition-colors"
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </button>
        </div>
      </div>

      {/* chips */}
      <div className="px-4 pt-3 pb-2 border-b border-line">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
          {tr('Suggested for you', 'مقترح لك')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => {
            const Icon = ICONS[c.icon as keyof typeof ICONS]
            return (
              <button
                key={c.actionId}
                onClick={() => fire(c.actionId)}
                disabled={isRunning}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg hairline bg-app px-2.5 py-1.5 text-[12px] font-medium text-ink-secondary',
                  'hover:bg-hover hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {Icon && <Icon className="size-3.5 text-ai" />}
                {tr(c.labelEn, c.labelAr)}
              </button>
            )
          })}
        </div>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isRunning && (
          <div className="mt-6 text-center text-[13px] text-ink-muted px-4">
            {tr(
              'Pick an action above — I’ll do it right here on the page.',
              'اختر إجراءً بالأعلى — سأقوم به مباشرة على الصفحة.',
            )}
          </div>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} isLastResult={m.id === lastResultId} onNavigate={navigate} onRun={fire} />
        ))}
      </div>

      {/* composer */}
      <div className="p-3 border-t border-line">
        <div className="rounded-2xl hairline bg-app p-2 focus-within:ring-2 focus-within:ring-ai/30 transition-shadow">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder={t('ai.placeholder')}
            className="w-full resize-none bg-transparent px-2 py-1 text-[13px] text-ink placeholder:text-ink-muted outline-none"
          />
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-ink-muted">{tr('Scripted demo AI', 'ذكاء تجريبي')}</span>
            <button
              onClick={onSend}
              disabled={isRunning}
              className="grid place-items-center size-8 rounded-xl text-white bg-ai-gradient shadow-e-ai hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageRow({
  m,
  isLastResult,
  onNavigate,
  onRun,
}: {
  m: AiMessage
  isLastResult: boolean
  onNavigate: (to: string) => void
  onRun: (a: AiActionId) => void
}) {
  const tr = useLocalized()
  if (m.role === 'thinking') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2.5 rounded-xl bg-ai/[0.06] px-3 py-2.5"
      >
        <span className="grid place-items-center size-6 rounded-lg bg-ai/15 text-ai shrink-0">
          <Sparkles className="size-3.5 animate-breathe" />
        </span>
        <span className="text-[13px] text-ink-secondary flex-1">{tr(m.textEn ?? '', m.textAr ?? '')}</span>
        <span className="flex gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1 rounded-full bg-ai animate-dots" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      </motion.div>
    )
  }
  if (m.role === 'result' && m.card) {
    return <ResultCardView card={m.card} showUndo={isLastResult} onNavigate={onNavigate} onRun={onRun} />
  }
  // user / assistant plain text
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'text-[13px] rounded-xl px-3 py-2 max-w-[85%]',
        m.role === 'user' ? 'ms-auto bg-brand text-white' : 'bg-subtle text-ink',
      )}
    >
      {tr(m.textEn ?? '', m.textAr ?? '')}
    </motion.div>
  )
}

function ResultCardView({
  card,
  showUndo,
  onNavigate,
  onRun,
}: {
  card: ResultCard
  showUndo: boolean
  onNavigate: (to: string) => void
  onRun: (a: AiActionId) => void
}) {
  const tr = useLocalized()
  const undoLast = useStore((s) => s.undoLast)
  // Undo lives on the most-recent result card only — lastUndo holds a single
  // snapshot, so an older card's Undo would revert the wrong action.
  const canUndo = useStore((s) => showUndo && !!s.lastUndo)
  return (
    <motion.div variants={aiReveal} initial="initial" animate="animate" className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
      <div className="px-3.5 pt-3 pb-2 bg-ai/[0.06]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-ai" />
          <span className="text-[13px] font-semibold text-ink">{tr(card.titleEn, card.titleAr)}</span>
        </div>
      </div>
      <div className="px-3.5 py-2.5">
        <p className="text-[12.5px] text-ink-secondary leading-relaxed">{tr(card.summaryEn, card.summaryAr)}</p>
        {card.bulletsEn && (
          <ul className="mt-2 space-y-1.5">
            {(tr(card.bulletsEn.join('|'), (card.bulletsAr ?? card.bulletsEn).join('|')).split('|')).map((b, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-ink-secondary">
                <span className="mt-1.5 size-1 rounded-full bg-ai shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          {card.cta && (
            <button
              onClick={() => {
                // honor both: navigate first (so the target is mounted), then run
                if (card.cta?.to) onNavigate(card.cta.to)
                if (card.cta?.action) onRun(card.cta.action)
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-ai-gradient text-white px-2.5 py-1.5 text-[12px] font-semibold hover:opacity-95 transition-opacity"
            >
              {tr(card.cta.labelEn, card.cta.labelAr)}
              <ArrowUpRight className="size-3.5" />
            </button>
          )}
          {canUndo && (
            <button
              onClick={undoLast}
              className="inline-flex items-center gap-1 rounded-lg text-[12px] font-medium text-ink-muted hover:text-ink transition-colors"
            >
              <Undo2 className="size-3.5" />
              {tr('Undo', 'تراجع')}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
