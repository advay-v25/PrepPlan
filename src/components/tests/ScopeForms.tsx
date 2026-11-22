'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'


async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

/** Confirm which outcomes a reading-level or partly done block actually covered. */
export function ScopeConfirmForm({ blockId, outcomes, expectedRevision, initialPicked = [] }: { blockId: string; expectedRevision?: number; initialPicked?: string[]; outcomes: { id: string; code: string; title: string }[] }) {
  const router = useRouter()
  const [picked, setPicked] = useState<string[]>(initialPicked)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  async function save() {
    setBusy(true); setMsg(null)
    try {
      const r = await post('/api/tests/scope/confirm', { blockId, outcomeIds: picked, expectedRevision })
      if (r.ok) router.refresh(); else { setMsg(r.error ?? 'Could not save.'); if (r.code === 'REVISION_MISMATCH') router.refresh() }
    } catch { setMsg('Could not confirm the save. Refresh before trying again.') }
    finally { setBusy(false) }
  }
  return (
    <div className="scope-confirm">
      <ul>{outcomes.map(o => (
        <li key={o.id}><label><input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} /><span><strong>{o.code}.</strong> {o.title}</span></label></li>
      ))}</ul>
      {msg && <p role="alert" className="review-error">{msg}</p>}
      <button type="button" className="secondary-button" disabled={busy || (picked.length === 0 && initialPicked.length === 0) || picked.length > 40} onClick={save}>{busy ? 'Saving…' : picked.length === 0 && initialPicked.length > 0 ? 'Clear covered outcomes' : 'Confirm what I covered'}</button>
    </div>
  )
}
