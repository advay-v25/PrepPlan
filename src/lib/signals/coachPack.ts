import { getLosTracker } from '../curriculum/losTrackerService'
import { getPaperPreview } from '../tests/paperPreview'
import { getWeeklyPaperState } from '../tests/testsOverview'
import { getSignals } from './signals-loader'

/**
 * The evidence the Coach may speak from: compact, current, and honest about what is unknown.
 * It contains no answer keys, no question text and no internal identifiers beyond outcome ids the
 * student can see in Curriculum. The Coach may suggest; only the student confirms.
 */
export async function getCoachEvidencePack(userId: string, now = new Date(), tracker?: Awaited<ReturnType<typeof getLosTracker>>) {
  const [signals, trk, preview] = await Promise.all([getSignals(userId, now), tracker ?? getLosTracker(userId, now), getPaperPreview(userId, undefined, now)])
  const weekly = await getWeeklyPaperState(userId, preview)
  const rows = trk.topics.flatMap(t => t.modules.map(m => ({ m, subject: t.name })).flatMap(({ m, subject }) => m.rows.map(r => ({ ...r, reading: `Reading ${m.readingNo}: ${m.name}`, subject }))))
  const top = rows.filter(r => r.verdict === 'concept_miss' || r.verdict === 'known_gap').slice(0, 5)
    .map(r => ({ outcome: r.name, reading: r.reading, subject: r.subject, verdict: r.verdict, why: r.rationale }))
  const unknowns: string[] = []
  if (signals.understanding.band === 'Insufficient evidence') unknowns.push('Demonstrated understanding cannot be summarised yet: ' + signals.understanding.reasons.join(' '))
  if (preview.scope.unresolved.length) unknowns.push(`${preview.scope.unresolved.length} completed block(s) have not been tied to specific outcomes, so they are not in the paper.`)
  if (signals.execution.unreported) unknowns.push(`${signals.execution.unreported} planned block(s) are past their day with no status.`)
  return {
    signalsVersion: signals.version,
    understanding: { band: signals.understanding.band, reasons: signals.understanding.reasons },
    position: signals.position,
    execution: signals.execution,
    calibration: signals.calibration,
    paper: { state: weekly.primary.kind, kind: preview.paperKind, questions: preview.blueprint.totalQuestions, minutes: preview.blueprint.estimatedMinutes, limitation: preview.limitation },
    scope: { completedOutcomes: preview.scope.totals.outcomes, unresolvedBlocks: preview.scope.unresolved.length, excluded: preview.scope.excluded.map(e => e.reason) },
    topRepairs: top,
    unknowns,
    rules: [
      'Suggest changes; never claim to have changed the calendar or created a test.',
      'A completed block is activity, not understanding. Only scored test evidence shows understanding.',
      'A postponed or missed block is not a wrong answer.',
      'Do not teach content; point to the reading or outcome in Curriculum.',
    ],
  }
}
