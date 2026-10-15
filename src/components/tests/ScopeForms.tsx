'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string; outcomes: { id: string; code: string; title: string }[] }[] }[]

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

/** Confirm which outcomes a reading-level or partly done block actually covered. */
export function ScopeConfirmForm({ blockId, outcomes }: { blockId: string; outcomes: { id: string; code: string; title: string }[] }) {
  const router = useRouter()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  async function save() {
    setBusy(true); setMsg(null)
    const r = await post('/api/tests/scope/confirm', { blockId, outcomeIds: picked })
    setBusy(false)
    if (r.ok) router.refresh(); else setMsg(r.error ?? 'Could not save.')
  }
  return (
    <div className="scope-confirm">
      <ul>{outcomes.map(o => (
        <li key={o.id}><label><input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} /> <strong>{o.code}.</strong> {o.title}</label></li>
      ))}</ul>
      {msg && <p role="alert" className="review-error">{msg}</p>}
      <button type="button" className="secondary-button" disabled={busy || picked.length === 0} onClick={save}>Confirm what I covered</button>
    </div>
  )
}

/** "I studied this": extra learning recorded as a completed Calendar block. */
export function QuickStudyForm({ catalog }: { catalog: Catalog }) {
  const router = useRouter()
  const [subjectId, setSubjectId] = useState(catalog[0]?.id ?? '')
  const [readingId, setReadingId] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [minutes, setMinutes] = useState(30)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [key] = useState(() => globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? `k${Date.now()}${Math.floor(Math.random() * 1e6)}`)
  const reading = catalog.find(s => s.id === subjectId)?.readings.find(r => r.id === readingId)
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  async function save() {
    setBusy(true); setMsg(null)
    const r = await post('/api/tests/scope/quick-study', { idempotencyKey: key, outcomeIds: picked, minutes })
    setBusy(false)
    if (r.ok) { setPicked([]); router.refresh() } else setMsg(r.error ?? 'Could not record it.')
  }
  return (
    <details className="quick-study">
      <summary>I studied something else this week</summary>
      <div className="class-log">
        <label>Subject <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setReadingId(''); setPicked([]) }}>{catalog.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Reading <select value={readingId} onChange={e => { setReadingId(e.target.value); setPicked([]) }}><option value="">Choose a reading…</option>{catalog.find(s => s.id === subjectId)?.readings.map(r => <option key={r.id} value={r.id}>{r.no}. {r.title}</option>)}</select></label>
        {reading && <ul className="class-log__outcomes">{reading.outcomes.map(o => <li key={o.id}><label><input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} /> <strong>{o.code}.</strong> {o.title}</label></li>)}</ul>}
        <label>About how long? <input type="number" min={5} max={180} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /> minutes</label>
        {msg && <p role="alert" className="review-error">{msg}</p>}
        <button type="button" className="secondary-button" disabled={busy || picked.length === 0} onClick={save}>Add to this week&apos;s completed work</button>
      </div>
    </details>
  )
}
