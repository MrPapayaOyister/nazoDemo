// Deterministic id + reference generators. No Math.random anywhere (master §1
// rule 2) — a monotonic counter keeps every take identical.

let counter = 1000

/** Monotonic id, e.g. genId('corr') -> 'corr_1001'. Used for user-created
 *  entities and dragged canvas nodes only; seed ids are stable literals. */
export function genId(prefix: string): string {
  counter += 1
  return `${prefix}_${counter}`
}

// Reference numbers: EHCD/REQ/2026/### (master §3.1 rule 7). The counter is
// positioned so the FIRST live-created correspondence gets 031 — matching the
// scripted requester.genRef result (DEMO_REF).
let refCounter = 30

export function genRef(): string {
  refCounter += 1
  return `EHCD/REQ/2026/${String(refCounter).padStart(3, '0')}`
}

/** Reset both counters to their seed positions (used by resetDemo). */
export function resetIdCounters(): void {
  counter = 1000
  refCounter = 30
}

/** Peek the next reference without consuming it. */
export function peekNextRef(): string {
  return `EHCD/REQ/2026/${String(refCounter + 1).padStart(3, '0')}`
}
