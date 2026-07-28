import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PlusCircle } from 'lucide-react'
import { useCan, CREATE_CORRESPONDENCE } from '@/lib/permissions'
import { useLocalized } from '@/i18n'
import { EASE } from '@/lib/motion'

/** Routes where a "new correspondence" shortcut is redundant or in the way. */
const HIDE_ON = ['/requester/new', '/admin/templates', '/admin/workflows']

/**
 * Global floating action button — start a correspondence from anywhere.
 *
 * Fixed to the viewport bottom-inline-end. `end-*` (not `right-*`) so it flips with RTL.
 * z-30 sits above page content but BELOW the notification panel (z-50), the attachment
 * viewer / sign modals (z-50) and sonner toasts, so it never covers a dialog.
 */
export function CreateFab() {
  const tr = useLocalized()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const canCreate = useCan(CREATE_CORRESPONDENCE)

  if (!canCreate || HIDE_ON.some((p) => pathname.startsWith(p))) return null

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE.emphasized }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.96 }}
      onClick={() => navigate('/requester/new')}
      title={tr('New correspondence', 'مراسلة جديدة')}
      aria-label={tr('New correspondence', 'مراسلة جديدة')}
      className="group fixed bottom-6 end-6 z-30 inline-flex items-center gap-2 rounded-full bg-brand text-white shadow-e2 ps-4 pe-5 py-3.5 hover:shadow-lg transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
    >
      <PlusCircle className="size-5 shrink-0" />
      <span className="text-[13px] font-semibold whitespace-nowrap">
        {tr('New correspondence', 'مراسلة جديدة')}
      </span>
    </motion.button>
  )
}
