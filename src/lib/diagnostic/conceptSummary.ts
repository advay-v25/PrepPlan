import { createClient } from '../supabase/server'
import { EvidenceEvent, ConceptEvidenceState, reduceSameAttemptEvents } from './evidencePolicy'

export interface ConceptSummary {
  concept_id: string
  concept_label: string
  current_state: ConceptEvidenceState
  valid_sample_size: number
  latest_eligible_evidence_at: string | null
  confidence_mismatch: boolean
  contributing_attempt_ids: string[]
  contributing_item_ids: string[]
  open_repair_thread_id: string | null
  has_dispute: boolean
  policy_version: string
}

/**
 * Reduces a timeline of evidence events into a unique concept summary.
 * Expects events to be sorted by created_at ASC, id ASC.
 */
export function reduceConceptEvidence(events: EvidenceEvent[], concept_label: string, repair_thread_id?: string | null): ConceptSummary {
  if (!events.length) {
    return {
      concept_id: '',
      concept_label,
      current_state: 'insufficient',
      valid_sample_size: 0,
      latest_eligible_evidence_at: null,
      confidence_mismatch: false,
      contributing_attempt_ids: [],
      contributing_item_ids: [],
      open_repair_thread_id: repair_thread_id ?? null,
      has_dispute: false,
      policy_version: '1.0'
    }
  }

  const concept_id = events[0].concept_id
  const validEvents = events.filter(e => e.validity === 'valid')
  const hasDispute = events.some(e => e.validity === 'disputed')

  const attempts = Array.from(new Set(validEvents.map(e => e.attempt_id).filter(Boolean) as string[]))
  const items = Array.from(new Set(validEvents.map(e => e.item_id).filter(Boolean) as string[]))

  let currentState: ConceptEvidenceState = 'insufficient'
  let confidenceMismatch = false
  let latestEligibleAt: string | null = null

  // Process attempt by attempt in chronological order
  const attemptGroups = new Map<string, EvidenceEvent[]>()
  for (const ev of validEvents) {
    if (ev.attempt_id) {
      if (!attemptGroups.has(ev.attempt_id)) attemptGroups.set(ev.attempt_id, [])
      attemptGroups.get(ev.attempt_id)!.push(ev)
    }
  }

  for (const [attemptId, attemptEvents] of attemptGroups.entries()) {
    const attemptState = reduceSameAttemptEvents(attemptEvents)
    // Later attempts overwrite earlier state for this concept
    currentState = attemptState
    
    // Check confidence mismatch for the most recent attempt
    const hasCorrectLowConf = attemptEvents.some(e => e.is_correct === true && e.self_reported_confidence !== null && e.self_reported_confidence <= 2)
    const hasIncorrectHighConf = attemptEvents.some(e => e.is_correct === false && e.self_reported_confidence !== null && e.self_reported_confidence >= 4)
    confidenceMismatch = hasCorrectLowConf || hasIncorrectHighConf
    
    // Since map preserves insertion order and events were sorted, the last one processed is the latest.
    latestEligibleAt = attemptEvents[attemptEvents.length - 1].created_at
  }

  // If no valid events (all disputed/voided), return insufficient
  if (validEvents.length === 0) {
    currentState = 'insufficient'
    if (hasDispute) currentState = 'disputed'
  }

  return {
    concept_id,
    concept_label,
    current_state: currentState,
    valid_sample_size: validEvents.length,
    latest_eligible_evidence_at: latestEligibleAt,
    confidence_mismatch: confidenceMismatch,
    contributing_attempt_ids: attempts,
    contributing_item_ids: items,
    open_repair_thread_id: repair_thread_id ?? null,
    has_dispute: hasDispute,
    policy_version: '1.0'
  }
}

/**
 * Retrieves and reduces all evidence for the current user into unique concept summaries.
 */
export async function getConceptSummariesForCurrentUser(): Promise<ConceptSummary[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: events, error } = await supabase
    .from('evidence_events')
    .select('*, concept:curriculum_concepts(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error || !events) return []

  // Also fetch open repair threads
  const { data: threads } = await supabase
    .from('repair_threads')
    .select('concept_id, id')
    .eq('user_id', user.id)
    .neq('status', 'closed')
    .neq('status', 'cancelled')
    .neq('status', 'superseded')

  const threadMap = new Map((threads || []).map(t => [t.concept_id as string, t.id as string]))

  const grouped = new Map<string, any[]>()
  for (const ev of events) {
    if (!grouped.has(ev.concept_id)) grouped.set(ev.concept_id, [])
    grouped.get(ev.concept_id)!.push(ev)
  }

  const summaries: ConceptSummary[] = []
  for (const [conceptId, conceptEvents] of grouped.entries()) {
    const label = conceptEvents[0]?.concept?.name || 'Unknown Concept'
    const threadId = threadMap.get(conceptId)
    summaries.push(reduceConceptEvidence(conceptEvents, label, threadId))
  }

  return summaries
}

/**
 * Retrieves and reduces evidence for a specific attempt into unique concept summaries.
 */
export class ConceptEvidenceUnavailable extends Error { constructor(m: string) { super(m); this.name = 'ConceptEvidenceUnavailable' } }

/**
 * Concept evidence AS OF this attempt: only observations recorded up to when this paper was scored, so a later paper cannot change what
 * this one showed. (Cumulative status lives in Curriculum.) Reads are paged and the concept filter is chunked, so a long history is never
 * truncated and no single request carries an unbounded list. A failed read THROWS: unavailable is not an empty history.
 */
export async function getAttemptConceptSummaries(attemptId: string): Promise<ConceptSummary[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: attemptEvents, error: e1 } = await supabase.from('evidence_events').select('concept_id, created_at').eq('attempt_id', attemptId).eq('user_id', user.id)
  if (e1) throw new ConceptEvidenceUnavailable(e1.message)
  if (!attemptEvents || attemptEvents.length === 0) return []
  const conceptIds = Array.from(new Set(attemptEvents.map(e => e.concept_id as string)))
  const asOf = attemptEvents.map(e => String(e.created_at)).sort().at(-1)!

  const allEvents: any[] = []
  for (let i = 0; i < conceptIds.length; i += 40) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('evidence_events').select('*, concept:curriculum_concepts(name)')
        .eq('user_id', user.id).in('concept_id', conceptIds.slice(i, i + 40)).lte('created_at', asOf)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
      if (error) throw new ConceptEvidenceUnavailable(error.message)
      allEvents.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
  }

  const grouped = new Map<string, any[]>()
  for (const ev of allEvents) {
    if (!grouped.has(ev.concept_id)) grouped.set(ev.concept_id, [])
    grouped.get(ev.concept_id)!.push(ev)
  }
  allEvents.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.id).localeCompare(String(y.id)))
  const summaries: ConceptSummary[] = []
  for (const [, conceptEvents] of grouped.entries()) {
    conceptEvents.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.id).localeCompare(String(y.id)))
    summaries.push(reduceConceptEvidence(conceptEvents, conceptEvents[0]?.concept?.name || 'Unknown Concept', null))
  }
  return summaries
}
