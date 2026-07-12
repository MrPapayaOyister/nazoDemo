// ============================================================================
// NAZO AI — tiny fetch wrapper for the profile + signature endpoints.
// Same-origin when the built app is served by the API. Everything else in the
// demo stays scripted; only these two endpoints are wired.
// ============================================================================

const ENV_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

/** API root. e.g. '' + '/api' → '/api' (same-origin), or 'https://host' + '/api'. */
export const API_BASE = `${ENV_BASE}/api`

/** Typed error the Profile page can catch and surface inline. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

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

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string }
    return body.error ?? body.message ?? `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

/** GET /api/users/{id} — throws ApiError on network/HTTP failure. */
export async function getUserProfile(id: string): Promise<UserProfile> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
      headers: { Accept: 'application/json' },
      body: form,
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network error')
  }
  if (!res.ok) throw new ApiError(await readError(res), res.status)
  return (await res.json()) as SaveSignatureResult
}
