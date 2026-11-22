'use client'

import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Flag, X } from 'lucide-react'
import { ChallengeDialog } from './ChallengeDialog'

/**
 * Per-question review, shown only after an attempt is scored.
 *
 * The review is the product. A score tells a learner nothing they can act on;
 * seeing which option they picked, what mistake it represents, and what the
 * worked solution was, is the whole reason for taking the diagnostic.
 */

export type ReviewRow = {
  itemId: string
  stem: string
  options: string[]
  keyIndex: number | null
  selectedIndex: number | null
  isCorrect: boolean | null
  confidence: number | null
  perOptionFeedback: Record<string, string>
  solution: string | null
  conceptName: string | null
  errorCode: string | null
  errorLabel: string | null
  errorDescription: string | null
  unreviewed: boolean
  challenged: boolean
  omitted?: boolean
  flagged?: boolean
  challengeStatus?: 'pending' | 'upheld' | 'dismissed' | null
  /** Reading, outcome, timing and pattern context (present for the newer taking flow). */
  extra?: { readingLabel: string | null; readingHref: string | null; outcomeTitle: string | null; difficulty: string | null; form: string | null; timing: string; pattern: string | null; tags: string[]; activeSeconds: number | null }
}

type Filter = 'all' | 'wrong' | 'unsure' | 'omitted' | 'flagged' | 'patterns'

const TAG_LABEL: Record<string, string> = { correct_guess: 'Correct guess', slow_correct: 'Slow but correct', confident_mistake: 'Confident mistake', repeated_misconception: 'Repeated mistake', changed_answer: 'Changed answer', interrupted: 'Interrupted' }
const PATTERN_LABEL: Record<string, string> = { stronger_evidence: 'Right and sure — stronger evidence', possible_recognition: 'Right but guessing — possible recognition', confident_misconception: 'Wrong and sure — possible misconception', knowledge_gap: 'Wrong and guessing — a gap', unsettled: 'Medium confidence — unsettled' }

const CONFIDENCE_LABEL: Record<number, string> = { 1: 'not sure', 2: 'not sure', 3: 'fairly sure', 4: 'confident', 5: 'confident' }

export function ItemReviewList({ rows, attemptId }: { rows: ReviewRow[]; attemptId: string }) {
  const [filter, setFilter] = useState<Filter>(rows.some(r => r.isCorrect === false && !r.omitted) ? 'wrong' : 'all')

  // Open the first question that needs attention. Landing on a wall of collapsed
  // rows makes the reader hunt for the thing they came here to see.
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = rows.find(r => r.isCorrect === false && !r.omitted) ?? rows[0]
    return first ? new Set([first.itemId]) : new Set()
  })
  const [challenging, setChallenging] = useState<string | null>(null)
  const [challenged, setChallenged] = useState<Set<string>>(new Set(rows.filter(r => r.challenged).map(r => r.itemId)))

  const wrongCount = rows.filter(r => r.isCorrect === false && !r.omitted).length
  const unsureCount = rows.filter(r => !r.omitted && (r.confidence ?? 5) <= 2).length
  const omittedCount = rows.filter(r => r.omitted).length
  const flaggedCount = rows.filter(r => r.flagged).length
  const patternRows = (r: ReviewRow) => (r.extra?.tags ?? []).some(t => ['correct_guess', 'slow_correct', 'confident_mistake', 'repeated_misconception'].includes(t))
  const patternCount = rows.filter(patternRows).length

  const visible = rows.filter(row => {
    if (filter === 'wrong') return row.isCorrect === false && !row.omitted
    if (filter === 'unsure') return !row.omitted && (row.confidence ?? 5) <= 2
    if (filter === 'omitted') return Boolean(row.omitted)
    if (filter === 'flagged') return Boolean(row.flagged)
    if (filter === 'patterns') return patternRows(row)
    return true
  })

  function toggle(itemId: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'wrong', label: 'Got wrong', count: wrongCount },
    { key: 'unsure', label: 'Unsure', count: unsureCount },
    { key: 'omitted', label: 'Not answered', count: omittedCount },
    { key: 'flagged', label: 'Flagged', count: flaggedCount },
    { key: 'patterns', label: 'Patterns', count: patternCount },
    { key: 'all', label: 'All', count: rows.length },
  ]

  return (
    <div className="review-list">
      <div className="review-filters" role="tablist" aria-label="Filter questions">
        {filters.map(f => (
          <button type="button"
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`review-filter ${filter === f.key ? 'is-active' : ''}`}
            onClick={() => setFilter(f.key)}
            disabled={f.count === 0 && f.key !== 'all'}
          >
            {f.label} <span>{f.count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-muted">
          {filter === 'wrong' ? 'You did not get any of these wrong.' : filter === 'omitted' ? 'You answered every question.' : 'Nothing matches that filter.'}
        </p>
      ) : (
        <div className="review-rows">
          {visible.map(row => {
            const isOpen = open.has(row.itemId)
            const correct = row.isCorrect === true
            const skipped = Boolean(row.omitted)
            return (
              <article key={row.itemId} data-omitted={skipped || undefined} className={`review-item ${correct ? 'is-correct' : 'is-wrong'}`}>
                <button type="button"
                  className="review-item__head"
                  onClick={() => toggle(row.itemId)}
                  aria-expanded={isOpen}
                >
                  <span className={`review-mark ${correct ? 'is-correct' : 'is-wrong'}`} aria-hidden>
                    {correct ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <span className="review-item__summary">
                    <span className="review-item__stem">{row.stem}</span>
                    <span className="review-item__meta">
                      {row.conceptName && <span>{row.conceptName}</span>}
                      {skipped && <span className="review-item__error">Not answered — no cause is assumed</span>}
                      {row.flagged && <span>flagged</span>}
                      {row.confidence !== null && <span>you were {CONFIDENCE_LABEL[row.confidence] ?? 'unsure'}</span>}
                      {row.errorLabel && <span className="review-item__error">{row.errorLabel}</span>}
                      {(row.extra?.tags ?? []).filter(t => t !== 'changed_answer').map(t => <span key={t} className="review-item__error">{TAG_LABEL[t] ?? t}</span>)}
                    </span>
                  </span>
                  <ChevronDown size={18} className={`review-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden />
                </button>

                {isOpen && (
                  <div className="review-item__body">
                    {row.unreviewed && (
                      <p className="notice notice--info">
                        <AlertTriangle size={14} aria-hidden />
                        <span>
                          This question passed automated verification but has not been reviewed by hand. It
                          does not affect your readiness. If it looks wrong, say so.
                        </span>
                      </p>
                    )}

                    {row.extra && (
                      <p className="review-context">
                        {row.extra.readingHref && row.extra.readingLabel && <><a href={row.extra.readingHref}>{row.extra.readingLabel}</a> · <a href={`${row.extra.readingHref}#notes-h`}>your note on this reading</a></>}
                        {row.extra.outcomeTitle && <> · {row.extra.outcomeTitle}</>}
                        {row.extra.difficulty && <> · {row.extra.difficulty}</>}
                        {row.extra.activeSeconds !== null && <> · {row.extra.activeSeconds}s active{row.extra.timing === 'slow' ? ' (slow for this type)' : ''}</>}
                        {row.extra.pattern && <><br />{PATTERN_LABEL[row.extra.pattern] ?? row.extra.pattern}</>}
                      </p>
                    )}

                    <ol className="review-options">
                      {row.options.map((option, index) => {
                        const isKey = row.keyIndex === index
                        const isChoice = row.selectedIndex === index
                        return (
                          <li
                            key={index}
                            className={`review-option ${isKey ? 'is-key' : ''} ${isChoice && !isKey ? 'is-chosen-wrong' : ''}`}
                          >
                            <span className="review-option__letter">{String.fromCharCode(65 + index)}</span>
                            <span className="review-option__text">
                              <strong>{option}</strong>
                              {row.perOptionFeedback[String(index)] && (
                                <span className="review-option__feedback">{row.perOptionFeedback[String(index)]}</span>
                              )}
                            </span>
                            <span className="review-option__tags">
                              {isKey && <em className="tag tag--key">Correct</em>}
                              {isChoice && <em className="tag tag--yours">Your answer</em>}
                            </span>
                          </li>
                        )
                      })}
                    </ol>

                    {row.errorDescription && (
                      <div className="review-diagnosis">
                        <h4>What happened</h4>
                        <p>{row.errorDescription}</p>
                      </div>
                    )}

                    {row.solution && (
                      <div className="review-solution">
                        <h4>Working</h4>
                        <p>{row.solution}</p>
                      </div>
                    )}

                    <div className="review-item__foot">
                      {row.challengeStatus === 'upheld' ? (
                        <span className="status-line"><i />Your report was upheld — this question was set aside and your score adjusted.</span>
                      ) : row.challengeStatus === 'dismissed' ? (
                        <span className="status-line"><i />Your report was reviewed and the question stands; your score is unchanged.</span>
                      ) : challenged.has(row.itemId) ? (
                        <span className="status-line"><i />Challenge raised — under review, still counted for now</span>
                      ) : (
                        <button type="button" className="flag-button" onClick={() => setChallenging(row.itemId)}>
                          <Flag size={14} aria-hidden /> Something is wrong with this question
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {challenging && (
        <ChallengeDialog
          itemId={challenging}
          attemptId={attemptId}
          onClose={() => setChallenging(null)}
          onRaised={() => {
            setChallenged(prev => new Set(prev).add(challenging))
            setChallenging(null)
          }}
        />
      )}
    </div>
  )
}
