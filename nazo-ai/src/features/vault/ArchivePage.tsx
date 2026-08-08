/**
 * The Archive — where finished correspondence lives, and how it proves itself.
 *
 * Three asks deliberately land on ONE page rather than three nav entries, because
 * shipped separately they would be three doors onto the same row:
 *   ARCHIVE  — terminal correspondence, out of the active inboxes but never deleted.
 *   VAULT    — each record carries the SHA-256 of the exact PDF bytes frozen when it
 *              finished; Verify re-hashes the stored bytes and compares.
 *   SEARCH   — full-text across reference, title, requester and signatories, scoped
 *              to the archive, with the matched field named on the result.
 *
 * "My vault" is the same records narrowed to what you authored or signed — a filter,
 * not a separate store. A document does not belong to one person, and pretending it
 * does would misrepresent an approval chain.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Archive,
  BadgeCheck,
  FileText,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Avatar } from '@/components/common/Avatar'
import { StatusBadge } from '@/components/common/StatusBadge'
import {
  fetchVault,
  verifyVaultRecord,
  type VaultRecord,
  type VaultVerdict,
} from '@/api/client'
import { USER_BY_ID } from '@/data/users'
import { useLang } from '@/i18n'
import { useStore } from '@/store'
import { staggerContainer, riseItem } from '@/lib/motion'
import type { CorrespondenceStatus } from '@/types'
import { cn } from '@/lib/cn'

type Scope = 'all' | 'mine'

/** Which field a query matched, so a hit never looks arbitrary. */
type Hit = { record: VaultRecord; matchedIn: string | null }

function nameOf(userId: string, isAr: boolean): string {
  const u = USER_BY_ID[userId]
  if (!u) return userId
  return isAr ? u.nameAr || u.nameEn : u.nameEn
}

function fmtDate(iso: string, isAr: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(isAr ? 'ar-AE-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Search across the fields a person actually remembers a document by. Returns the
 *  NAME of the matched field so the result can say why it surfaced. */
function match(record: VaultRecord, q: string, isAr: boolean): string | null {
  if (!q) return null
  const needle = q.trim().toLowerCase()
  if (!needle) return null
  const zones: [string, string][] = [
    ['reference', record.ref ?? ''],
    ['title', record.titleEn ?? ''],
    ['title', record.titleAr ?? ''],
    ['requester', nameOf(record.requesterId, isAr)],
    ['requester', nameOf(record.requesterId, !isAr)],
    ...record.signerIds.flatMap(
      (id) => [['signatory', nameOf(id, isAr)] as [string, string]],
    ),
  ]
  for (const [zone, text] of zones) {
    if (text && text.toLowerCase().includes(needle)) return zone
  }
  return null
}

const ZONE_LABEL: Record<string, { en: string; ar: string }> = {
  reference: { en: 'reference', ar: 'الرقم المرجعي' },
  title: { en: 'subject', ar: 'الموضوع' },
  requester: { en: 'requester', ar: 'مقدّم الطلب' },
  signatory: { en: 'signatory', ar: 'الموقّع' },
}

export function ArchivePage() {
  const isAr = useLang() === 'ar'
  const navigate = useNavigate()
  const currentUserId = useStore((s) => s.currentUserId)

  const [scope, setScope] = useState<Scope>('all')
  const [records, setRecords] = useState<VaultRecord[] | null>(null)
  const [query, setQuery] = useState('')
  const [verdicts, setVerdicts] = useState<Record<string, VaultVerdict | 'checking'>>({})

  const load = useCallback(async () => {
    setRecords(null)
    try {
      setRecords(await fetchVault(scope))
    } catch {
      setRecords([])
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load, currentUserId])

  const hits: Hit[] = useMemo(() => {
    const rows = records ?? []
    if (!query.trim()) return rows.map((r) => ({ record: r, matchedIn: null }))
    return rows
      .map((r) => ({ record: r, matchedIn: match(r, query, isAr) }))
      .filter((h) => h.matchedIn !== null)
  }, [records, query, isAr])

  const verify = async (id: string) => {
    setVerdicts((v) => ({ ...v, [id]: 'checking' }))
    try {
      const verdict = await verifyVaultRecord(id)
      setVerdicts((v) => ({ ...v, [id]: verdict }))
    } catch {
      setVerdicts((v) => ({
        ...v,
        [id]: { result: 'unsealed', ref: '', detail: 'Verification failed.' },
      }))
    }
  }

  const t = (en: string, ar: string) => (isAr ? ar : en)

  return (
    <PageTransition>
      <PageHeader
        icon={<Archive className="w-5 h-5" />}
        title={t('Archive', 'الأرشيف')}
        subtitle={t(
          'Closed correspondence, sealed and verifiable.',
          '.المراسلات المنتهية، مختومة وقابلة للتحقق',
        )}
      />

      {/* scope + search */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="inline-flex rounded-xl hairline bg-surface p-1">
          {(['all', 'mine'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                scope === s ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
              )}
            >
              {s === 'all' ? t('All archived', 'كل الأرشيف') : t('My vault', 'خزنتي')}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(
              'Search the archive — reference, subject, person…',
              '…ابحث في الأرشيف — الرقم المرجعي، الموضوع، الشخص',
            )}
            className="w-full ps-9 pe-3 py-2 rounded-xl hairline bg-surface text-sm
                       focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
      </div>

      {records === null && (
        <div className="py-16 grid place-items-center text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {records !== null && hits.length === 0 && (
        <EmptyState
          icon={<Archive className="w-5 h-5" />}
          title={
            query
              ? t('Nothing matches that', 'لا نتائج مطابقة')
              : scope === 'mine'
                ? t('Your vault is empty', 'خزنتك فارغة')
                : t('The archive is empty', 'الأرشيف فارغ')
          }
          body={
            query
              ? t(
                  'No archived document matches your search.',
                  '.لا يوجد مستند مؤرشف مطابق لبحثك',
                )
              : t(
                  'Correspondence lands here once its approval chain closes.',
                  '.تصل المراسلات إلى هنا بعد انتهاء مسار اعتمادها',
                )
          }
        />
      )}

      {records !== null && hits.length > 0 && (
        <motion.ul
          variants={staggerContainer()}
          initial="hidden"
          animate="show"
          className="space-y-3"
        >
          {hits.map(({ record, matchedIn }) => {
            const verdict = verdicts[record.id]
            const title = isAr ? record.titleAr || record.titleEn : record.titleEn
            return (
              <motion.li
                key={record.id}
                variants={riseItem}
                className="rounded-2xl hairline bg-surface shadow-e1 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-subtle grid place-items-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-ink-muted" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => navigate(`/correspondence/${record.id}`)}
                      className="text-start w-full"
                    >
                      <div className="font-medium truncate hover:text-accent transition-colors">
                        {title}
                      </div>
                      <div className="text-xs text-ink-muted font-mono mt-0.5">
                        {record.ref}
                      </div>
                    </button>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <StatusBadge status={record.status as CorrespondenceStatus} />
                      <span className="text-xs text-ink-muted">
                        {fmtDate(record.updatedAt, isAr)}
                      </span>
                      {record.signerIds.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                          <Avatar
                            initials={USER_BY_ID[record.signerIds[0]]?.initials ?? '?'}
                            color={USER_BY_ID[record.signerIds[0]]?.color}
                            size={18}
                          />
                          {record.signerIds.length === 1
                            ? nameOf(record.signerIds[0], isAr)
                            : t(
                                `${record.signerIds.length} signatories`,
                                `${record.signerIds.length} موقّعين`,
                              )}
                        </span>
                      )}
                      {matchedIn && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-info-subtle text-info">
                          {t('matched in ', 'مطابقة في ')}
                          {(ZONE_LABEL[matchedIn] ?? { en: matchedIn, ar: matchedIn })[
                            isAr ? 'ar' : 'en'
                          ]}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0 text-end">
                    <SealBadge record={record} verdict={verdict} isAr={isAr} />
                    <button
                      onClick={() => { void verify(record.id) }}
                      disabled={verdict === 'checking'}
                      className="mt-2 text-xs px-2.5 py-1 rounded-lg hairline
                                 hover:bg-subtle transition-colors disabled:opacity-50"
                    >
                      {verdict === 'checking'
                        ? t('Checking…', '…جارٍ التحقق')
                        : t('Verify', 'تحقّق')}
                    </button>
                  </div>
                </div>

                {verdict && verdict !== 'checking' && (
                  <VerdictPanel verdict={verdict} record={record} isAr={isAr} />
                )}
              </motion.li>
            )
          })}
        </motion.ul>
      )}
    </PageTransition>
  )
}

function SealBadge({
  record,
  verdict,
  isAr,
}: {
  record: VaultRecord
  verdict: VaultVerdict | 'checking' | undefined
  isAr: boolean
}) {
  const t = (en: string, ar: string) => (isAr ? ar : en)
  if (verdict && verdict !== 'checking') {
    if (verdict.result === 'verified')
      return (
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <ShieldCheck className="w-4 h-4" />
          {t('Verified', 'تم التحقق')}
        </span>
      )
    if (verdict.result === 'mismatch')
      return (
        <span className="inline-flex items-center gap-1 text-xs text-danger">
          <ShieldAlert className="w-4 h-4" />
          {t('Mismatch', 'عدم تطابق')}
        </span>
      )
  }
  if (record.seal)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
        <BadgeCheck className="w-4 h-4" />
        {t('Sealed', 'مختوم')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
      <ShieldQuestion className="w-4 h-4" />
      {t('Unsealed', 'غير مختوم')}
    </span>
  )
}

function VerdictPanel({
  verdict,
  record,
  isAr,
}: {
  verdict: VaultVerdict
  record: VaultRecord
  isAr: boolean
}) {
  const t = (en: string, ar: string) => (isAr ? ar : en)
  const tone =
    verdict.result === 'verified'
      ? 'bg-success-subtle text-success'
      : verdict.result === 'mismatch'
        ? 'bg-danger-subtle text-danger'
        : 'bg-subtle text-ink-muted'
  return (
    <div className={cn('mt-3 rounded-xl p-3 text-xs', tone)}>
      {verdict.result === 'verified' && (
        <p>
          {t(
            'The archived PDF still hashes to exactly what was sealed when this document closed.',
            '.ملف PDF المؤرشف ما زال مطابقًا تمامًا لما خُتم عند إغلاق المستند',
          )}
        </p>
      )}
      {verdict.result === 'mismatch' && (
        <p>
          {t(
            'The archived bytes no longer match the seal. This document has changed since it closed.',
            '.محتوى الملف المؤرشف لم يعد مطابقًا للختم — تغيّر المستند بعد إغلاقه',
          )}
        </p>
      )}
      {verdict.result === 'unsealed' && (
        <p>{verdict.detail ?? t('No seal was recorded.', '.لم يُسجَّل ختم لهذا المستند')}</p>
      )}
      {verdict.expected && (
        <dl className="mt-2 space-y-1 font-mono break-all opacity-90">
          <div>
            <span className="opacity-70">{t('sealed  ', 'المختوم  ')}</span>
            {verdict.expected}
          </div>
          <div>
            <span className="opacity-70">{t('current ', 'الحالي  ')}</span>
            {verdict.actual}
          </div>
          <div className="opacity-70">
            {t('version ', 'الإصدار ')}
            {verdict.version} · {fmtBytes(verdict.bytes)} ·{' '}
            {record.seal?.algorithm ?? 'sha256'}
          </div>
        </dl>
      )}
    </div>
  )
}
