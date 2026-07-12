import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { staggerContainer } from '@/lib/motion'
import { cn } from '@/lib/cn'

/**
 * Per-page content wrapper. The page-level fade/scale/blur transition is owned
 * by the keyed motion wrapper in AnimatedRoutes (AppShell); here we only provide
 * the scroll region and the staggered reveal cascade for the page's children.
 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('h-full overflow-y-auto', className)}>
      <motion.div
        variants={staggerContainer(0.08, 0.12)}
        initial="initial"
        animate="animate"
        className="mx-auto w-full max-w-[1240px] px-8 py-8"
      >
        {children}
      </motion.div>
    </div>
  )
}
