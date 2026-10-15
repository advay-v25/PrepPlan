'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'

/**
 * Lets a learner dispute an item mid-attempt (§13.2).
 *
 * The point is not the complaint. Unreviewed items reach learners under the
 * trust-tier rule, and a defective one manufactures a false weakness that
 * propagates into the repair queue and next week's plan. This is how that gets
 * caught by the only person who sees every item: the person taking the test.
 */

const REASONS = [
  { code: 'no_correct_answer', label: 'None of the options is correct' },
  { code: 'two_correct_answers', label: 'More than one option is defensible' },
  { code: 'calculation_wrong', label: 'The arithmetic does not work out' },
  { code: 'off_syllabus', label: 'This is not on the Level I syllabus' },
  { code: 'unclear_wording', label: 'The question is unclear or missing information' },
  { code: 'other', label: 'Something else' },
]

export function ChallengeDialog({
  itemId,
  attemptId,
  onClose,
  onRaised,
}: {
  itemId: string
  attemptId?: string
  onClose: () => void
  onRaised: () => void
}) {
  const [reasonCode, setReasonCode] = useState(REASONS[0].code)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const firstFieldRef = useRef<HTMLSelectElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (comment.trim().length < 3) { setError('Say briefly what is wrong with it.'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/diagnostic/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, attemptId, reasonCode, comment: comment.trim() }),
      })
      const data = await res.json()
      if (data.ok) onRaised()
      else { setError(data.error || 'Could not record that challenge'); setSubmitting(false) }
    } catch {
      setError('Network error')
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      className="challenge-dialog"
      title="Challenge this question"
      description="Your answer is still recorded. If the question turns out to be faulty it is voided, your score is recalculated, and it will not count against you."
      initialFocusRef={firstFieldRef}
    >
      <form onSubmit={submit}>
        <label className="field">
          <span>What is wrong with it?</span>
          <select ref={firstFieldRef} value={reasonCode} onChange={e => setReasonCode(e.target.value)}>
            {REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>Detail</span>
          <textarea
            rows={4}
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="What did you expect, and what did the question say?"
            maxLength={2000}
          />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Sending…</> : 'Raise challenge'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
