'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, Loader2 } from 'lucide-react'

/**
 * There is nothing to plan towards without an exam date.
 *
 * CFA Level I runs in four windows a year. A student can choose one before
 * registering, and before CFA Institute has published exact dates — being
 * undecided is not a reason to be denied a plan.
 */
export function ExamTargetPicker({
  windows, currentWindowId,
}: {
  windows: { id: string; year: number; sitting: string; opens: string | null; confirmed: boolean }[]
  currentWindowId: string | null
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(currentWindowId)
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!selected) { setError('Choose a sitting first'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examWindowId: selected, registered, activate: true }),
      })
      const data = await res.json()
      if (data.ok) router.refresh()
      else { setError(data.error || 'Could not build a roadmap'); setBusy(false) }
    } catch {
      setError('Network error'); setBusy(false)
    }
  }

  const byYear = new Map<number, typeof windows>()
  for (const w of windows) {
    if (!byYear.has(w.year)) byYear.set(w.year, [])
    byYear.get(w.year)!.push(w)
  }

  return (
    <div className="target-picker">
      <div className="target-picker__intro">
        <CalendarCheck size={30} aria-hidden />
        <h2>Which exam are you sitting?</h2>
        <p>
          CFA Level I runs four times a year. Everything else follows from this: how long the first pass
          gets, when revision starts, and which eight weeks are reserved for mocks.
        </p>
      </div>

      {[...byYear.entries()].map(([year, group]) => (
        <section key={year} className="target-picker__year">
          <h3>{year}</h3>
          <div className="target-grid">
            {group.map(w => (
              <button
                key={w.id}
                className={`target-option ${selected === w.id ? 'is-selected' : ''}`}
                onClick={() => setSelected(w.id)}
                aria-pressed={selected === w.id}
              >
                <strong>{w.sitting.replace(/^./, c => c.toUpperCase())}</strong>
                <small>{w.opens ? new Date(`${w.opens}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'Dates to be confirmed'}</small>
                {!w.confirmed && <em>indicative</em>}
              </button>
            ))}
          </div>
        </section>
      ))}

      <label className="checkbox-row">
        <input type="checkbox" checked={registered} onChange={e => setRegistered(e.target.checked)} />
        <span>I have already registered. (If not, that is fine — the plan does not wait for it.)</span>
      </label>

      {error && <p className="auth-error">{error}</p>}

      <button className="primary-button" onClick={submit} disabled={busy || !selected}>
        {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Building your roadmap…</> : 'Build my roadmap'}
      </button>
      <p className="fine-print">
        Exact dates are indicative until CFA Institute publishes them. Roadmap updates them when they are
        confirmed; your plan shifts with them rather than being rebuilt.
      </p>
    </div>
  )
}
