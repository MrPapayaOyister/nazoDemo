import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { scaleIn } from '@/lib/motion'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
  tone?: 'default' | 'success'
}

export function EmptyState({ icon, title, body, action, tone = 'default' }: EmptyStateProps) {
  return (
    <motion.div
      variants={scaleIn}
      initial="initial"
      animate="animate"
      className="flex flex-col items-center justify-center text-center py-16 px-6"
    >
      <span
        className={
          'grid place-items-center size-16 rounded-3xl ' +
          (tone === 'success' ? 'bg-success-subtle text-success' : 'bg-subtle text-ink-muted')
        }
      >
        {icon}
      </span>
      <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
      {body && <p className="mt-1 text-[13px] text-ink-muted max-w-[340px]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  )
}
