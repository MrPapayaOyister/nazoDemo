import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { riseItem } from '@/lib/motion'
import { cn } from '@/lib/cn'

interface PageHeaderProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, icon, actions, className }: PageHeaderProps) {
  return (
    <motion.header
      variants={riseItem}
      className={cn('flex items-start justify-between gap-4', className)}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="grid place-items-center size-10 rounded-xl bg-brand-subtle text-brand shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink truncate">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </motion.header>
  )
}
