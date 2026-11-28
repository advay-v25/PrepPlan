'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, Check, ListChecks, RotateCcw, Sprout } from 'lucide-react'
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
const STAGE_ICON = { starting_fresh: Sprout, first_pass_underway: ListChecks, revising_or_mocks: BookOpenCheck, retaking: RotateCcw, most_of_first_pass: ListChecks } as const

type Uncertainty = { level: UncertaintyLevel; lmIds: string[] }

/**
 * Where the student is starting from. Three separate answers, so none is guessed from another:
 *  - coverage     what they have studied before (not reported is not the same as not started)
 *  - uncertainty  what they want to revisit, whatever the coverage (unanswered is not the same as "nothing shaky")
 *  - a mock       an optional date and type; the exam stays the only exam date
 * All of it is the student's own estimate. It plans the roadmap and the first week and is never evidence.
 */
export function PositionStep({
  state, today, topics, readings: savedReadings, onChange,
}: {
  state: OnboardingState
  today: string
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
  const [revision, setRevision] = useState(state.profile?.entry_revision_completed == null ? '' : state.profile.entry_revision_completed ? 'yes' : 'no')
  const [lastMock, setLastMock] = useState(state.profile?.entry_last_mock_feeling ?? '')
  const [readingLists, setReadingLists] = useState<Record<string, ReadingInfo[] | 'loading' | 'failed'>>({})

  const meta = STARTING_STAGES.find(s => s.value === stage)
  const topicByReading = useMemo(() => new Map([
    ...savedReadings,
    ...Object.values(readingLists).flatMap(list => Array.isArray(list) ? list : []),
  ].map(r => [r.id, r.topicId])), [savedReadings, readingLists])
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
      const topic = topicByReading.get(id)
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
      ...(bulkStage && (revision || state.profile?.entry_revision_completed != null) ? { revisionCompleted: revision ? revision === 'yes' : null } : {}),
      ...(bulkStage && (lastMock || state.profile?.entry_last_mock_feeling != null) ? { lastMockFeeling: lastMock || null } : {}),
    }, canContinue, reason)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, coverage, uncertainty, readingStates, mockDate, mockKind, mockLabel, mockStart, mockLength, revision, lastMock, bulkStage, state.profile, meta, marked, onChange, topicByReading])

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
    setReadingStates(prev => Object.fromEntries(Object.entries(prev).filter(([lm]) => topicByReading.get(lm) !== id)))
  }

  async function loadReadings(topic: string) {
    if (readingLists[topic] === 'loading' || Array.isArray(readingLists[topic])) return
    setReadingLists(previous => ({ ...previous, [topic]: 'loading' }))
    try {
      const response = await fetch(`/api/onboarding/position?topic=${encodeURIComponent(topic)}`, { signal: AbortSignal.timeout(12_000) })
      if (!response.ok) throw new Error('Reading lookup unavailable')
      const { readings } = await response.json() as { readings: ReadingInfo[] }
      setReadingLists(previous => ({ ...previous, [topic]: readings }))
    } catch {
      setReadingLists(previous => ({ ...previous, [topic]: 'failed' }))
    }
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
        <Notice tone="info">Your accepted week stays as it is. This changes your roadmap and the weeks you plan next.</Notice>
      )}
      <section>
        <div className="fl-cards fl-cards--2">
          {STARTING_STAGES.filter(s => s.tile || s.value === stage).map(s => {
            const Icon = STAGE_ICON[s.value]
            return (
              <button key={s.value} type="button" className={`fl-card fl-card--row ${stage === s.value ? 'is-selected' : ''}`}
                aria-pressed={stage === s.value} onClick={() => pickStage(s.value)}>
                <span className="fl-card__icon" aria-hidden><Icon size={20} /></span>
                <span className="fl-card__text"><strong>{s.label}</strong></span>
                <span className="fl-card__check" aria-hidden><Check size={13} /></span>
              </button>
            )
          })}
        </div>
      </section>

      {showTopics && compact && (
        <section aria-label="Coverage summary">
          <h2 className="fl-label">What you told us</h2>
          <p className="fl-result">You said <strong>{marked - partlyCount} of {topics.length}</strong> topics are covered once{partlyCount ? `, ${partlyCount} partly` : ''}{uncertainCount ? `, ${uncertainCount} to revisit` : ''}. Practice results are tracked separately.</p>
          <button type="button" className="text-button" onClick={() => setExceptionsOpen(true)}>Change topics or readings</button>
        </section>
      )}

      {showTopics && !compact && (
        <section>
          <div className="ob-subhead-row">
            <h2 className="fl-label">Topics{meta?.needsTopics ? '' : ' (optional)'}</h2>
            <span className="ob-alt">
              {bulkStage && <button type="button" className="text-button" onClick={() => setExceptionsOpen(false)}>Summary</button>}
              <button type="button" className="text-button" onClick={() => bulk('covered')}>All covered</button>
              <button type="button" className="text-button" onClick={() => bulk(null)}>Clear</button>
            </span>
          </div>
          <div className="ob-topics">
            {topics.map(t => {
              const cov = coverage[t.id] ?? null
              const u = uncertainty[t.id]
              const list = readingLists[t.id]
              return (
                <div key={t.id} className="ob-topiccard">
                  <div className="ob-topic-row">
                    <strong id={`topic-${t.id}`}>{t.name}</strong>
                    <div className="fl-segment fl-segment--sm" role="group" aria-labelledby={`topic-${t.id}`}>
                      {(['partly', 'covered'] as Coverage[]).map(c => (
                        <button key={c} type="button" className={cov === c ? 'is-selected' : ''} aria-pressed={cov === c}
                          onClick={() => setTopicCoverage(t.id, cov === c ? null : c)}>{COVERAGE_LABEL[c]}</button>
                      ))}
                    </div>
                  </div>
                  {cov && (
                    <>
                      <div className="ob-topiccard__sub">
                        <span className="fine-print" id={`unsure-${t.id}`}>Feels uncertain?</span>
                        <div className="fl-segment fl-segment--sm" role="group" aria-labelledby={`unsure-${t.id}`}>
                          {UNCERTAINTY_LEVELS.map(l => (
                            <button key={l} type="button" className={u?.level === l ? 'is-selected' : ''} aria-pressed={u?.level === l}
                              onClick={() => setLevel(t.id, u?.level === l ? null : l)}>{UNCERTAINTY_LABEL[l]}</button>
                          ))}
                        </div>
                      </div>
                        <details suppressHydrationWarning className="ob-topiccard__readings" onToggle={event => {
                          if (event.currentTarget.open && list === undefined) void loadReadings(t.id)
                        }}>
                          <summary className="text-button">Individual readings{u?.lmIds.length ? ` (${u.lmIds.length} to revisit)` : ''}</summary>
                          {list === 'loading' && <p role="status">Loading readings…</p>}
                          {list === 'failed' && <p role="alert">Readings could not be loaded. <button type="button" className="text-button" onClick={() => void loadReadings(t.id)}>Retry</button></p>}
                          {Array.isArray(list) && (list.length > 0 ? <ul>
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
                          </ul> : <p>No individual readings are listed for this topic.</p>)}
                        </details>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {bulkStage && (
        <details className="fl-more" open={!!(revision || lastMock)}>
          <summary>Tell us how revision and mocks are going <span>optional</span></summary>
          <div className="fl-fields">
            <label>Have you revised the full syllabus?<select className="ob-input" value={revision} onChange={e => setRevision(e.target.value)}>
              <option value="">Leave unanswered</option><option value="yes">Yes</option><option value="no">Not yet</option>
            </select></label>
            <label>How did your last mock go?<select className="ob-input" value={lastMock} onChange={e => setLastMock(e.target.value)}>
              <option value="">Leave unanswered</option><option value="not_taken">I haven’t taken one</option>
              <option value="below_target">Below my target</option><option value="near_target">Near my target</option>
              <option value="on_target">At or above my target</option><option value="unscored">I don’t have a score yet</option>
            </select></label>
          </div>
          {lastMock === 'below_target' ? <p className="fl-hint">Use the topic choices above to mark where you want to focus. A mock feeling alone doesn’t identify weak topics.</p> : null}
        </details>
      )}

      {stage && (
        <section>
          <details className="fl-more" open={!!mockDate}>
            <summary>Add an upcoming mock <span>optional</span></summary>
            <div className="fl-fields">
              <label>Date<input id="mock-date" type="date" className="ob-input" min={today} value={mockDate} onChange={e => setMockDate(e.target.value)} /></label>
              <label>Type<select id="mock-kind" className="ob-input" value={mockKind} onChange={e => setMockKind(e.target.value as MockKind)}>
                {MOCK_KINDS.map(k => <option key={k} value={k}>{MOCK_KIND_LABEL[k]}</option>)}
              </select></label>
              {mockDate && <>
                <label>Called<input id="mock-label" className="ob-input" maxLength={80} placeholder="Coaching mock" value={mockLabel} onChange={e => setMockLabel(e.target.value)} /></label>
                <label>Starts<input id="mock-start" type="time" className="ob-input" value={mockStart} onChange={e => setMockStart(e.target.value)} /></label>
                <label>Length<select id="mock-length" className="ob-input" value={mockLength} onChange={e => setMockLength(e.target.value)}>
                  <option value="">Not set</option>
                  {[60, 90, 120, 180, 240, 300].map(m => <option key={m} value={m}>{m / 60} h</option>)}
                </select></label>
                <button type="button" className="text-button" onClick={() => setMockDate('')}>Remove mock</button>
              </>}
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
