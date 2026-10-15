'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Lock, X } from 'lucide-react'

export type QueueItem = {
  id: string
  stem: string
  options: string[]
  keyIndex: number | null
  perOptionFeedback: Record<string, string>
  solution: string | null
  distractorDiagnoses: { optionIndex: number; errorCode: string; description: string }[]
  cognition: string | null
  itemForm: string | null
  difficulty: string | null
  conceptName: string | null
  conceptScope: string | null
  conceptExclusions: string | null
  conceptVerified: boolean
  generatorModel: string | null
  verifierModel: string | null
  gates: { gate: string; passed: boolean; detail: string }[]
}

/**
 * One item at a time, deliberately.
 *
 * A grid of items invites skimming, and skimming is how a plausible-but-wrong
 * item gets promoted to gold. The reviewer sees the item, what the verifier
 * checked, and the concept scope it was written against — the same three things
 * the verifier had.
 */
export function ItemReviewQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Record<string, 'reviewed' | 'deprecated'>>({})

  const remaining = items.filter(i => !done[i.id])
  const item = remaining[Math.min(index, Math.max(0, remaining.length - 1))]

  async function decide(decision: 'approve' | 'reject') {
    if (!item) return
    if (decision === 'reject' && note.trim().length < 3) {
      setError('Say what is wrong with it. That reason is the point of rejecting.')
      return
    }
    setBusy(decision)
    setError('')
    try {
      const res = await fetch(`/api/diagnostic/items/${encodeURIComponent(item.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Could not record that decision'); setBusy(null); return }

      setDone(prev => ({ ...prev, [item.id]: data.reviewStatus }))
      setNote('')
      setIndex(0)
      router.refresh()
    } catch {
      setError('Network error')
    }
    setBusy(null)
  }

  if (!item) {
    return (
      <div className="empty-state">
        <Check size={44} aria-hidden />
        <h2>Queue cleared</h2>
        <p>Every verifier-passed item has a decision against it.</p>
      </div>
    )
  }

  const failedGates = item.gates.filter(g => !g.passed)

  return (
    <div className="review-queue">
      <div className="review-queue__progress">
        <span>{remaining.length} left in the queue</span>
        <span className="text-muted">{item.id}</span>
      </div>

      <article className="review-queue__card">
        <div className="review-queue__tags">
          {item.conceptName && <span className="tag">{item.conceptName}</span>}
          {item.cognition && <span className="tag tag--dim">{item.cognition}</span>}
          {item.itemForm && <span className="tag tag--dim">{item.itemForm}</span>}
          {item.difficulty && <span className="tag tag--dim">{item.difficulty}</span>}
        </div>

        <h2 className="review-queue__stem">{item.stem}</h2>

        <ol className="review-options">
          {item.options.map((option, i) => {
            const isKey = item.keyIndex === i
            const diagnosis = item.distractorDiagnoses.find(d => d.optionIndex === i)
            return (
              <li key={i} className={`review-option ${isKey ? 'is-key' : ''}`}>
                <span className="review-option__letter">{String.fromCharCode(65 + i)}</span>
                <span className="review-option__text">
                  <strong>{option}</strong>
                  {item.perOptionFeedback[String(i)] && (
                    <span className="review-option__feedback">{item.perOptionFeedback[String(i)]}</span>
                  )}
                  {diagnosis && (
                    <span className="review-option__feedback">
                      <em>{diagnosis.errorCode}</em> — {diagnosis.description}
                    </span>
                  )}
                </span>
                <span className="review-option__tags">{isKey && <em className="tag tag--key">Key</em>}</span>
              </li>
            )
          })}
        </ol>

        {item.solution && (
          <div className="review-solution">
            <h4>Stated working</h4>
            <p>{item.solution}</p>
          </div>
        )}

        <details className="review-queue__details">
          <summary>What the verifier checked ({item.gates.length} gates{failedGates.length ? `, ${failedGates.length} flagged` : ''})</summary>
          <ul className="gate-list">
            {item.gates.map((g, i) => (
              <li key={i} className={g.passed ? 'is-pass' : 'is-fail'}>
                <strong>{g.gate}</strong> {g.detail}
              </li>
            ))}
          </ul>
          <p className="fine-print">
            Generated by {item.generatorModel ?? 'unknown'}; verified by {item.verifierModel ?? 'unknown'}.
          </p>
        </details>

        {item.conceptScope && (
          <details className="review-queue__details">
            <summary>Concept scope this was written against</summary>
            <p className="fine-print">{item.conceptScope}</p>
            {item.conceptExclusions && (
              <p className="fine-print"><strong>Excluded:</strong> {item.conceptExclusions}</p>
            )}
          </details>
        )}
      </article>

      <div className="review-queue__decide">
        <label className="field">
          <span>Note {`(required to reject)`}</span>
          <textarea
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="If you would not put this in front of a candidate, why not?"
          />
        </label>

        {!item.conceptVerified && (
          <p className="notice notice--info">
            <Lock size={14} aria-hidden />
            <span>
              The concept behind this item is not verified yet, so it cannot be promoted to gold. You can
              still reject it.
            </span>
          </p>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="review-queue__actions">
          <button
            className="secondary-button is-danger"
            onClick={() => decide('reject')}
            disabled={busy !== null}
          >
            {busy === 'reject' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <X size={16} aria-hidden />}
            Reject
          </button>
          <button
            className="primary-button"
            onClick={() => decide('approve')}
            disabled={busy !== null || !item.conceptVerified}
            title={item.conceptVerified ? undefined : 'The concept behind this item is not verified'}
          >
            {busy === 'approve' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            Approve as gold
          </button>
        </div>

        <button
          className="text-button"
          onClick={() => setIndex(i => (i + 1) % Math.max(1, remaining.length))}
          disabled={remaining.length < 2}
        >
          Skip for now →
        </button>
      </div>
    </div>
  )
}
