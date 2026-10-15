'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, Loader2, RotateCcw } from 'lucide-react'

export type ConceptRow = {
  id: string
  name: string
  topic: string
  module: string
  los: string
  importance: string
  scopeNotes: string | null
  exclusions: string | null
  verified: boolean
  itemsAwaitingReview: number
}

/**
 * Grouped by module, because scope is judged in context: whether a concept's
 * boundary is right depends on what the neighbouring concepts claim.
 */
export function ConceptVerifyList({ rows }: { rows: ConceptRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map(r => [r.id, r.verified]))
  )
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(rows.filter(r => !r.verified && r.itemsAwaitingReview > 0).slice(0, 1).map(r => r.id))
  )

  const modules = [...new Set(rows.map(r => r.module))]

  async function setVerified(id: string, verified: boolean) {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(`/api/curriculum/concepts/${encodeURIComponent(id)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified }),
      })
      const data = await res.json()
      if (data.ok) { setState(prev => ({ ...prev, [id]: verified })); router.refresh() }
      else setError(data.error || 'Could not update that concept')
    } catch {
      setError('Network error')
    }
    setBusy(null)
  }

  function toggle(id: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="manifest-list">
      {error && <p className="auth-error">{error}</p>}

      {modules.map(moduleId => (
        <section key={moduleId} className="manifest-module">
          <div className="section-heading">
            <h2>{moduleId}</h2>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {rows.filter(r => r.module === moduleId && state[r.id]).length} of{' '}
              {rows.filter(r => r.module === moduleId).length} signed off
            </span>
          </div>

          <div className="review-rows">
            {rows.filter(r => r.module === moduleId).map(row => {
              const isVerified = state[row.id]
              const isOpen = open.has(row.id)
              return (
                <article key={row.id} className={`review-item ${isVerified ? 'is-correct' : ''}`}>
                  <button className="review-item__head" onClick={() => toggle(row.id)} aria-expanded={isOpen}>
                    <span className={`review-mark ${isVerified ? 'is-correct' : 'is-pending'}`} aria-hidden>
                      {isVerified ? <Check size={14} /> : null}
                    </span>
                    <span className="review-item__summary">
                      <span className="review-item__stem">{row.name}</span>
                      <span className="review-item__meta">
                        <span>{row.los}</span>
                        <span>{row.importance}</span>
                        {!row.scopeNotes && <span className="review-item__error">no scope written</span>}
                        {row.itemsAwaitingReview > 0 && (
                          <span className={isVerified ? '' : 'review-item__error'}>
                            {row.itemsAwaitingReview} item{row.itemsAwaitingReview === 1 ? '' : 's'}
                            {isVerified ? ' awaiting review' : ' blocked from gold'}
                          </span>
                        )}
                      </span>
                    </span>
                    <ChevronDown size={18} className={`review-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden />
                  </button>

                  {isOpen && (
                    <div className="review-item__body">
                      {row.scopeNotes ? (
                        <div className="review-solution">
                          <h4>In scope</h4>
                          <p>{row.scopeNotes}</p>
                        </div>
                      ) : (
                        <p className="notice notice--warn" style={{ margin: 0 }}>
                          <span>No scope has been written for this concept, so it cannot be signed off.</span>
                        </p>
                      )}

                      {row.exclusions && (
                        <div className="review-diagnosis">
                          <h4>Explicitly excluded</h4>
                          <p>{row.exclusions}</p>
                        </div>
                      )}

                      <div className="review-item__foot">
                        {isVerified ? (
                          <button
                            className="text-button"
                            onClick={() => setVerified(row.id, false)}
                            disabled={busy === row.id}
                          >
                            {busy === row.id ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RotateCcw size={14} aria-hidden />}
                            Withdraw sign-off
                          </button>
                        ) : (
                          <button
                            className="primary-button"
                            onClick={() => setVerified(row.id, true)}
                            disabled={busy === row.id || !row.scopeNotes}
                          >
                            {busy === row.id ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
                            This scope is correct
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
