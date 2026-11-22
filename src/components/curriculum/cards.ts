/** Client helpers shared by the card components. Every write names its request, so an exact retry applies once and a different request is refused. */
export type Card = { id: string; scope_type?: string; scope_id?: string; front: string; back: string; due_at: string; reps: number; revision: number; source?: string }
export type Rating = 'again' | 'hard' | 'good' | 'easy'

export type CardReply = { ok: boolean; code?: string; error?: string; card?: Card; deleted?: boolean; replay?: boolean; requestId?: string; [k: string]: unknown }

export async function cardCall(body: object): Promise<CardReply> {
  try {
    const res = await fetch('/api/curriculum/flashcards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (json && typeof json.ok === 'boolean') return json
    return { ok: false, code: 'unavailable', error: 'The server sent an unexpected reply. Nothing was confirmed; try the same action again.' }
  } catch { return { ok: false, code: 'network', error: 'Could not reach the server. Nothing was confirmed; the same action is safe to repeat.' } }
}

/** One stable request key per distinct request: a retry of the SAME request reuses it (exactly-once), a changed request gets a new one. */
export function keyring() {
  const keys = new Map<string, string>()
  return {
    keyFor: (signature: string) => { let k = keys.get(signature); if (!k) { k = crypto.randomUUID(); keys.set(signature, k) } return k },
    done: (signature: string) => { keys.delete(signature) },
  }
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const when = (iso: string, now = Date.now()) => new Date(iso).getTime() - now < 20 * 3600_000 ? `at ${timeOf(iso)}` : `on ${dayOf(iso)}`
