import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { CorrespondenceCard } from '@/components/common/CorrespondenceCard'
import { useSentByMe } from '@/store'
import { useLocalized } from '@/i18n'
import { staggerContainer } from '@/lib/motion'

/** "Sent by me" (item 6) — everything the signed-in identity personally created,
 *  at ANY workflow state and regardless of who currently holds it. Available to
 *  every role; approvers/admin who never create anything simply see the empty state.
 *  Sorted most-recently-updated first, like every other correspondence list. */
export function SentByMe() {
  const tr = useLocalized()
  const mine = useSentByMe()

  return (
    <PageTransition>
      <PageHeader
        title={tr('Sent by me', 'المُرسَلة مني')}
        subtitle={tr(
          'Every correspondence you created — wherever it is in the workflow.',
          'كل مراسلة أنشأتها — أينما كانت في المسار.',
        )}
        icon={<Send className="size-5" />}
      />

      {mine.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<Send className="size-7" />}
            title={tr("You haven't sent anything yet", 'لم ترسل شيئاً بعد')}
          />
        </div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05, 0.05)}
          initial="initial"
          animate="animate"
          className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {mine.map((c) => (
            <CorrespondenceCard key={c.id} corr={c} />
          ))}
        </motion.div>
      )}
    </PageTransition>
  )
}
