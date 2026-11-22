/**
 * Defines evidence eligibility, trust tiers, and aggregation rules.
 * 
 * Version 1.0 of the evidence policy.
 */
import { isEvidenceGrade } from './itemState'

export const EVIDENCE_POLICY_VERSION = '1.0'

export type EvidenceMode = 'evidence' | 'practice'
export type AssessmentPurpose = 'weekly' | 'module' | 'repair' | 'practice'
export type ItemTrustTier = import('./itemState').ItemState
export type ConceptEvidenceState = 'insufficient' | 'needs_repair' | 'unstable' | 'supported' | 'disputed' | 'voided'

export interface EvidenceEvent {
  id: string
  user_id: string
  attempt_id: string | null
  item_id: string | null
  concept_id: string
  validity: 'valid' | 'voided' | 'disputed'
  is_correct: boolean | null
  evidence_state: ConceptEvidenceState
  self_reported_confidence: number | null
  created_at: string
}

/**
 * Determines if an attempt can generate durable evidence based on its purpose and item trust.
 */
export function determineEvidenceMode(purpose: AssessmentPurpose, items: { review_status: string }[]): EvidenceMode {
  if (purpose === 'practice') return 'practice'
  
  // Evidence needs every item human reviewed; the scoring function in the database applies the same rule.
  const hasUnreviewedItems = items.some(i => !isEvidenceGrade(i.review_status))
  
  return hasUnreviewedItems ? 'practice' : 'evidence'
}

/**
 * Reduces multiple evidence events for the SAME concept from the SAME attempt into one state.
 * Any valid incorrect response -> needs_repair.
 * Otherwise, low confidence -> unstable.
 * Otherwise -> supported.
 */
export function reduceSameAttemptEvents(events: EvidenceEvent[]): ConceptEvidenceState {
  const validEvents = events.filter(e => e.validity === 'valid')
  if (validEvents.length === 0) return 'insufficient'

  const hasMiss = validEvents.some(e => e.is_correct === false)
  if (hasMiss) return 'needs_repair'

  const hasLowConfidence = validEvents.some(e => e.is_correct === true && e.self_reported_confidence !== null && e.self_reported_confidence <= 2)
  if (hasLowConfidence) return 'unstable'

  return 'supported'
}
