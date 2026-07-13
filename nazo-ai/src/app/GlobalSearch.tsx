import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, FileText } from 'lucide-react'
import { useT, useLocalized } from '@/i18n'
import { useSearchCorrespondences } from '@/store'
import { StatusBadge } from '@/components/common/StatusBadge'

/** The working global search in the top bar: a live results dropdown of the top
 *  matches, Enter / "See all" → the /search page, ⌘K / Ctrl+K to focus. Scope is
 *  whatever the signed-in identity can see. */
export function GlobalSearch() {
  const t = useT()
  const tr = useLocalized()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const results = useSearchCorrespondences(query)
  const top = results.slice(0, 6)

  // ⌘K / Ctrl+K focuses the search; Escape closes the dropdown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      } else if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click outside closes the dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const goAll = () => {
    const q = query.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
    setOpen(false)
    inputRef.current?.blur()
  }
  const goOne = (id: string) => {
    navigate(`/correspondence/${id}`)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-md">
      <div className="flex items-center gap-2 rounded-xl bg-subtle px-3 h-9 text-ink-muted focus-within:ring-2 focus-within:ring-brand/30 transition-shadow">
        <Search className="size-4" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') goAll()
          }}
          placeholder={t('common.search')}
          className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-muted outline-none"
        />
        <kbd className="hidden md:inline text-[10px] font-medium text-ink-muted bg-surface hairline rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </div>

      <AnimatePresence>
        {open && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
            className="absolute z-50 mt-2 w-full rounded-2xl bg-surface hairline shadow-e3 p-1.5"
          >
            {top.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12.5px] text-ink-muted">
                {tr('No matching correspondences', 'لا توجد مراسلات مطابقة')}
              </div>
            ) : (
              top.map((c) => (
                <button
                  key={c.id}
                  onClick={() => goOne(c.id)}
                  className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-hover transition-colors text-start"
                >
                  <span className="grid place-items-center size-8 rounded-lg bg-brand-subtle text-brand shrink-0">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink truncate">{tr(c.titleEn, c.titleAr)}</span>
                    <span className="block text-[11px] text-ink-muted font-mono truncate">{c.ref}</span>
                  </span>
                  <StatusBadge status={c.status} />
                </button>
              ))
            )}
            {results.length > 0 && (
              <button
                onClick={goAll}
                className="mt-0.5 w-full rounded-xl px-2.5 py-2 text-center text-[12px] font-semibold text-brand hover:bg-hover transition-colors"
              >
                {tr(`See all ${results.length} result${results.length === 1 ? '' : 's'}`, `عرض كل النتائج (${results.length})`)}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
