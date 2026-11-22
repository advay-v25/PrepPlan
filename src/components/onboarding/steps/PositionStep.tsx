'use client'

import { useEffect, useMemo, useState } from 'react'
import { STARTING_STAGES } from '../../../lib/onboarding/steps'
import type { Stage } from '../../../lib/onboarding/schema'
import {
  MOCK_KINDS, MOCK_KIND_LABEL, UNCERTAINTY_LABEL, UNCERTAINTY_LEVELS,
  type MockKind, type ReadingState, type UncertaintyLevel,
} from '../../../lib/curriculum/entryContext'
import { Notice } from '../../ui/Notice'
import type { OnboardingState, ReadingInfo, TopicInfo } from '../OnboardingShell'

type Coverage = 'partly' | 'covered'
const COVERAGE_LABEL: Record<Coverage, string> = { partly: 'Partly covered', covered: 'Covered once' }
// Stored as the existing topic exposure: partly covered = "current", covered once = "recent".
const TO_RECENCY: Record<Coverage, 'current' | 'recent'> = { partly: 'current', covered: 'recent' }
const FROM_RECENCY = (r: unknown): Coverage | null => (r === 'current' ? 'partly' : r === 'recent' ? 'covered' : null)
const todayLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) }

type Uncertainty = { level: UncertaintyLevel; lmIds: string[] }

/**
 * Where the student is starting from. Three separate answers, so none is guessed from another:
 *  - coverage     what they have studied before (not reported is not the same as not started)
 *  - uncertainty  what they want to revisit, whatever the coverage (unanswered is not the same as "nothing shaky")
 *  - a mock       an optional date and type; the exam stays the only exam date
 * All of it is the student's own estimate. It plans the roadmap and the first week and is never evidence.
 */
export function PositionStep({
  state, topics, readings, onChange,
}: {
  state: OnboardingState
  topics: TopicInfo[]
  readings: ReadingInfo[]
  onChange: (payload: Record<string, unknown>, continueAllowed?: boolean, reason?: string | null) => void
}) {
  const [stage, setStage] = useState<Stage | ''>((state.profile?.stage as Stage) ?? '')
  const [coverage, setCoverage] = useState<Record<string, Coverage>>(() => {
    const initial: Record<string, Coverage> = {}
    for (const row of state.coverage ?? []) { const c = FROM_RECENCY(row.recency); if (row.topic_id && c) initial[row.topic_id] = c }
    return initial
  })
  const [uncertainty, setUncertainty] = useState<Record<string, Uncertainty>>(() => {
    const initial: Record<string, Uncertainty> = {}
    for (const u of state.entry?.uncertainty ?? []) initial[u.topic_id] = { level: u.level as UncertaintyLevel, lmIds: u.lm_ids ?? [] }
    return initial
  })
  // Reading-level answers that differ from their topic's. Seeded from what is saved.
  const [readingStates, setReadingStates] = useState<Record<string, ReadingState>>(() => {
    const out: Record<string, ReadingState> = {}
    for (const c of state.entry?.readingClaims ?? []) out[c.lm_id] = c.state
    return out
  })
  const [mockDate, setMockDate] = useState(state.entry?.mock?.date ?? '')
  const [mockKind, setMockKind] = useState<MockKind>((state.entry?.mock?.kind as MockKind) ?? 'provider_mock')
  const [mockLabel, setMockLabel] = useState(state.entry?.mock?.label ?? '')
  const [mockStart, setMockStart] = useState(state.entry?.mock?.startTime ?? '')
  const [mockLength, setMockLength] = useState(state.entry?.mock?.durationMinutes ? String(state.entry.mock.durationMinutes) : '')

  const meta = STARTING_STAGES.find(s => s.value === stage)
  const byTopic = useMemo(() => {
    const m = new Map<string, ReadingInfo[]>()
    for (const r of readings) m.set(r.topicId, [...(m.get(r.topicId) ?? []), r])
    return m
  }, [readings])
  const marked = Object.keys(coverage).length
  const showTopics = stage !== '' && stage !== 'starting_fresh'
  // "First pass complete" is a bulk declaration, so the fresh route stays short: a summary first, exceptions on demand.
  const bulkStage = stage === 'revising_or_mocks' || stage === 'retaking'
  const [exceptionsOpen, setExceptionsOpen] = useState(() => bulkStage && (Object.values(coverage).some(c => c !== 'covered') || Object.values(uncertainty).some(u => u.level !== 'none') || Object.keys(readingStates).length > 0))
  const compact = bulkStage && !exceptionsOpen
  const partlyCount = Object.values(coverage).filter(c => c === 'partly').length
  const uncertainCount = Object.values(uncertainty).filter(u => u.level !== 'none').length

  /** What the topic's own answer implies for each of its readings. */
  const impliedFor = (topicId: string): ReadingState => (coverage[topicId] === 'covered' ? 'covered' : coverage[topicId] === 'partly' ? 'partly' : 'not_started')

  useEffect(() => {
    // Only readings that differ from their topic's answer are sent; the rest follow the topic.
    const refinements: Record<string, ReadingState> = {}
    for (const [id, st] of Object.entries(readingStates)) {
      const topic = readings.find(r => r.id === id)?.topicId
      if (topic && st !== impliedFor(topic)) refinements[id] = st
    }
    const canContinue = !!stage && !(meta?.needsTopics && marked === 0)
    const reason = !stage ? 'Choose where you are starting from.' : meta?.needsTopics && marked === 0 ? 'Mark at least one topic you have covered.' : null
    onChange({
      stage: stage || undefined,
      topicExposure: Object.fromEntries(Object.entries(coverage).map(([id, c]) => [id, TO_RECENCY[c]])),
      readingStates: refinements,
      uncertainty,
      mock: mockDate ? { date: mockDate, kind: mockKind, label: mockLabel.trim() || null, startTime: mockStart || null, durationMinutes: mockLength ? Number(mockLength) : null } : null,
    }, canContinue, reason)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, coverage, uncertainty, readingStates, mockDate, mockKind, mockLabel, mockStart, mockLength, meta, marked, onChange, readings])

  function pickStage(next: Stage) {
    setStage(next)
    // "First pass complete" is a bulk declaration: every topic covered once, then exceptions. Only filled in when
    // nothing is marked yet, so coming back never overwrites the student's own marks.
    if ((next === 'revising_or_mocks' || next === 'retaking') && Object.keys(coverage).length === 0) {
      setCoverage(Object.fromEntries(topics.map(t => [t.id, 'covered' as Coverage])))
    }
  }

  function setTopicCoverage(id: string, value: Coverage | null) {
    setCoverage(prev => { const next = { ...prev }; if (value) next[id] = value; else delete next[id]; return next })
    // A reading refinement belongs to a covered topic; changing the topic's answer resets its readings to follow it.
    setReadingStates(prev => Object.fromEntries(Object.entries(prev).filter(([lm]) => readings.find(r => r.id === lm)?.topicId !== id)))
  }

  function setLevel(id: string, level: UncertaintyLevel | null) {
    setUncertainty(prev => {
      const next = { ...prev }
      if (level) next[id] = { level, lmIds: level === 'none' ? [] : (prev[id]?.lmIds ?? []) }
      else delete next[id]
      return next
    })
  }

  function toggleRevisit(topicId: string, lmId: string) {
    setUncertainty(prev => {
      const cur = prev[topicId] ?? { level: 'few' as UncertaintyLevel, lmIds: [] }
      const lmIds = cur.lmIds.includes(lmId) ? cur.lmIds.filter(x => x !== lmId) : [...cur.lmIds, lmId]
      return { ...prev, [topicId]: { level: cur.level === 'none' ? 'few' : cur.level, lmIds } }
    })
  }

  const bulk = (value: Coverage | null) => { for (const t of topics) setTopicCoverage(t.id, value) }

  return (
    <div className="ob-section">
      {state.profile?.onboarding_status === 'complete' && (
        <Notice tone="info">
          Changing this does not rewrite the week you accepted. It changes your roadmap and the weeks you plan next. A next-week proposal you have not accepted yet will ask you to refresh.
        </Notice>
      )}
      <section>
        <h2 className="ob-subhead">Where you are</h2>
        <div className="ob-tilegrid ob-tilegrid--3">
          {STARTING_STAGES.filter(s => s.tile || s.value === stage).map(s => (
            <button key={s.value} type="button" className={`ob-tile ob-tile--compact ${stage === s.value ? 'is-selected' : ''}`}
              aria-pressed={stage === s.value} onClick={() => pickStage(s.value)}>
              <strong>{s.label}</strong>
            </button>
          ))}
        </div>
        {stage && <p className="fine-print mt-3">Covered means you have studied it before. Your tests will help us understand how secure it is.</p>}
      </section>

      {stage === 'starting_fresh' && (
        <p className="fine-print mt-4">Roadmap will plan your whole first pass. If you have already covered a topic, choose “Some subjects covered”.</p>
      )}

      {showTopics && compact && (
        <section className="mt-8" aria-label="Coverage summary">
          <h2 className="ob-subhead">Your coverage</h2>
          <p><strong>{marked - partlyCount} of {topics.length} topics</strong> covered once{partlyCount ? ` · ${partlyCount} partly covered` : ''}{uncertainCount ? ` · ${uncertainCount} marked uncertain` : ' · none marked uncertain'}.</p>
          <p className="fine-print">This is what you report. It stays an estimate, separate from anything a paper confirms. Change a topic only if it is not really finished.</p>
          <button type="button" className="text-button" onClick={() => setExceptionsOpen(true)}>Change topics, uncertainty or readings</button>
        </section>
      )}

      {showTopics && !compact && (
        <section className="mt-8">
          {bulkStage && <button type="button" className="text-button" onClick={() => setExceptionsOpen(false)}>Show the summary</button>}
          <div className="ob-subhead-row">
            <h2 className="ob-subhead">Topics{meta?.needsTopics ? '' : ' (optional)'}</h2>
            <span className="ob-alt">
              <button type="button" className="text-button" onClick={() => bulk('covered')}>All covered once</button>
              <button type="button" className="text-button" onClick={() => bulk(null)}>Clear</button>
            </span>
          </div>
          <p className="fine-print">
            {stage === 'revising_or_mocks' || stage === 'retaking'
              ? 'All topics start as covered once. Change any that you have not finished, then say which feel uncertain. Leave the rest.'
              : 'Mark what you have covered. A topic you leave alone is “not reported”: Roadmap plans it as not started.'}
          </p>
          <div className="ob-topics">
            {topics.map(t => {
              const cov = coverage[t.id] ?? null
              const u = uncertainty[t.id]
              const list = byTopic.get(t.id) ?? []
              return (
                <div key={t.id} className="ob-topiccard">
                  <div className="ob-topic-row">
                    <strong id={`topic-${t.id}`}>{t.name}</strong>
                    <div className="ob-chipset ob-chipset--wrap" role="group" aria-labelledby={`topic-${t.id}`}>
                      {(['partly', 'covered'] as Coverage[]).map(c => (
                        <button key={c} type="button" className={`ob-chip ${cov === c ? 'is-selected' : ''}`} aria-pressed={cov === c}
                          onClick={() => setTopicCoverage(t.id, cov === c ? null : c)}>{COVERAGE_LABEL[c]}</button>
                      ))}
                    </div>
                  </div>
                  {cov && (
                    <>
                      <div className="ob-topiccard__sub">
                        <span className="fine-print" id={`unsure-${t.id}`}>How much of it feels uncertain?</span>
                        <div className="ob-chipset ob-chipset--wrap" role="group" aria-labelledby={`unsure-${t.id}`}>
                          {UNCERTAINTY_LEVELS.map(l => (
                            <button key={l} type="button" className={`ob-chip ob-chip--sm ${u?.level === l ? 'is-selected' : ''}`} aria-pressed={u?.level === l}
                              onClick={() => setLevel(t.id, u?.level === l ? null : l)}>{UNCERTAINTY_LABEL[l]}</button>
                          ))}
                        </div>
                      </div>
                      {list.length > 0 && (
                        <details className="ob-topiccard__readings">
                          <summary className="text-button">Pick or correct individual readings{u?.lmIds.length ? ` (${u.lmIds.length} to revisit)` : ''}</summary>
                          <ul>
                            {list.map(r => {
                              const st = readingStates[r.id] ?? impliedFor(t.id)
                              return (
                                <li key={r.id}>
                                  <span>{r.name}</span>
                                  <select className="ob-input" aria-label={`Coverage of ${r.name}`} value={st}
                                    onChange={e => setReadingStates(prev => ({ ...prev, [r.id]: e.target.value as ReadingState }))}>
                                    <option value="not_started">Not started</option>
                                    <option value="partly">Partly covered</option>
                                    <option value="covered">Covered once</option>
                                  </select>
                                  <label className="ob-check">
                                    <input type="checkbox" checked={u?.lmIds.includes(r.id) ?? false} onChange={() => toggleRevisit(t.id, r.id)} />
                                    Revisit
                                  </label>
                                </li>
                              )
                            })}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {stage && (
        <section className="mt-8">
          <h2 className="ob-subhead">Upcoming mock or checkpoint (optional)</h2>
          <p className="fine-print">A mock from your course, school or a provider. It shapes preparation; your exam date stays the exam date.</p>
          <div className="ob-window-row mt-3">
            <label className="fine-print" htmlFor="mock-date">Date</label>
            <input id="mock-date" type="date" className="ob-input" min={todayLocal()} value={mockDate} onChange={e => setMockDate(e.target.value)} />
            <label className="fine-print" htmlFor="mock-kind">Type</label>
            <select id="mock-kind" className="ob-input" value={mockKind} onChange={e => setMockKind(e.target.value as MockKind)}>
              {MOCK_KINDS.map(k => <option key={k} value={k}>{MOCK_KIND_LABEL[k]}</option>)}
            </select>
            {mockDate && <button type="button" className="text-button" onClick={() => setMockDate('')}>Clear</button>}
          </div>
          {mockDate && (
            <div className="ob-window-row mt-3">
              <label className="fine-print" htmlFor="mock-label">Called</label>
              <input id="mock-label" className="ob-input" maxLength={80} placeholder="Coaching mock (optional)" value={mockLabel} onChange={e => setMockLabel(e.target.value)} />
              <label className="fine-print" htmlFor="mock-start">Starts</label>
              <input id="mock-start" type="time" className="ob-input" value={mockStart} onChange={e => setMockStart(e.target.value)} />
              <label className="fine-print" htmlFor="mock-length">Length</label>
              <select id="mock-length" className="ob-input" value={mockLength} onChange={e => setMockLength(e.target.value)}>
                <option value="">Not set</option>
                {[60, 90, 120, 180, 240, 300].map(m => <option key={m} value={m}>{m / 60} h</option>)}
              </select>
              <p className="fine-print">Only the date is needed. This is your next planned mock; any others you have added stay as they are. Manage them in Calendar.</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
