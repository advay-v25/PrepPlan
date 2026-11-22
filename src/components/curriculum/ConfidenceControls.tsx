'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const MARKS = [
  { v: 'not_started', label: 'Not started' }, { v: 'shaky', label: 'Shaky' },
  { v: 'fairly_sure', label: 'Fairly sure' }, { v: 'solid', label: 'Solid' },
] as const
const BANDS = [{ v: 'repair', label: 'Repair' }, { v: 'verify', label: 'Verify' }, { v: 'maintain', label: 'Maintain' }, { v: 'untested', label: 'Untested' }] as const

/** The student's own overall mark. Self-report; the page verifies it against the evidence. */
export function MarkControl({ scopeType, scopeId, current, label }: { scopeType: 'outcome' | 'reading'; scopeId: string; current: string | null; label: string }) {
  const router = useRouter()
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function pick(v: string) {
    setBusy(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/curriculum/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeType, scopeId, level: v }), signal: AbortSignal.timeout(12_000) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) { setError(body?.error ?? 'Could not confirm the save. Try again.'); return }
      setValue(v)
      setSaved(true)
      router.refresh()
    } catch {
      setError('Could not confirm the save. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="mark-control" role="radiogroup" aria-label={`How confident are you in ${label}?`}>
      {MARKS.map(m => (
        <label key={m.v} className={value === m.v ? 'is-on' : ''}>
          <input type="radio" name={`mark-${scopeType}-${scopeId}`} checked={value === m.v} disabled={busy} onChange={() => pick(m.v)} /> {m.label}
        </label>
      ))}
      {error && <span role="alert" className="review-error">{error}</span>}
      <span role="status">{busy ? 'Saving…' : saved ? 'Confidence saved.' : ''}</span>
    </div>
  )
}

/** Manual change of an outcome's status, behind an explicit warning. */
export function OverrideControl({ outcomeId, current }: { outcomeId: string; current: { band: string; reason: string } | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [band, setBand] = useState<string>('maintain')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(payload: object) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/curriculum/overrides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000) })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) { setError(body?.error ?? 'Could not confirm the change. Try again.'); return }
      setOpen(false); setReason(''); setAck(false); router.refresh()
    } catch {
      setError('Could not confirm the change. Try again.')
    } finally { setBusy(false) }
  }

  if (current) {
    return (
      <p className="override-note">
        <strong>Manual change:</strong> shown as {current.band} — “{current.reason}”. The evidence is unchanged.{' '}
        <button type="button" className="text-button" disabled={busy} onClick={() => call({ action: 'revoke', outcomeId })}>Remove the manual change</button>
        {error && <span role="alert" className="review-error">{error}</span>}
      </p>
    )
  }
  return (
    <div className="override-control">
      {!open ? (
        <button type="button" className="text-button" onClick={() => setOpen(true)}>Change this status manually</button>
      ) : (
        <div role="group" aria-label="Manual status change" className="override-form">
          <p role="note"><strong>Warning:</strong> this is a manual change. It is tagged “manual” and logged. The test evidence, your counts and your plan
            still use what the evidence shows.</p>
          <label>Show it as
            <select value={band} onChange={e => setBand(e.target.value)}>{BANDS.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}</select>
          </label>
          <label>Why? <input type="text" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
          <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I understand this is a manual change</label>
          {error && <span role="alert" className="review-error">{error}</span>}
          <span>
            <button type="button" className="secondary-button" disabled={busy || !ack || reason.trim().length < 3} onClick={() => call({ action: 'set', outcomeId, band, reason, acknowledged: true })}>Save manual change</button>
            {' '}<button type="button" className="text-button" onClick={() => setOpen(false)}>Cancel</button>
          </span>
        </div>
      )}
    </div>
  )
}
