import type { Variants, Transition } from 'framer-motion'

/** Cinematic easing curves. */
export const EASE = {
  standard: [0.22, 1, 0.36, 1],
  emphasized: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 0.2, 1],
} as const

/** Cinematic durations (seconds). */
export const DUR = {
  micro: 0.18,
  base: 0.32,
  page: 0.6,
  load: 0.9,
  reveal: 0.7,
} as const

export const springSettle: Transition = {
  type: 'spring',
  stiffness: 180,
  damping: 26,
  mass: 0.9,
}

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 140,
  damping: 22,
  mass: 1,
}

/** Route-level page transition (used with <AnimatePresence mode="wait">). */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 24, scale: 0.985, filter: 'blur(6px)' },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: DUR.page, ease: EASE.emphasized },
  },
  exit: {
    opacity: 0,
    scale: 0.985,
    filter: 'blur(4px)',
    transition: { duration: 0.38, ease: EASE.exit },
  },
}

/** Staggered container for page-load / list entrances. */
export function staggerContainer(stagger = 0.08, delayChildren = 0.05): Variants {
  return {
    initial: {},
    animate: { transition: { staggerChildren: stagger, delayChildren } },
  }
}

/** Rise-and-settle child (paired with staggerContainer). */
export const riseItem: Variants = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.reveal, ease: EASE.standard },
  },
}

export const fadeItem: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DUR.base, ease: EASE.standard } },
}

/** Cinematic scale-in for hero cards / modals. */
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.94, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: springSettle,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 8,
    transition: { duration: 0.24, ease: EASE.exit },
  },
}

/** AI reveal — result content rising in with a soft settle. */
export const aiReveal: Variants = {
  initial: { opacity: 0, y: 22, scale: 0.97, filter: 'blur(8px)' },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: DUR.reveal, ease: EASE.emphasized },
  },
}

/** Hover-lift props for cards. */
export const hoverLift = {
  whileHover: { y: -2, transition: { duration: DUR.micro, ease: EASE.standard } },
  whileTap: { scale: 0.99 },
}
