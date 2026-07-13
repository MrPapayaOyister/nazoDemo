// ============================================================================
// Token ↔ variable sync — shared by in-page template editing (authoring) and
// per-instance editing (correspondence creation).
//
// The document body carries {{TOKEN}} placeholders; the variable list declares
// them. Editing either side can drift them apart, so this module DETECTS the two
// failure modes the spec calls out — a body token with no backing variable
// (orphan) and a declared variable never inserted in the body (unused) — and
// offers deterministic one-click fixes (insert a field line / strip the token).
// Nothing is ever silently broken.
// ============================================================================
import type { TemplateVariable, VariableType } from '@/types'

/** Body tokens that are STRUCTURAL, not user-managed content variables — they are
 *  resolved by the renderer (letterhead block / footer strip), so they are never
 *  flagged as orphans. */
export const RESERVED_TOKENS = new Set(['LETTERHEAD', 'FOOTER'])

const TOKEN_G = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

/** Distinct {{TOKEN}} names in docHtml, in first-seen order. */
export function docTokens(docHtml: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(TOKEN_G)
  let m: RegExpExecArray | null
  while ((m = re.exec(docHtml)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

export interface VarSync {
  /** token names present in the body but backed by NO variable (excl. reserved). */
  orphanTokens: string[]
  /** variables declared but never referenced in the body (Signatures excluded —
   *  they are workflow-driven and always live in the signature block). */
  unusedVars: TemplateVariable[]
}

export function analyzeVarSync(docHtml: string, variables: TemplateVariable[]): VarSync {
  const varTags = new Set(variables.map((v) => v.tag))
  const orphanTokens = docTokens(docHtml).filter(
    (name) => !RESERVED_TOKENS.has(name) && !varTags.has(`{{${name}}}`),
  )
  const unusedVars = variables.filter(
    (v) => v.type !== 'Signature' && !docHtml.includes(v.tag),
  )
  return { orphanTokens, unusedVars }
}

export function isInSync(docHtml: string, variables: TemplateVariable[]): boolean {
  const { orphanTokens, unusedVars } = analyzeVarSync(docHtml, variables)
  return orphanTokens.length === 0 && unusedVars.length === 0
}

/** Canonical {{UPPER_SNAKE}} tag from free-typed text; '' when empty. */
export function normalizeTag(input: string): string {
  const inner = (input || '')
    .replace(/[{}]/g, '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return inner ? `{{${inner}}}` : ''
}

function escapeText(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A blank content variable seeded from a typed tag (Requester Text by default). */
export function makeVariable(tag: string, type: VariableType = 'Text'): TemplateVariable {
  const label = tag.replace(/[{}]/g, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return { tag, labelEn: label, labelAr: label, type, group: 'Requester', required: true }
}

/** Append a labeled field line carrying `variable.tag`, placed just before the
 *  signature block when present (else at the body end), so a newly-added variable
 *  is VISIBLE in the document instead of silently missing. No-op if already there. */
export function insertTokenField(docHtml: string, variable: TemplateVariable): string {
  if (docHtml.includes(variable.tag)) return docHtml
  const cell = `<p class="meta"><strong>${escapeText(variable.labelEn)}:</strong> ${variable.tag}</p>`
  const signIdx = docHtml.indexOf('<div class="sign-block">')
  if (signIdx !== -1) {
    return `${docHtml.slice(0, signIdx)}${cell}\n${docHtml.slice(signIdx)}`
  }
  return `${docHtml.replace(/\s*$/, '')}\n${cell}\n`
}

/** Remove `tag` from the body: drop a dedicated `<p class="meta">` field line whose
 *  ONLY token is `tag`, else strip inline occurrences (woven into prose). */
export function removeToken(docHtml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A meta <p> whose sole token is `tag` (no other {{...}} inside) → remove entirely.
  const fieldLine = new RegExp(`<p class="meta">[^{}]*${escaped}[^{}]*</p>\\s*`, 'g')
  let out = docHtml.replace(fieldLine, '')
  // Any remaining inline occurrences → strip the token, keep surrounding prose.
  out = out.split(tag).join('')
  return out
}
