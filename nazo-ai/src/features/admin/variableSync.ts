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

/** Regex SOURCE matching a tag tolerant of interior whitespace: `{{ TAG }}`. Keeps
 *  the "used?" check and token stripping in step with the whitespace-tolerant
 *  scanner (TOKEN_G), so a hand-typed `{{ VENDOR }}` isn't mis-flagged as unused. */
function tagPatternSrc(tag: string): string {
  const inner = tag.replace(/[{}]/g, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `\\{\\{\\s*${inner}\\s*\\}\\}`
}

export function analyzeVarSync(docHtml: string, variables: TemplateVariable[]): VarSync {
  const varTags = new Set(variables.map((v) => v.tag))
  const orphanTokens = docTokens(docHtml).filter(
    (name) => !RESERVED_TOKENS.has(name) && !varTags.has(`{{${name}}}`),
  )
  const unusedVars = variables.filter(
    (v) => v.type !== 'Signature' && !new RegExp(tagPatternSrc(v.tag)).test(docHtml),
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

/** Remove `tag` from the body. Walks each `<p class="meta">` line bounded so a match
 *  can NEVER cross `</p>` into a neighbor: a meta line whose ONLY token is `tag` is
 *  dropped; a meta line with OTHER tokens keeps the line and strips only `tag`; any
 *  remaining inline occurrence (woven into prose) is stripped. Whitespace-tolerant. */
export function removeToken(docHtml: string, tag: string): string {
  const tok = tagPatternSrc(tag)
  const anyToken = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/
  // Tempered lookahead: match a single <p class="meta">…</p> that never spans </p>.
  const metaLine = /<p class="meta">(?:(?!<\/p>)[\s\S])*?<\/p>\s*/g
  let out = docHtml.replace(metaLine, (m) => {
    if (!new RegExp(tok).test(m)) return m // this meta line isn't ours
    const rest = m.replace(new RegExp(tok, 'g'), '')
    return anyToken.test(rest) ? rest : '' // other tokens remain → keep line; else drop
  })
  // Strip any remaining inline occurrences (in prose, not a dedicated field line).
  out = out.replace(new RegExp(tok, 'g'), '')
  return out
}

// ============================================================================
// Inline editor (item C.4) helpers. The rich editor edits ONLY the document BODY;
// the structural parts — the leading {{LETTERHEAD}}, the optional RTL wrapper, and
// the trailing signature block — are split off and PRESERVED VERBATIM so the editor
// (which normalizes HTML) can never mangle them. This keeps the docHtml the backend
// PDF/DOCX pipeline consumes byte-safe.
// ============================================================================
export interface DocSplit {
  /** Verbatim head (RTL wrapper open + {{LETTERHEAD}}), re-emitted unchanged. */
  prefixRaw: string
  /** The editable middle (subject, meta line, prose) — with {{TOKEN}} placeholders. */
  body: string
  /** Verbatim tail (signature block + RTL wrapper close), re-emitted unchanged. */
  suffixRaw: string
}

const RTL_WRAP_RE = /^\s*(<div dir="rtl"[^>]*>)([\s\S]*)(<\/div>)\s*$/
const LEAD_LETTERHEAD_RE = /^\s*\{\{\s*LETTERHEAD\s*\}\}\s*/
const TRAIL_SIGNBLOCK_RE = /\s*<div class="sign-block">[\s\S]*?<\/div>\s*$/

export function splitDocForEditor(docHtml: string): DocSplit {
  let s = docHtml || ''
  let wrapOpen = ''
  let wrapClose = ''
  const rtl = s.match(RTL_WRAP_RE)
  if (rtl) {
    wrapOpen = rtl[1]
    s = rtl[2]
    wrapClose = rtl[3]
  }
  let prefix = ''
  const lh = s.match(LEAD_LETTERHEAD_RE)
  if (lh) {
    prefix = '{{LETTERHEAD}}'
    s = s.slice(lh[0].length)
  }
  let suffix = ''
  const sb = s.match(TRAIL_SIGNBLOCK_RE)
  if (sb && sb.index !== undefined) {
    suffix = sb[0].trim()
    s = s.slice(0, sb.index)
  }
  // A stray {{FOOTER}} in the body renders as a component, not text — drop it.
  s = s.replace(/\{\{\s*FOOTER\s*\}\}/g, '')
  const prefixRaw = [wrapOpen, prefix].filter(Boolean).join('\n')
  const suffixRaw = [suffix, wrapClose].filter(Boolean).join('\n')
  return { prefixRaw, body: s.trim(), suffixRaw }
}

export function joinDocFromEditor(split: DocSplit, bodyHtml: string): string {
  const parts = [split.prefixRaw, (bodyHtml || '').trim(), split.suffixRaw].filter(Boolean)
  return '\n' + parts.join('\n') + '\n'
}

/** Convert body `{{TOKEN}}` placeholders into `<span data-token>` nodes the editor's
 *  token node parses (reserved tokens are dropped — they're not editable chips). */
export function bodyTokensToSpans(body: string): string {
  return (body || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, name: string) =>
    RESERVED_TOKENS.has(name) ? '' : `<span data-token="${name}"></span>`,
  )
}

/** Reverse: the editor's serialized `<span data-token="NAME">` back to `{{NAME}}`. */
export function spansToBodyTokens(html: string): string {
  return (html || '').replace(
    /<span[^>]*data-token="([A-Za-z0-9_]+)"[^>]*>\s*<\/span>/g,
    (_m, name: string) => `{{${name}}}`,
  )
}

/** Rebuild the variable list from the editor's body tokens: keep every Signature
 *  variable (they live in the preserved sign-block, not the editor) and any existing
 *  variable still referenced; add a default for a newly-typed token. */
export function reconcileVariables(
  existing: TemplateVariable[],
  bodyTokenNames: string[],
): TemplateVariable[] {
  const bodyTags = new Set(bodyTokenNames.map((n) => `{{${n}}}`))
  const kept = existing.filter((v) => v.type === 'Signature' || bodyTags.has(v.tag))
  const keptTags = new Set(kept.map((v) => v.tag))
  for (const n of bodyTokenNames) {
    if (RESERVED_TOKENS.has(n)) continue
    const tag = `{{${n}}}`
    if (!keptTags.has(tag)) {
      kept.push(makeVariable(tag))
      keptTags.add(tag)
    }
  }
  return kept
}
