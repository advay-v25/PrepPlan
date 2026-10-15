'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Starts (or resumes) an assessment. Explains a refusal instead of failing silently. */
export function StartButton({ body, label, disabled, className }: { body: Record<string, unknown>; label: string; disabled?: boolean; className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function start() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/tests/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const r = await res.json()
      if (r.ok) { router.push(r.url); return }
      setMsg(r.message ?? r.error ?? 'Could not start.')
      if (r.code === 'scope_changed') router.refresh()
    } finally { setBusy(false) }
  }
  return (
    <span className="start-button">
      <button type="button" className={className ?? 'primary-button'} disabled={busy || disabled} onClick={start}>{busy ? 'Starting…' : label}</button>
      {msg && <span role="alert" className="review-error">{msg}</span>}
    </span>
  )
}

/** A baseline check of any reading or subject, opted into explicitly. */
export function BaselineStart({ subjects }: { subjects: { id: string; name: string; readings: { id: string; no: number; title: string }[] }[] }) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '')
  const [readingId, setReadingId] = useState('')
  const readings = subjects.find(s => s.id === subjectId)?.readings ?? []
  return (
    <details className="baseline-start">
      <summary>Take a baseline check instead</summary>
      <p className="muted">A baseline tests the whole reading or subject, whether or not you have completed it. Use it to see where you start.</p>
      <label>Subject <select value={subjectId} onChange={e => { setSubjectId(e.target.value); setReadingId('') }}>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Reading <select value={readingId} onChange={e => setReadingId(e.target.value)}><option value="">Whole subject</option>{readings.map(r => <option key={r.id} value={r.id}>{r.no}. {r.title}</option>)}</select></label>
      <StartButton className="secondary-button" label="Start baseline" disabled={!subjectId}
        body={readingId ? { kind: 'reading', readingId, baseline: true } : { kind: 'subject', subjectId, baseline: true }} />
    </details>
  )
}
