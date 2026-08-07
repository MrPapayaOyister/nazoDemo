/**
 * Public verification card — where the QR printed on every document lands.
 *
 * Reached by scanning a paper letter, so it must work for someone with NO session:
 * it renders OUTSIDE the login gate (see App.tsx), never calls hydrate(), and shows
 * only what /api/verify returns — reference, title, status, dates and signatories.
 * Deliberately no document body, no values, no attachments: confirming a letter is
 * genuine should not disclose its contents.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BadgeCheck, Clock, FileWarning, Loader2, ShieldAlert } from 'lucide-react'
import { API_BASE } from '@/api/client'
import { Logo } from '@/components/common/Logo'
import { useStore } from '@/store'

type Signatory = {
  nameEn: string
  nameAr: string
  titleEn: string
  titleAr: string
  signedAt: string
  mark: 'signature' | 'initials'
}

type VerifyResult = {
  ref: string
  titleEn: string
  titleAr: string
  status: string
  issuedAt: string
  updatedAt: string
  signatories: Signatory[]
  isFinal: boolean
}

/** The slug is the last path segment of /r/<slug>. Read from location directly —
 *  this page renders before the router does, so there is no useParams here. */
function slugFromLocation(): string {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? '')
}

function fmtDate(iso: string, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Western digits on both sides — the convention the documents already use.
  return d.toLocaleDateString(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const STATUS_TEXT: Record<string, { en: string; ar: string }> = {
  Draft: { en: 'Draft — not issued', ar: 'مسودة — غير صادرة' },
  InReview: { en: 'In review — not final', ar: 'قيد المراجعة — غير نهائية' },
  Rejected: { en: 'Returned — not in force', ar: 'مُعادة — غير سارية' },
  Approved: { en: 'Approved', ar: 'معتمدة' },
  Completed: { en: 'Signed and issued', ar: 'موقّعة وصادرة' },
}

export function PublicVerify() {
  const lang = useStore((s) => s.ui.lang)
  const isAr = lang === 'ar'
  const [state, setState] = useState<'loading' | 'found' | 'missing' | 'error'>('loading')
  const [data, setData] = useState<VerifyResult | null>(null)
  const slug = slugFromLocation()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/verify/${encodeURIComponent(slug)}`)
        if (!alive) return
        if (res.status === 404) {
          setState('missing')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        setData((await res.json()) as VerifyResult)
        setState('found')
      } catch {
        if (alive) setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [slug])

  const t = (en: string, ar: string) => (isAr ? ar : en)

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="min-h-screen bg-canvas text-text flex flex-col items-center justify-center p-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-center mb-6">
          <Logo variant="full" />
        </div>

        <div className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden">
          {state === 'loading' && (
            <div className="p-10 grid place-items-center text-muted">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="mt-3 text-sm">{t('Checking the register…', '…جارٍ التحقق من السجل')}</p>
            </div>
          )}

          {state === 'missing' && (
            <div className="p-8 text-center">
              <FileWarning className="w-10 h-10 mx-auto text-warning" />
              <h1 className="mt-3 text-lg font-semibold">
                {t('No such document', 'لا يوجد مستند بهذا الرقم')}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {t(
                  'No document is registered under this reference.',
                  '.لا يوجد مستند مسجل تحت هذا الرقم المرجعي',
                )}
              </p>
              <p className="mt-3 text-xs font-mono text-muted break-all">{slug}</p>
            </div>
          )}

          {state === 'error' && (
            <div className="p-8 text-center">
              <ShieldAlert className="w-10 h-10 mx-auto text-danger" />
              <h1 className="mt-3 text-lg font-semibold">
                {t('Could not verify', 'تعذر التحقق')}
              </h1>
              <p className="mt-2 text-sm text-muted">
                {t('The register is unreachable. Try again.', '.السجل غير متاح، حاول مرة أخرى')}
              </p>
            </div>
          )}

          {state === 'found' && data && (
            <>
              <div
                className={`px-6 py-5 flex items-center gap-3 ${
                  data.isFinal ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
                }`}
              >
                {data.isFinal ? (
                  <BadgeCheck className="w-7 h-7 flex-shrink-0" />
                ) : (
                  <Clock className="w-7 h-7 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="font-semibold leading-tight">
                    {data.isFinal
                      ? t('Genuine document', 'مستند صحيح')
                      : t('Registered — not yet final', 'مسجل — غير نهائي بعد')}
                  </div>
                  <div className="text-xs opacity-80">
                    {(STATUS_TEXT[data.status] ?? { en: data.status, ar: data.status })[
                      isAr ? 'ar' : 'en'
                    ]}
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <Field label={t('Reference', 'الرقم المرجعي')}>
                  <span className="font-mono text-sm">{data.ref}</span>
                </Field>
                <Field label={t('Subject', 'الموضوع')}>
                  {isAr ? data.titleAr || data.titleEn : data.titleEn}
                </Field>
                <Field label={t('Issued', 'تاريخ الإصدار')}>{fmtDate(data.issuedAt, lang)}</Field>

                {data.signatories.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted mb-2">
                      {t('Signed by', 'موقّعة من')}
                    </div>
                    <ul className="space-y-2">
                      {data.signatories.map((s, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <BadgeCheck className="w-4 h-4 mt-0.5 text-success flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {isAr ? s.nameAr || s.nameEn : s.nameEn}
                            </div>
                            <div className="text-xs text-muted truncate">
                              {isAr ? s.titleAr || s.titleEn : s.titleEn}
                              {s.mark === 'initials' && ` · ${t('initialled', 'بالأحرف الأولى')}`}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          {t(
            'Verification confirms a reference exists on the register. It does not disclose the document.',
            '.يؤكد التحقق وجود الرقم المرجعي في السجل، ولا يكشف محتوى المستند',
          )}
        </p>
      </motion.div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
