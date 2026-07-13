// Shared "most recently updated first" comparator for every correspondence list
// (Overview activity, Inbox, Tracking, Search, Sent-by-me). updatedAt is bumped by
// the backend on every workflow action (send/approve/reject/revise/redirect) and
// merged client-side, so sorting at the read boundary keeps every list consistent.
//
// Timestamps are zero-padded UTC ISO strings ending in 'Z', so localeCompare on the
// raw strings orders them correctly. Spread first so the store array is never
// mutated in place (mutating zustand state breaks referential equality → render
// loops). `id` is the deterministic tiebreak for same-millisecond rows.

interface Recency {
  id: string
  createdAt: string
  updatedAt?: string
}

/** Return a NEW array sorted most-recently-updated first (updatedAt, then createdAt,
 *  then id desc as a stable tiebreak). Never mutates the input. */
export function sortByUpdatedDesc<T extends Recency>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const bt = b.updatedAt ?? b.createdAt
    const at = a.updatedAt ?? a.createdAt
    return bt.localeCompare(at) || b.id.localeCompare(a.id)
  })
}
