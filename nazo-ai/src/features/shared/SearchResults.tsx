import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, SearchX } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { CorrespondenceCard } from '@/components/common/CorrespondenceCard'
import { useSearchCorrespondences } from '@/store'
import { useLocalized } from '@/i18n'
import { staggerContainer } from '@/lib/motion'

/** Global search results — matches from `useSearchCorrespondences`, rendered with
 *  the shared CorrespondenceCard. Query comes from the `?q=` param (set by the top-bar
 *  search). Scope is whatever the signed-in identity can see. */
export function SearchResults() {
  const tr = useLocalized()
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const results = useSearchCorrespondences(q)

  return (
    <PageTransition>
      <PageHeader
        title={tr('Search', 'البحث')}
        subtitle={
          q
            ? tr(`${results.length} result${results.length === 1 ? '' : 's'} for “${q}”`, `${results.length} نتيجة عن «${q}»`)
            : tr('Search correspondences by title, reference, sender or content.', 'ابحث في المراسلات بالعنوان أو المرجع أو المُرسِل أو المحتوى.')
        }
        icon={<Search className="size-5" />}
      />

      {!q ? (
        <div className="mt-10">
          <EmptyState
            icon={<Search className="size-7" />}
            title={tr('Start typing to search', 'ابدأ الكتابة للبحث')}
          />
        </div>
      ) : results.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<SearchX className="size-7" />}
            title={tr('No matching correspondences', 'لا توجد مراسلات مطابقة')}
          />
        </div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05, 0.05)}
          initial="initial"
          animate="animate"
          className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {results.map((c) => (
            <CorrespondenceCard key={c.id} corr={c} />
          ))}
        </motion.div>
      )}
    </PageTransition>
  )
}
