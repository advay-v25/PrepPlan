import { onboardingHref, ROUTES } from '../../routing/registry'

/**
 * The canonical states of "this week has no planned work yet", one derivation for Calendar, Home and the endpoints. Saving study times
 * (changing setup) and accepting a plan (changing the week) are different acts: no state below is entered by saving alone.
 */
export type CurrentWeekPlanKind =
  | 'not_applicable'      // the week already has planned work, or there is no accepted cycle
  | 'no_study_times'      // nothing to plan around yet
  | 'ready_to_plan'       // study times saved and valid windows remain: a proposal can be prepared
  | 'proposal_ready'      // a current proposal awaits review
  | 'proposal_stale'      // a proposal exists but the week or setup moved after it was prepared
  | 'plan_accepted'       // a reviewed plan was accepted into this cycle
  | 'intentionally_empty' // the student kept the week empty on purpose (or accepted it empty in weekly review)
  | 'no_usable_windows'   // study times exist but none remain this cycle
  | 'awaiting_class_input' // a class-led week needs covered scope before follow-up can be planned
  | 'cycle_ended'         // the accepted cycle's last day has passed

export type CurrentWeekPlanState = {
  kind: CurrentWeekPlanKind
  title: string
  message: string
  /** `preview` opens the review panel in Calendar (POST /api/planning/current-week/preview); `link` navigates. */
  action: { label: string; href: string; kind: 'link' | 'preview' } | null
  reason: 'later_week' | 'assessment_day_only' | 'time_used' | 'nothing_to_add' | null
  draft: { id: string; revision: number } | null
}

export type CurrentWeekFacts = {
  hasCycle: boolean; cycleEnded: boolean
  plannedTasks: number
  acceptedBy: 'weekly_review' | 'onboarding' | null
  planAccepted: boolean
  availabilityMode: string | null; hasWindows: boolean
  remaining: { minutes: number; assessmentDayOnly: boolean; windowsLater: boolean }
  draft: { id: string; revision: number; fingerprint: string; current?: boolean } | null
  discardedFingerprint: string | null
  classGuidance?: 'log_class' | 'add_class' | 'upcoming_class'
  currentHash: string | null
}

export const ADD_STUDY_TIMES_HREF = onboardingHref('week', ROUTES.app.calendar)
export const REVIEW_PLAN_HREF = `${ROUTES.app.calendar}?plan=review`

const S = (kind: CurrentWeekPlanKind, title: string, message: string, action: CurrentWeekPlanState['action'], extra: Partial<CurrentWeekPlanState> = {}): CurrentWeekPlanState =>
  ({ kind, title, message, action, reason: null, draft: null, ...extra })

export function deriveCurrentWeekPlanState(f: CurrentWeekFacts): CurrentWeekPlanState {
  if (!f.hasCycle) return S('not_applicable', '', '', null)
  if (f.plannedTasks > 0) return f.planAccepted
    ? S('plan_accepted', 'Plan accepted', 'The reviewed plan was added to this week.', null)
    : S('not_applicable', '', '', null)
  if (f.cycleEnded) return S('cycle_ended', 'This cycle has ended', 'Plan the next week in your weekly review.', { label: 'Review the week', href: '/app/review-week', kind: 'link' })
  if (f.availabilityMode !== 'windows' || !f.hasWindows) {
    return S('no_study_times', 'No study times yet', 'Nothing is planned because Roadmap has no study times to plan around. Add them and you can review a plan for this week.', { label: 'Add study times', href: ADD_STUDY_TIMES_HREF, kind: 'link' })
  }
  if (f.remaining.minutes <= 0) {
    const why = f.remaining.assessmentDayOnly ? 'assessment_day_only' : f.remaining.windowsLater ? 'later_week' : 'time_used'
    const message = why === 'assessment_day_only' ? 'Only Sunday is left in this cycle, and Sunday is kept for your paper and review, not new study.'
      : why === 'later_week' ? 'Your study times fall on days after this cycle ends, so they will apply from next week.'
      : 'No free study time is left in this cycle once your commitments and the time already passed are taken out.'
    return S('no_usable_windows', 'No usable study time left this week', message, { label: 'Edit study times', href: ADD_STUDY_TIMES_HREF, kind: 'link' }, { reason: why })
  }
  if (f.classGuidance) {
    const choices = {
      log_class: { title: 'Log what your class covered', message: 'Your class has happened. Record its readings and outcomes so Roadmap can propose the follow-up work.', label: 'Log the class', href: '/app/calendar/log-class' },
      add_class: { title: 'Add your next class', message: 'Your classes guide the study order. Add the next class so Roadmap can organise the week around it.', label: 'Add next class', href: '/app/calendar?action=add-next-class' },
      upcoming_class: { title: 'Your next class leads the plan', message: 'Your study times are saved. After class, log what was covered to prepare its follow-up work.', label: 'See your classes', href: '/app/calendar?view=agenda' },
    }[f.classGuidance]
    return S('awaiting_class_input', choices.title, choices.message, { label: choices.label, href: choices.href, kind: 'link' })
  }
  if (f.draft) {
    const current = f.draft.fingerprint === f.currentHash && f.draft.current !== false
    return current
      ? S('proposal_ready', 'A plan is ready to review', 'Review the proposed work for the rest of this week. Nothing is added until you accept it.', { label: 'Review the plan', href: REVIEW_PLAN_HREF, kind: 'preview' }, { draft: { id: f.draft.id, revision: f.draft.revision } })
      : S('proposal_stale', 'The plan needs rebuilding', 'Your week or setup changed after this plan was prepared, so it can no longer be accepted.', { label: 'Rebuild the plan', href: REVIEW_PLAN_HREF, kind: 'preview' }, { draft: { id: f.draft.id, revision: f.draft.revision } })
  }
  if (f.acceptedBy === 'weekly_review' || (f.discardedFingerprint && f.discardedFingerprint === f.currentHash)) {
    return S('intentionally_empty', 'This week is empty on purpose', 'You kept this week empty. You can still review a plan for the rest of it whenever you like.', { label: 'Review a plan for this week', href: REVIEW_PLAN_HREF, kind: 'preview' })
  }
  return S('ready_to_plan', 'Review a plan for this week', 'Your study times are saved. Roadmap can propose work for the rest of this week; nothing is added until you accept it.', { label: 'Review a plan for this week', href: REVIEW_PLAN_HREF, kind: 'preview' })
}
