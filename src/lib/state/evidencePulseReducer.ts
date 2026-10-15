import { ConceptEvidence, EvidenceState } from './types'

export interface RawEvidenceEvent {
  concept_id: string
  concept_name?: string
  evidence_state: 'supported' | 'unstable' | 'needs_repair' | 'stale'
  sample_size: number
  confidence_mismatch: boolean
  created_at: string
}

export function computeEvidencePulse(events: RawEvidenceEvent[]): EvidenceState {
  const recentChanges: ConceptEvidence[] = events.slice(0, 5).map(e => ({
    conceptId: e.concept_id,
    name: e.concept_name || 'Unknown Concept',
    state: e.evidence_state,
    sampleSize: e.sample_size,
    confidenceMismatch: e.confidence_mismatch,
    lastAssessedAt: e.created_at
  }))

  // Decisions §5: no preparedness band from a raw event count. Below the
  // evidence threshold (several topics, more than one paper, recent evidence)
  // the honest answer is "Insufficient evidence"; higher bands stay reserved
  // until the model is calibrated against outcome data.
  const preparednessBand: EvidenceState['preparednessBand'] = events.length > 0 ? 'Insufficient evidence' : null

  return {
    recentChanges,
    preparednessBand
  }
}
