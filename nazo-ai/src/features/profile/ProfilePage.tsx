import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  UserRound,
  PenLine,
  UploadCloud,
  Check,
  Palette,
  Languages,
  Mail,
  Building2,
  AlertCircle,
  Loader2,
  CloudOff,
} from 'lucide-react'
import { PageTransition } from '@/components/common/PageTransition'
import { PageHeader } from '@/components/common/PageHeader'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/ui/Button'
import { ThemeToggle } from '@/app/ThemeToggle'
import { LangToggle } from '@/app/LangToggle'
import { SignaturePad, type SignaturePadHandle } from '@/features/profile/SignaturePad'
import { UploadSignature } from '@/features/profile/UploadSignature'
import {
  useStore,
  useCurrentUser,
  useSignatureUri,
  effectiveSignatureId,
} from '@/store'
import { useLocalized } from '@/i18n'
import {
  ApiError,
  getUserProfile,
  saveSignatureDataUri,
  saveSignatureFile,
} from '@/api/client'
import { riseItem } from '@/lib/motion'
import type { RoleId } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'

const ROLE_LABEL: Record<RoleId, { en: string; ar: string }> = {
  admin: { en: 'Administrator', ar: 'مشرف النظام' },
  requester: { en: 'Requester', ar: 'مُقدّم طلب' },
  dtManager: { en: 'Approver · Digital Transformation', ar: 'معتمِد · التحول الرقمي' },
  director: { en: 'Approver · Digitalization', ar: 'معتمِد · الرقمنة' },
  gm: { en: 'Approver · General Manager', ar: 'معتمِد · المدير العام' },
  chair: { en: 'Chairperson', ar: 'الرئيس' },
}

type Mode = 'draw' | 'upload'
type Status =
  | { kind: 'success'; msg: string }
  | { kind: 'error'; msg: string }
  | { kind: 'offline'; msg: string }
  | null

export function ProfilePage() {
  const tr = useLocalized()
  const user = useCurrentUser()
  const setActiveUserSignature = useStore((s) => s.setActiveUserSignature)

  // current signature: server value (if the API is live) wins, else custom/seeded.
  const localSig = useSignatureUri(effectiveSignatureId(user))
  const [serverSig, setServerSig] = useState<string | null>(null)
  const currentSig = serverSig ?? localSig ?? null

  const [mode, setMode] = useState<Mode>('draw')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const [uploadKey, setUploadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const padRef = useRef<SignaturePadHandle>(null)

  const pending = mode === 'draw' ? drawn : uploadPreview
  const canSave = !!pending && !saving

  // Pull the canonical signature from the API when available; stay silent on
  // failure so the fully-scripted (offline) demo keeps working.
  useEffect(() => {
    let cancelled = false
    getUserProfile(user.id)
      .then((p) => {
        if (!cancelled && p.signatureDataUri) setServerSig(p.signatureDataUri)
      })
      .catch(() => {
        /* offline demo — fall back to seeded / custom signature */
      })
    return () => {
      cancelled = true
    }
  }, [user.id])

  // reset the pending edit whenever the active identity changes
  useEffect(() => {
    setServerSig(null)
    setDrawn(null)
    setUploadFile(null)
    setUploadPreview(null)
    setStatus(null)
    padRef.current?.clear()
  }, [user.id])

  const pickMode = (m: Mode) => {
    if (m === mode) return
    setMode(m)
    setStatus(null)
    // start each mode clean — the opposite editor remounts empty, so a stale
    // pending value would drive the Preview / enable Save with an invisible sig.
    resetPending()
  }

  const resetPending = () => {
    setDrawn(null)
    setUploadFile(null)
    setUploadPreview(null)
    setUploadKey((k) => k + 1)
    padRef.current?.clear()
  }

  const onSave = async () => {
    if (!pending) return
    setSaving(true)
    setStatus(null)
    try {
      const res =
        mode === 'draw'
          ? await saveSignatureDataUri(user.id, drawn!)
          : await saveSignatureFile(user.id, uploadFile!)
      const uri = res.dataUri || pending
      setActiveUserSignature(uri)
      setServerSig(uri)
      resetPending()
      setStatus({ kind: 'success', msg: tr('Signature saved.', 'تم حفظ التوقيع.') })
      toast(tr('Signature updated', 'تم تحديث التوقيع'))
    } catch (e) {
      // Treat "no signature API here" as an offline demo: network failure
      // (status 0) OR a 404/405 (the endpoint isn't mounted — Vite's SPA
      // fallback only rewrites GET/HEAD, so a POST returns 404/405). Apply the
      // signature locally so the scripted app still stamps it.
      if (
        e instanceof ApiError &&
        (e.status === 0 || e.status === 404 || e.status === 405)
      ) {
        setActiveUserSignature(pending)
        setServerSig(pending)
        resetPending()
        setStatus({
          kind: 'offline',
          msg: tr('Saved on this device — server unavailable.', 'تم الحفظ على هذا الجهاز — الخادم غير متاح.'),
        })
        toast(tr('Signature saved locally', 'تم حفظ التوقيع محليًا'))
      } else {
        setStatus({
          kind: 'error',
          msg: e instanceof Error ? e.message : tr('Could not save signature.', 'تعذّر حفظ التوقيع.'),
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageTransition>
      <PageHeader
        title={tr('My Profile', 'ملفّي الشخصي')}
        subtitle={tr('Your identity, preferences and signature.', 'هويتك وتفضيلاتك وتوقيعك.')}
        icon={<UserRound className="size-5" />}
      />

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-5">
        {/* -------- left column: identity + preferences -------- */}
        <div className="space-y-5">
          {/* identity */}
          <motion.section
            variants={riseItem}
            className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden"
          >
            <div className="h-16 bg-gradient-to-r from-navy to-brand" />
            <div className="px-5 pb-5">
              <div className="-mt-8 flex items-end gap-3">
                <Avatar initials={user.initials} color={user.color} size={64} ring />
                <span
                  className={cn(
                    'mb-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold',
                    user.role === 'admin'
                      ? 'bg-brand-subtle text-brand'
                      : user.role === 'requester'
                        ? 'bg-accent-subtle text-accent'
                        : user.role === 'chair'
                          ? 'bg-subtle text-ink-muted'
                          : 'bg-ai/12 text-ai',
                  )}
                >
                  {tr(ROLE_LABEL[user.role].en, ROLE_LABEL[user.role].ar)}
                </span>
              </div>

              <div className="mt-3">
                <div className="text-lg font-bold text-ink leading-tight" dir="ltr">
                  {user.nameEn}
                </div>
                <div className="text-[13px] text-ink-secondary" dir="rtl">
                  {user.nameAr}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-muted">
                  {tr(user.titleEn, user.titleAr)}
                </div>
              </div>

              <div className="mt-4 space-y-2.5 text-[12.5px]">
                <div className="flex items-center gap-2.5 text-ink-secondary">
                  <Mail className="size-4 text-ink-muted shrink-0" />
                  <span className="truncate">{user.email}</span>
                </div>
                <div className="flex items-center gap-2.5 text-ink-secondary">
                  <Building2 className="size-4 text-ink-muted shrink-0" />
                  <span className="truncate">{tr(user.unitEn, user.unitAr)}</span>
                </div>
              </div>
            </div>
          </motion.section>

          {/* preferences */}
          <motion.section
            variants={riseItem}
            className="rounded-2xl hairline bg-surface shadow-e1 p-5"
          >
            <div className="text-[13px] font-semibold text-ink mb-3">
              {tr('Preferences', 'التفضيلات')}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl hairline bg-app px-3.5 py-2.5">
                <span className="inline-flex items-center gap-2.5 text-[12.5px] font-medium text-ink-secondary">
                  <Palette className="size-4 text-ink-muted" />
                  {tr('Theme', 'المظهر')}
                </span>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between rounded-xl hairline bg-app px-3.5 py-2.5">
                <span className="inline-flex items-center gap-2.5 text-[12.5px] font-medium text-ink-secondary">
                  <Languages className="size-4 text-ink-muted" />
                  {tr('Language', 'اللغة')}
                </span>
                <LangToggle />
              </div>
            </div>
          </motion.section>
        </div>

        {/* -------- right column: signature -------- */}
        <motion.section
          variants={riseItem}
          className="rounded-2xl hairline bg-surface shadow-e1 overflow-hidden self-start"
        >
          <div className="px-5 py-4 border-b border-line flex items-center gap-2">
            <PenLine className="size-4 text-brand" />
            <span className="text-[13px] font-semibold text-ink">
              {tr('Signature', 'التوقيع')}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* current signature */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                {tr('Current', 'الحالي')}
              </div>
              <div className="grid place-items-center rounded-xl bg-white hairline h-[92px]">
                {currentSig ? (
                  <img
                    src={currentSig}
                    alt={tr('Current signature', 'التوقيع الحالي')}
                    className="max-h-16 max-w-[75%] object-contain"
                  />
                ) : (
                  <span className="text-[12px] text-[#9aa8c2]">
                    {tr('No signature on file yet', 'لا يوجد توقيع محفوظ بعد')}
                  </span>
                )}
              </div>
            </div>

            {/* segmented control */}
            <div className="inline-flex w-full rounded-xl bg-subtle p-0.5 text-[12.5px] font-semibold">
              {(
                [
                  { value: 'draw' as const, label: tr('Draw', 'رسم'), Icon: PenLine },
                  { value: 'upload' as const, label: tr('Upload', 'رفع'), Icon: UploadCloud },
                ]
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pickMode(o.value)}
                  className={cn(
                    'flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition-colors',
                    mode === o.value
                      ? 'bg-surface text-brand shadow-e1'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  <o.Icon className="size-3.5" />
                  {o.label}
                </button>
              ))}
            </div>

            {/* editor */}
            {mode === 'draw' ? (
              <SignaturePad
                ref={padRef}
                width={460}
                height={180}
                onChange={setDrawn}
                className="w-full"
              />
            ) : (
              <UploadSignature
                key={uploadKey}
                onChange={(file, url) => {
                  setUploadFile(file)
                  setUploadPreview(url)
                }}
              />
            )}

            {/* live preview of the pending signature */}
            {pending && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                  {tr('Preview', 'معاينة')}
                </div>
                <div className="grid place-items-center rounded-xl bg-white hairline h-[84px]">
                  <img
                    src={pending}
                    alt={tr('Signature preview', 'معاينة التوقيع')}
                    className="max-h-14 max-w-[75%] object-contain"
                  />
                </div>
              </div>
            )}

            {/* status */}
            {status && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-medium',
                  status.kind === 'success' && 'bg-success-subtle text-success',
                  status.kind === 'error' && 'bg-danger-subtle text-danger',
                  status.kind === 'offline' && 'bg-warning-subtle text-warning',
                )}
              >
                {status.kind === 'success' && <Check className="size-4 shrink-0" />}
                {status.kind === 'error' && <AlertCircle className="size-4 shrink-0" />}
                {status.kind === 'offline' && <CloudOff className="size-4 shrink-0" />}
                <span>{status.msg}</span>
              </div>
            )}

            {/* actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button variant="primary" onClick={onSave} disabled={!canSave} className="flex-1">
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {tr('Save signature', 'حفظ التوقيع')}
              </Button>
              <Button
                variant="secondary"
                onClick={resetPending}
                disabled={!pending || saving}
              >
                {tr('Clear', 'مسح')}
              </Button>
            </div>
          </div>
        </motion.section>
      </div>
    </PageTransition>
  )
}
