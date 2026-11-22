'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Prefs = { assessmentReminders: boolean; weeklyReviewReminders: boolean; quietStart: string; quietEnd: string }
type Delivery = 'configured' | 'not_configured'
type Phase = { kind: 'loading' } | { kind: 'load_error'; message: string } | { kind: 'ready' }
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; sync: 'ok' | 'pending' } | { kind: 'error'; message: string }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Opt-in reminders, off by default. Edits stay local until the student presses Save; only the CHANGED fields are sent (an atomic patch), one save at a time,
 * so rapid edits cannot arrive out of order and another device's change to a different field is never overwritten. Equal quiet-hours start and end mean no quiet period.
 */
export function ReminderPrefs() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [saved, setSaved] = useState<Prefs | null>(null), [draft, setDraft] = useState<Prefs | null>(null)
  const [delivery, setDelivery] = useState<Delivery>('not_configured')
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' })
    try {
      const res = await fetch('/api/reminders/prefs'); const r = await res.json().catch(() => null)
      if (!res.ok || !r?.ok) { setPhase({ kind: 'load_error', message: r?.error ?? 'Your reminder choices could not be loaded.' }); return }
      setSaved(r.prefs); setDraft(r.prefs); setDelivery(r.delivery); setPhase({ kind: 'ready' })
    } catch { setPhase({ kind: 'load_error', message: 'Could not reach PrepPlan. Your choices are unchanged.' }) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (phase.kind === 'loading') return <p className="fine-print" role="status">Loading your reminder choices…</p>
  if (phase.kind === 'load_error' || !saved || !draft) return <p role="alert" className="fine-print">{phase.kind === 'load_error' ? phase.message : 'Not loaded.'} <button type="button" className="text-button" onClick={load}>Try again</button></p>

  const timesValid = HHMM.test(draft.quietStart) && HHMM.test(draft.quietEnd)
  const patch = Object.fromEntries((Object.keys(draft) as (keyof Prefs)[]).filter(k => draft[k] !== saved[k]).map(k => [k, draft[k]]))
  const dirty = Object.keys(patch).length > 0
  async function save() {
    if (inFlight.current || !dirty || !timesValid) return
    inFlight.current = true; setState({ kind: 'saving' })
    try {
      const res = await fetch('/api/reminders/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const r = await res.json().catch(() => null)
      if (res.ok && r?.ok && r.prefs === null) { setDelivery(r.delivery); await load(); setState({ kind: 'saved', sync: 'pending' }) }   // committed, response unconfirmed: reload the real values
      else if (res.ok && r?.ok) { setSaved(r.prefs); setDraft(r.prefs); setDelivery(r.delivery); setState({ kind: 'saved', sync: r.sync }) }
      else setState({ kind: 'error', message: r?.error ?? 'Not saved. Your edits are kept here; try again.' })
    } catch { setState({ kind: 'error', message: 'Could not confirm the save. Your edits are kept here. Saving again is safe: it sets the same values.' }) }
    finally { inFlight.current = false }
  }
  const set = (p: Partial<Prefs>) => { setDraft({ ...draft, ...p }); setState({ kind: 'idle' }) }

  return (
    <div data-reminder-prefs>
      {delivery === 'not_configured' && <p className="fine-print" role="status" data-delivery="not_configured">Reminder email is not switched on for PrepPlan yet. You can save your choices now; nothing is sent until it is.</p>}
      <div><label className="ob-check"><input type="checkbox" checked={draft.assessmentReminders} onChange={e => set({ assessmentReminders: e.target.checked })} /> <span>Email me the evening before a mock or rehearsal</span></label></div>
      <div><label className="ob-check"><input type="checkbox" checked={draft.weeklyReviewReminders} onChange={e => set({ weeklyReviewReminders: e.target.checked })} /> <span>Email me when my weekly review is ready</span></label></div>
      <div className="quiet-hours-wrap">
        <span className="fine-print">Quiet hours (no email is sent then; it waits until they end):</span>
        <div className="quiet-hours-inputs">
          <input aria-label="Quiet hours start" type="time" value={draft.quietStart} onChange={e => set({ quietStart: e.target.value })} />
          <span className="quiet-hours-sep">to</span>
          <input aria-label="Quiet hours end" type="time" value={draft.quietEnd} onChange={e => set({ quietEnd: e.target.value })} />
        </div>
      </div>
      <p className="fine-print">Equal times mean no quiet period. Reminders stop once you tell us you sat the exam.</p>
      {!timesValid && <p role="alert" className="fine-print">Enter both quiet-hour times as hours and minutes.</p>}
      <p><button type="button" className="secondary-button" disabled={!dirty || !timesValid || state.kind === 'saving'} onClick={save}>{state.kind === 'saving' ? 'Saving…' : 'Save reminder choices'}</button></p>
      {state.kind === 'saved' && <p className="fine-print" role="status">{state.sync === 'ok' ? 'Saved.' : 'Saved. Updating your scheduled reminders will be retried; your choice is kept.'}</p>}
      {state.kind === 'error' && <p className="fine-print" role="alert">{state.message}</p>}
    </div>
  )
}
