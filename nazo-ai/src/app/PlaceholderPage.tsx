import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { riseItem } from '@/lib/motion'

interface PlaceholderPageProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  note?: string
}

export function PlaceholderPage({ title, subtitle, icon, note }: PlaceholderPageProps) {
  return (
    <PageTransition>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon ?? <Sparkles className="size-5" />}
      />

      {/* KPI skeleton row */}
      <motion.div variants={riseItem} className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-surface hairline shadow-e1 p-5">
            <div className="h-3 w-20 rounded bg-subtle" />
            <div className="mt-4 h-8 w-16 rounded bg-subtle" />
            <div className="mt-3 h-2.5 w-28 rounded bg-subtle" />
          </div>
        ))}
      </motion.div>

      {/* body split */}
      <motion.div variants={riseItem} className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl bg-surface hairline shadow-e1 p-6">
          <div className="h-4 w-40 rounded bg-subtle" />
          <div className="mt-6 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-subtle shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 rounded bg-subtle" style={{ width: `${70 - i * 8}%` }} />
                  <div className="h-2.5 w-1/3 rounded bg-subtle" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-surface hairline shadow-e1 p-6 flex flex-col items-center justify-center text-center min-h-[220px]">
          <span className="grid place-items-center size-12 rounded-2xl bg-ai/12 text-ai animate-breathe">
            <Sparkles className="size-6" />
          </span>
          <p className="mt-4 text-sm font-semibold text-ink">This surface is coming together</p>
          <p className="mt-1 text-[13px] text-ink-muted max-w-[220px]">
            {note ?? 'The AI-orchestrated experience for this page lands in the next build phase.'}
          </p>
        </div>
      </motion.div>
    </PageTransition>
  )
}
