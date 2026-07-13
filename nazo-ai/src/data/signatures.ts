import type { Signature } from '@/types'

// Handwritten-style ink scribbles as inline SVG data-URIs — no external assets.
// The caption (signer name + date) is drawn by <SignatureStamp>, so these hold
// only the ink stroke. Ink colour is a deep navy so it reads on light paper.

const INK = '#17233f'

function sig(paths: string, style: 'cursive' | 'block'): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 90">` +
    `<g fill="none" stroke="${INK}" stroke-width="${style === 'block' ? 3.2 : 2.4}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// K. Al Mansoori — flowing cursive
const DT_PATHS =
  `<path d="M14 60 C 22 20, 30 20, 30 52 C 30 34, 40 26, 52 40 C 44 30, 60 30, 56 54"/>` +
  `<path d="M70 58 C 78 24, 84 30, 82 56 C 90 34, 104 34, 100 58 C 112 40, 126 44, 120 60"/>` +
  `<path d="M132 60 C 150 30, 168 30, 150 54 C 168 40, 188 40, 176 60 C 196 46, 214 50, 208 62"/>` +
  `<path d="M20 70 C 80 64, 150 64, 214 68" stroke-width="1.6" opacity="0.7"/>`

// A. Al Zaabi — looping cursive
const DIR_PATHS =
  `<path d="M16 58 C 24 22, 40 22, 40 54 C 40 38, 30 44, 50 46 C 40 30, 62 26, 58 56"/>` +
  `<path d="M70 56 C 76 30, 92 30, 86 58 C 100 36, 118 40, 108 60 C 124 42, 140 48, 132 60"/>` +
  `<path d="M146 58 C 162 26, 182 34, 168 56 C 186 38, 208 44, 196 62 C 210 52, 220 56, 216 60"/>` +
  `<path d="M22 72 C 90 66, 160 66, 212 70" stroke-width="1.6" opacity="0.7"/>`

// M. Al Hashimi — bolder block hand
const GM_PATHS =
  `<path d="M14 62 L 18 26 L 34 52 L 50 26 L 54 62"/>` +
  `<path d="M70 62 C 78 30, 96 30, 90 58 C 104 36, 124 42, 112 62"/>` +
  `<path d="M128 60 C 146 28, 168 34, 154 58 C 174 40, 198 46, 184 64 C 200 54, 216 58, 210 62"/>` +
  `<path d="M18 74 C 90 68, 160 68, 214 72" stroke-width="1.8" opacity="0.75"/>`

// A second GM signature — an "MH" initials monogram — so the sign-time picker
// (item 1) has more than one option out of the box.
const GM_INITIALS_PATHS =
  `<path d="M26 62 L 32 30 L 48 54 L 64 30 L 70 62"/>` +
  `<path d="M92 30 L 92 62 M 92 46 L 118 46 M 118 30 L 118 62"/>` +
  `<path d="M26 72 C 70 66, 120 66, 150 70" stroke-width="1.6" opacity="0.7"/>`

export const SIGNATURES: Signature[] = [
  { id: 'sig_dt', ownerId: 'u_dt', style: 'cursive', label: 'Formal', dataUri: sig(DT_PATHS, 'cursive') },
  { id: 'sig_dir', ownerId: 'u_dir', style: 'cursive', label: 'Formal', dataUri: sig(DIR_PATHS, 'cursive') },
  { id: 'sig_gm', ownerId: 'u_gm', style: 'block', label: 'Formal', dataUri: sig(GM_PATHS, 'block') },
  { id: 'sig_gm_alt', ownerId: 'u_gm', style: 'cursive', label: 'Initials', dataUri: sig(GM_INITIALS_PATHS, 'cursive') },
]

export const SIGNATURE_BY_ID = Object.fromEntries(
  SIGNATURES.map((s) => [s.id, s]),
) as Record<string, Signature>
