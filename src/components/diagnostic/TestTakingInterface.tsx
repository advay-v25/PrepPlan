'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronRight, Flag, Loader2 } from 'lucide-react'
import { Reveal } from '../Reveal'
import { ChallengeDialog } from './ChallengeDialog'

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const
type Confidence = (typeof CONFIDENCE_LEVELS)[number]

type NextItem = {
  id: string
  stem: string
  options: string[]
  conceptName: string | null
  intendedDifficulty: string | null
  sequenceNumber: number
}

type AttemptState = {
  id: string
  status: string
  purpose: string | null
  answeredCount: number
  totalCount: number
}

export function TestTakingInterface({ attemptId }: { attemptId: string }) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [attempt, setAttempt] = useState<AttemptState | null>(null)
  const [nextItem, setNextItem] = useState<NextItem | null>(null)
  const [error, setError] = useState('')

  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [challengeOpen, setChallengeOpen] = useState(false)
  const [challenged, setChallenged] = useState<Set<string>>(new Set())

  const answerRefs = useRef<(HTMLButtonElement | null)[]>([])
  const confidenceRefs = useRef<(HTMLButtonElement | null)[]>([])
  /** Wall-clock on the current item, reported with the answer. */
  const shownAt = useRef<number>(Date.now())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/diagnostic/attempt/${attemptId}`, { cache: 'no-store' })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Could not load this attempt'); setLoading(false); return }

      if (data.attempt.status === 'scored') {
        router.replace(`/app/tests/${attemptId}/result`)
        return
      }

      setAttempt(data.attempt)
      setNextItem(data.nextItem)
      setSelectedOption(null)
      setConfidence(null)
      shownAt.current = Date.now()
      setError('')
    } catch {
      setError('Network error. Your answers so far are saved.')
    }
    setLoading(false)
  }, [attemptId, router])

  useEffect(() => { load() }, [load])

  async function submitAnswer() {
    if (selectedOption === null || !nextItem || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/diagnostic/attempt/${attemptId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: nextItem.id,
          selectedOptionIndex: selectedOption,
          confidence: confidence ?? undefined,
          elapsedSeconds: Math.round((Date.now() - shownAt.current) / 1000),
          flagged: challenged.has(nextItem.id),
        }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Could not save that answer'); setSubmitting(false); return }
      await load()
    } catch {
      setError('Network error. That answer was not saved — try again.')
    }
    setSubmitting(false)
  }

  async function finalise() {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/diagnostic/attempt/${attemptId}/submit`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) router.replace(`/app/tests/${attemptId}/result`)
      else { setError(data.error || 'Could not score this attempt'); setSubmitting(false) }
    } catch {
      setError('Network error while scoring.')
      setSubmitting(false)
    }
  }

  // Roving tabindex for a radiogroup: arrows move and select, wrapping around.
  function radioKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    count: number,
    onMove: (next: number) => void,
    refs: React.RefObject<(HTMLButtonElement | null)[]>
  ) {
    let next: number | null = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % count
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + count) % count
    if (next === null) return
    e.preventDefault()
    onMove(next)
    refs.current[next]?.focus()
  }

  if (loading) {
    return (
      <div className="test-loading" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden /> Loading your diagnostic…
      </div>
    )
  }

  if (error && !attempt) {
    return (
      <div className="empty-state">
        <h2>This diagnostic could not be loaded</h2>
        <p>{error}</p>
        <a href="/app/tests" className="primary-button">Back to diagnostics</a>
      </div>
    )
  }

  const answered = attempt?.answeredCount ?? 0
  const total = attempt?.totalCount ?? 0
  const progressPercent = total > 0 ? Math.round((answered / total) * 100) : 0

  if (!nextItem) {
    return (
      <div className="empty-state">
        <CheckCircle2 size={48} aria-hidden />
        <h2>All {total} questions answered</h2>
        <p>
          Nothing is scored until you finish. Once you do, every answer is turned into concept-level
          evidence and you will see which ideas held up and which did not.
        </p>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-button" onClick={finalise} disabled={submitting}>
          {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Scoring…</> : 'Score and see results'}
        </button>
      </div>
    )
  }

  return (
    <div className="test-taking-shell">
      <div className="test-progress">
        <div className="test-progress-row">
          <span>
            Question {answered + 1} of {total}
            {nextItem.conceptName && <> · <span className="text-muted">{nextItem.conceptName}</span></>}
          </span>
          <button
            type="button"
            className={`flag-button ${challenged.has(nextItem.id) ? 'is-active' : ''}`}
            onClick={() => setChallengeOpen(true)}
          >
            <Flag size={14} aria-hidden />
            {challenged.has(nextItem.id) ? 'Challenge raised' : 'Challenge this question'}
          </button>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Diagnostic progress"
        >
          <div className="progress-fill progress-fill--blue" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <Reveal className="question-card" key={nextItem.id}>
        <h2>{nextItem.stem}</h2>

        <div className="answer-list" role="radiogroup" aria-label="Answer choices">
          {nextItem.options.map((option, index) => {
            const isSelected = selectedOption === index
            return (
              <button
                key={index}
                type="button"
                ref={el => { answerRefs.current[index] = el }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={selectedOption === null ? (index === 0 ? 0 : -1) : isSelected ? 0 : -1}
                className={`answer-row ${isSelected ? 'is-selected' : ''}`}
                onClick={() => setSelectedOption(index)}
                onKeyDown={e => radioKeyDown(e, index, nextItem.options.length, setSelectedOption, answerRefs)}
              >
                <span className="answer-letter" aria-hidden>{String.fromCharCode(65 + index)}</span>
                <span>{option}</span>
                <span className="answer-radio" aria-hidden />
              </button>
            )
          })}
        </div>
      </Reveal>

      {selectedOption !== null && (
        <>
          <div className="question-controls">
            <div className="confidence-control">
              <span id="confidence-label">How sure are you? (optional)</span>
              <div role="radiogroup" aria-labelledby="confidence-label">
                {CONFIDENCE_LEVELS.map((level, index) => {
                  const isSelected = confidence === level
                  return (
                    <button
                      key={level}
                      type="button"
                      ref={el => { confidenceRefs.current[index] = el }}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={confidence === null ? (index === 0 ? 0 : -1) : isSelected ? 0 : -1}
                      className={isSelected ? 'is-active' : ''}
                      onClick={() => setConfidence(level)}
                      onKeyDown={e =>
                        radioKeyDown(e, index, CONFIDENCE_LEVELS.length, next => setConfidence(CONFIDENCE_LEVELS[next]), confidenceRefs)
                      }
                    >
                      {level[0].toUpperCase() + level.slice(1)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <p className="fine-print" style={{ maxWidth: 560 }}>
            A confident wrong answer and an unsure right one mean different things. Saying so here is what
            lets the report tell them apart.
          </p>

          {error && <p className="auth-error">{error}</p>}

          <div className="test-submit-row">
            <button className="primary-button submit-answer" onClick={submitAnswer} disabled={submitting}>
              {submitting ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : <>Submit and continue <ChevronRight size={18} aria-hidden /></>}
            </button>
          </div>
        </>
      )}

      {challengeOpen && (
        <ChallengeDialog
          itemId={nextItem.id}
          attemptId={attemptId}
          onClose={() => setChallengeOpen(false)}
          onRaised={() => {
            setChallenged(prev => new Set(prev).add(nextItem.id))
            setChallengeOpen(false)
          }}
        />
      )}
    </div>
  )
}
