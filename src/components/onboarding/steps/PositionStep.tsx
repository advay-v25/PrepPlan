'use client'

import { useEffect, useState } from 'react'
import { STARTING_STAGES, TOPIC_STATUS_OPTIONS } from '../../../lib/onboarding/steps'
import type { Stage } from '../../../lib/onboarding/schema'
import type { OnboardingState, TopicInfo } from '../OnboardingShell'

type Status = 'current' | 'recent'

/**
 * A broad starting stage and, optionally, what has been covered. It is the candidate's estimate: it orders
 * the roadmap and sets the first cycle's scope, and is never treated as evidence of understanding.
 */
export function PositionStep({
  state, topics, onChange,
}: {
  state: OnboardingState
  topics: TopicInfo[]
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
}) {
  const [stage, setStage] = useState<Stage | ''>((state.profile?.stage as Stage) ?? '')
  const [status, setStatus] = useState<Record<string, Status>>(() => {
    const initial: Record<string, Status> = {}
    for (const row of state.coverage ?? []) {
      if (row.topic_id && (row.recency === 'current' || row.recency === 'recent')) initial[row.topic_id] = row.recency
    }
    return initial
  })

  const meta = STARTING_STAGES.find(s => s.value === stage)
  const marked = Object.keys(status).length

  useEffect(() => {
    let canContinue = !!stage
    let reason: string | null = stage ? null : 'Choose where you are starting from.'
    if (stage && meta?.needsTopics && marked === 0) {
      canContinue = false
      reason = 'Mark at least one topic you have covered.'
    }
    onChange({ stage: stage || undefined, topicExposure: status }, canContinue, reason)
  }, [stage, status, meta, marked, onChange])

  function setTopic(id: string, value: string) {
    setStatus(prev => {
      const next = { ...prev }
      if (value === 'current' || value === 'recent') next[id] = value
      else delete next[id]
      return next
    })
  }

  const list = (
    <div className="ob-topics">
      {topics.map(t => (
        <div key={t.id} className="ob-topic-row">
          <label className="ob-topic-row__name" htmlFor={`topic-${t.id}`}><strong>{t.name}</strong></label>
          <select id={`topic-${t.id}`} className="ob-input ob-topic-row__select" value={status[t.id] ?? ''} onChange={e => setTopic(t.id, e.target.value)}>
            <option value="">Not reported</option>
            {TOPIC_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
    </div>
  )

  return (
    <div className="ob-section">
      <section>
        <h2 className="ob-subhead">Your stage</h2>
        <div className="ob-tilegrid ob-tilegrid--3">
          {STARTING_STAGES.map(s => (
            <button key={s.value} type="button" className={`ob-tile ob-tile--compact ${stage === s.value ? 'is-selected' : ''}`}
              aria-pressed={stage === s.value} onClick={() => setStage(s.value)}>
              <strong>{s.label}</strong>
            </button>
          ))}
        </div>
      </section>

      {stage && (
        <section className="mt-8">
          <h2 className="ob-subhead">Topics{meta?.needsTopics ? '' : ' (optional)'}</h2>
          <p className="fine-print">Your estimate. Tests will update this. Leave a topic as “Not reported” if you are unsure.</p>
          {stage === 'starting_fresh'
            ? <details><summary className="text-button">Mark topics I have already covered</summary>{list}</details>
            : list}
        </section>
      )}
    </div>
  )
}
