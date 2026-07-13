// ============================================================================
// NAZO AI — the full API client for the real nazo-api backend.
// Same-origin when the built app is served by the API ('' + '/api'), or a
// VITE_API_BASE host in dev. Every request carries the demo identity header
// 'X-Demo-User': <currentUserId> so the server resolves the right inbox/actor.
// ============================================================================

import type {
  Correspondence,
  ResultCard,
  SideEffect,
  Template,
  User,
} from '@/types'

const ENV_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/** API root. e.g. '' + '/api' → '/api' (same-origin), or 'https://host' + '/api'. */
export const API_BASE = `${ENV_BASE}/api`

// ---------------------------------------------------------------------------
// Live demo identity — the store keeps this in sync (hydrate + switchUser). Read
// live on EVERY request so identity always reflects the current user.
// ---------------------------------------------------------------------------
let currentApiUser = 'u_admin'

/** Point every subsequent request at a demo identity (X-Demo-User header). */
export function setApiUser(id: string): void {
  if (id) currentApiUser = id
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Demo-User': currentApiUser,
    ...(extra ?? {}),
  }
}

/** Typed error the UI can catch and surface inline. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string; detail?: string }
    return body.detail ?? body.error ?? body.message ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

/** Core JSON fetch: attaches identity, parses JSON, throws ApiError on !ok. */
async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers: initHeaders, ...rest } = init ?? {}
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: headers({
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...((initHeaders as Record<string, string>) ?? {}),
      }),
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Bootstrap / reads.
// ---------------------------------------------------------------------------
export interface BootstrapPayload {
  users: User[]
  templates: Template[]
  correspondences: Correspondence[]
}

export function bootstrap(): Promise<BootstrapPayload> {
  return request<BootstrapPayload>('/bootstrap')
}

export function listCorrespondences(box: 'all' | 'inbox' | 'mine' = 'all'): Promise<Correspondence[]> {
  return request<Correspondence[]>(`/correspondences?box=${encodeURIComponent(box)}`)
}

export function getCorrespondence(id: string): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}`)
}

export function getGraph(id: string): Promise<unknown> {
  return request<unknown>(`/correspondences/${encodeURIComponent(id)}/graph`)
}

export function listTemplates(): Promise<Template[]> {
  return request<Template[]>('/templates')
}

// ---------------------------------------------------------------------------
// Correspondence lifecycle. Each mutating call returns the freshly serialized
// correspondence (same camelCase shape as /api/bootstrap).
// ---------------------------------------------------------------------------
export function createCorrespondence(body: {
  templateId: string
  values?: Record<string, string>
}): Promise<Correspondence> {
  return request<Correspondence>('/correspondences', {
    method: 'POST',
    json: { templateId: body.templateId, values: body.values ?? {} },
  })
}

/** PATCH /{id} — persist wizard field values onto a create-first Draft before send. */
export function patchDraft(
  id: string,
  body: { values: Record<string, string> },
): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: { values: body.values },
  })
}

/** POST /{id}/ref — allocate a deterministic reference; returns ref + updated corr. */
export function allocRef(id: string): Promise<{ ref: string; correspondence: Correspondence }> {
  return request<{ ref: string; correspondence: Correspondence }>(
    `/correspondences/${encodeURIComponent(id)}/ref`,
    { method: 'POST' },
  )
}

export function sendCorr(id: string): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}/send`, {
    method: 'POST',
  })
}

export function approveCorr(
  id: string,
  body?: { comment?: string; applySignature?: boolean },
): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    json: {
      comment: body?.comment ?? null,
      applySignature: body?.applySignature ?? true,
    },
  })
}

export function rejectCorr(id: string, body: { comment: string }): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    json: { comment: body.comment },
  })
}

export function reviseCorr(
  id: string,
  body?: { values?: Record<string, string> },
): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}/revise`, {
    method: 'POST',
    json: { values: body?.values ?? null },
  })
}

export function redirectCorr(
  id: string,
  body: { targetUserId: string; comment?: string },
): Promise<Correspondence> {
  return request<Correspondence>(`/correspondences/${encodeURIComponent(id)}/redirect`, {
    method: 'POST',
    json: { targetUserId: body.targetUserId, comment: body.comment ?? null },
  })
}

// ---------------------------------------------------------------------------
// Templates.
// ---------------------------------------------------------------------------
export interface TemplateDraftBody {
  titleEn: string
  titleAr?: string
  lang?: string
  category?: string
  docHtml: string
  variables?: unknown[]
  workflow?: unknown[]
}

export function saveTemplate(body: TemplateDraftBody): Promise<Template> {
  return request<Template>('/templates', {
    method: 'POST',
    json: {
      titleEn: body.titleEn,
      titleAr: body.titleAr ?? '',
      lang: body.lang ?? 'en',
      category: body.category ?? 'Approval',
      docHtml: body.docHtml,
      variables: body.variables ?? [],
      workflow: body.workflow ?? [],
    },
  })
}

// ---------------------------------------------------------------------------
// Demo reset.
// ---------------------------------------------------------------------------
export function resetDemo(): Promise<{ ok: boolean; error?: string }> {
  return request<{ ok: boolean; error?: string }>('/admin/reset', { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Document downloads. Fetch as a blob (so the identity header is sent), then
// trigger a browser download via an object URL.
// ---------------------------------------------------------------------------
async function download(path: string, fallbackName: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: headers() })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const name = match?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadPdf(id: string): Promise<void> {
  return download(`/correspondences/${encodeURIComponent(id)}/pdf`, `${id}.pdf`)
}

export function downloadDocx(id: string): Promise<void> {
  return download(`/correspondences/${encodeURIComponent(id)}/docx`, `${id}.docx`)
}

// ---------------------------------------------------------------------------
// AI actions — POST /api/ai/{actionId} returning a text/event-stream. We
// hand-roll SSE parsing off the response body reader and dispatch the 5-event
// contract (stage_started · stage_note · result · error · done) to callbacks.
// Returns an AbortController so the caller can cancel on unmount / supersede.
// ---------------------------------------------------------------------------
export interface AiContextBody {
  role?: string
  currentUserId?: string
  corrId?: string
  docId?: string
  targetId?: string
  workflowId?: string
  stage?: number
  prompt?: string
  values?: Record<string, string>
}

export interface AiResultPayload {
  card: ResultCard
  effects: SideEffect[]
}

export interface AiRunHandlers {
  onStage?: (en: string, ar: string) => void
  onNote?: (en: string, ar: string) => void
  onResult?: (payload: AiResultPayload) => void
  onError?: (err: { messageEn: string; messageAr: string; recoverable: boolean }) => void
  onDone?: (jobId?: string) => void
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine
    if (line.startsWith(':')) continue // comment / keep-alive
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}

export function runAiAction(
  actionId: string,
  ctx: AiContextBody,
  handlers: AiRunHandlers,
): AbortController {
  const controller = new AbortController()

  const safe = <A extends unknown[]>(fn: ((...args: A) => void) | undefined, ...args: A) => {
    try {
      fn?.(...args)
    } catch {
      /* callback failures must never break the stream loop */
    }
  }

  ;(async () => {
    let doneCalled = false
    const finish = (jobId?: string) => {
      if (doneCalled) return
      doneCalled = true
      safe(handlers.onDone, jobId)
    }
    let res: Response
    try {
      res = await fetch(`${API_BASE}/ai/${encodeURIComponent(actionId)}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
        body: JSON.stringify(ctx),
        signal: controller.signal,
      })
    } catch (e) {
      if (controller.signal.aborted) return finish()
      safe(handlers.onError, {
        messageEn: e instanceof Error ? e.message : 'Network error',
        messageAr: 'حدث خطأ في الاتصال.',
        recoverable: true,
      })
      return finish()
    }

    if (!res.ok || !res.body) {
      const msg = await readError(res)
      safe(handlers.onError, { messageEn: msg, messageAr: 'واجه المساعد مشكلة.', recoverable: true })
      return finish()
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let jobId: string | undefined

    const dispatch = (event: string, data: string) => {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(data) as Record<string, unknown>
      } catch {
        return
      }
      switch (event) {
        case 'stage_started':
          safe(handlers.onStage, String(parsed.label_en ?? ''), String(parsed.label_ar ?? ''))
          break
        case 'stage_note':
          safe(handlers.onNote, String(parsed.note_en ?? ''), String(parsed.note_ar ?? ''))
          break
        case 'result':
          safe(handlers.onResult, {
            card: parsed.card as ResultCard,
            effects: (parsed.effects as SideEffect[]) ?? [],
          })
          break
        case 'error':
          safe(handlers.onError, {
            messageEn: String(parsed.message_en ?? 'The assistant hit a snag.'),
            messageAr: String(parsed.message_ar ?? 'واجه المساعد مشكلة.'),
            recoverable: parsed.recoverable !== false,
          })
          break
        case 'done':
          jobId = parsed.jobId ? String(parsed.jobId) : undefined
          break
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Frames are separated by a blank line.
        let sep: number
        while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + (buffer[sep] === '\r' ? 4 : 2))
          const frame = parseSseBlock(block)
          if (frame) dispatch(frame.event, frame.data)
        }
      }
      // Flush any trailing frame without a blank-line terminator.
      const tail = parseSseBlock(buffer)
      if (tail) dispatch(tail.event, tail.data)
    } catch (e) {
      if (!controller.signal.aborted) {
        safe(handlers.onError, {
          messageEn: e instanceof Error ? e.message : 'Stream error',
          messageAr: 'انقطع الاتصال بالمساعد.',
          recoverable: true,
        })
      }
    } finally {
      finish(jobId)
    }
  })()

  return controller
}

// ===========================================================================
// Profile + signature endpoints (unchanged surface, now identity-aware).
// ===========================================================================

/** Backend user profile shape (camelCase) + resolved signature fields. */
export interface UserProfile {
  id: string
  role?: string
  nameEn?: string
  nameAr?: string
  titleEn?: string
  titleAr?: string
  unitEn?: string
  unitAr?: string
  email?: string
  signatureId?: string
  hasCustomSignature?: boolean
  /** canonical PNG data-URI of the current signature, when one exists. */
  signatureDataUri?: string | null
}

/** POST /signature response — canonical stored signature. */
export interface SaveSignatureResult {
  signatureId: string
  /** canonical PNG data-URI as stored by the server. */
  dataUri: string
}

/** GET /api/users/{id} — throws ApiError on network/HTTP failure. */
export async function getUserProfile(id: string): Promise<UserProfile> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}`, {
      headers: headers(),
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return (await res.json()) as UserProfile
}

/** POST /api/users/{id}/signature as JSON { dataUri, style? }. */
export async function saveSignatureDataUri(
  id: string,
  dataUri: string,
  style?: 'cursive' | 'block',
): Promise<SaveSignatureResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}/signature`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(style ? { dataUri, style } : { dataUri }),
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return (await res.json()) as SaveSignatureResult
}

/** POST /api/users/{id}/signature as multipart with field 'file'. */
export async function saveSignatureFile(
  id: string,
  file: File,
): Promise<SaveSignatureResult> {
  const form = new FormData()
  form.append('file', file)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}/signature`, {
      method: 'POST',
      headers: headers(),
      body: form,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return (await res.json()) as SaveSignatureResult
}
