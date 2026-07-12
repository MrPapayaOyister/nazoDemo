import { motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useStore } from '@/store'

export function ThemeToggle() {
  const theme = useStore((s) => s.ui.theme)
  const toggle = useStore((s) => s.toggleTheme)
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="grid place-items-center size-9 rounded-lg text-ink-secondary hover:bg-hover hover:text-ink transition-colors overflow-hidden"
    >
      {/* keyed by theme → remounts and plays the enter rotate on each toggle
          (no AnimatePresence exit, which stalls under StrictMode here). */}
      <motion.span
        key={theme}
        initial={{ rotate: -40, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="grid place-items-center"
      >
        {theme === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
      </motion.span>
    </button>
  )
}
