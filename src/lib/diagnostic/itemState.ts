/**
 * One definition of an item's state and of who may see it. Everything that selects questions for a student, scores
 * them or counts the bank imports from here; no other file decides what "reviewed" means.
 *
 * Stored `review_status` values keep their historical names; these are the plain words shown to people.
 */
export const ITEM_STATES = ['draft', 'verified', 'reviewed', 'deprecated'] as const
export type ItemState = (typeof ITEM_STATES)[number]

export const ITEM_STATE_LABEL: Record<ItemState, string> = {
  draft: 'Draft',
  verified: 'Automatically checked',
  reviewed: 'Human reviewed',
  deprecated: 'Retired',
}
export const ITEM_STATE_HELP: Record<ItemState, string> = {
  draft: 'Written, but not yet through the automatic checks (or the checks failed). Never shown to students.',
  verified: 'Passed the automatic checks. No person has approved it. Never produces student evidence.',
  reviewed: 'A person approved it. Eligible for student assessments, unless it is held out.',
  deprecated: 'Retired or rejected. Kept so past attempts stay reproducible. Never selected again.',
}
export const itemStateLabel = (s: string | null | undefined): string => ITEM_STATE_LABEL[s as ItemState] ?? 'Unknown'

/** The only state that can enter a student assessment or move readiness evidence. */
export const EVIDENCE_TIERS: string[] = ['reviewed']
export const isEvidenceGrade = (s: string | null | undefined) => s === 'reviewed'
export const FIXTURE_PROVENANCE = 'fixture-bank'

/**
 * The ONE source of "may this question enter a new student paper": the database view `student_eligible_items`
 * (human reviewed, not held out, and a recorded approval for its exact current version). Pools, counts and result-page
 * availability all read it; reservation re-checks the same rule inside `start_assessment_paper`.
 * Legacy items marked reviewed with no recorded decision are deliberately not in it (see §9.10 of the master status).
 */
export const eligibleItems = (db: { from: (t: string) => any }) => db.from('student_eligible_items')
