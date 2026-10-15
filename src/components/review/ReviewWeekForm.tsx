'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DueTask, Resolution } from '../../lib/planning/weeklyReview/service'

const CHOICES: { value: Resolution; label: string }[] = [
  { value: 'completed', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'unknown', label: "Don't know" },
]

export function ReviewWeekForm(props: {
  cycleId: string
  fingerprint: string
  dueTasks: DueTask[]
  canClose: boolean
  needsNoPaperAck: boolean
  noPaperReason: string | null
}) {
  const router = useRouter()
  const [choices, setChoices] = useState<Record<string, Resolution>>({})
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const unanswered = props.dueTasks.filter(t => !choices[t.id]).length
  const ready = props.canClose && unanswered === 0 && (!props.needsNoPaperAck || ack)

  async function confirm() {
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/weekly-review/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cycleId: props.cycleId, resolutions: choices, previewFingerprint: props.fingerprint,
          acknowledgeNoPaper: props.needsNoPaperAck && ack,
        }),
      })
      const body = await res.json()
      if (body.ok) { router.push(body.nextUrl ?? '/app/calendar'); router.refresh(); return }
      setMessage(body.message ?? body.error ?? 'Could not close the week.')
      if (body.code === 'preview_changed') router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <div className="review-form">
      {props.dueTasks.length > 0 && (
        <fieldset className="review-tasks">
          <legend>What happened to these tasks?</legend>
          {props.dueTasks.map(t => (
            <div key={t.id} className="review-task">
              <span>{t.title}<small> · {t.localDate}</small></span>
              <div role="radiogroup" aria-label={`Outcome for ${t.title}`} className="review-choices">
                {CHOICES.map(c => (
                  <label key={c.value}>
                    <input type="radio" name={`t-${t.id}`} checked={choices[t.id] === c.value}
                      onChange={() => setChoices(s => ({ ...s, [t.id]: c.value }))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      {props.needsNoPaperAck && (
        <label className="review-ack">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          Close this week without a paper. {props.noPaperReason}
        </label>
      )}

      {message && <p role="alert" className="review-error">{message}</p>}

      <button type="button" className="primary-button" disabled={!ready || busy} onClick={confirm}>
        {busy ? 'Closing…' : 'Close this week and start next week'}
      </button>
      {!ready && props.canClose && unanswered > 0 && (
        <p className="review-hint">{unanswered} task{unanswered === 1 ? '' : 's'} still need an answer.</p>
      )}
    </div>
  )
}
