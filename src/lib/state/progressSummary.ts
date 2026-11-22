import { evidenceAgeInDays, type Signals } from '../signals/signals'

/**
 * The four preparation signals as short, separate statements for Home. Coverage the student reports, work they logged, what a valid paper
 * demonstrates and how well confidence tracks accuracy never merge. Wording says how much evidence there is; it never falls back to
 * "No tests yet" once a paper has been scored.
 */
export type SignalLine = { label: string; value: string; detail: string; href: string; tone: 'neutral' | 'warn' }

export function coverageLine(s: Signals): SignalLine {
  const readings = s.position.readings
  const complete = readings.total > 0 && readings.covered === readings.total
  const value = readings.total === 0 ? 'Not loaded' : complete
    ? `First pass recorded complete · ${readings.total} readings in revision rotation`
    : `${readings.covered} of ${readings.total} readings recorded as covered${readings.partial ? ` · ${readings.partial} partly` : ''}`
  const { whole, partial } = s.position
  const logged = whole || partial
  const parts = [whole ? `${whole} whole outcome${whole === 1 ? '' : 's'} confirmed from logged work` : '', partial ? `${partial} only partly covered` : ''].filter(Boolean).join('; ')
  return {
    label: 'Coverage', value, tone: readings.total === 0 ? 'warn' : 'neutral', href: '/app/curriculum?view=readiness',
    detail: `${logged ? `From logged work: ${parts}.` : 'Nothing is confirmed from logged work yet.'} Tests track understanding separately.`,
  }
}

export function understandingLine(s: Signals, today: string, timezone = 'UTC'): SignalLine {
  const u = s.understanding
  const age = evidenceAgeInDays(u.latestEvidenceAt, today, timezone)
  const href = u.latestAttemptId ? `/app/tests/${u.latestAttemptId}/result` : '/app/tests'
  if (u.integrityWarning) return { label: 'Understanding', value: 'Evidence disputed', detail: u.integrityWarning, href, tone: 'warn' }
  if (u.band !== 'Insufficient evidence') return { label: 'Understanding', value: u.band, detail: `${u.scoredPapers} scored paper${u.scoredPapers === 1 ? '' : 's'} · ${u.readingsTested} reading${u.readingsTested === 1 ? '' : 's'} tested${age != null ? ` · latest ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}` : ''}.`, href, tone: 'neutral' }
  if (u.scoredPapers === 0) return { label: 'Understanding', value: 'No scored paper yet', detail: 'It moves only when a valid paper is scored.', href, tone: 'neutral' }
  if (!u.recent && age != null) return { label: 'Understanding', value: 'Evidence is out of date', detail: `Your latest evidence is ${age} days old. Recent evidence is needed before a band is shown.`, href, tone: 'warn' }
  return { label: 'Understanding', value: 'Too little evidence so far', detail: `${u.scoredPapers} scored paper${u.scoredPapers === 1 ? '' : 's'} across ${u.readingsTested} reading${u.readingsTested === 1 ? '' : 's'}. ${u.reasons[0] ?? ''}`.trim(), href, tone: 'neutral' }
}

export function calibrationLine(s: Signals): SignalLine & { percent: number | null; sample: number; sureSample: number } {
  const c = s.calibration
  // The percentage is "right when sure", so its denominator is the "sure" answers, not every marked answer.
  const sure = c.sureSample
  const enough = sure >= 5 && c.sureAccuracy != null
  return {
    label: 'Confidence', percent: enough ? Math.round(c.sureAccuracy! * 100) : null, sample: c.sample, sureSample: sure, tone: 'neutral', href: '/app/tests#signals-h',
    value: enough ? `${Math.round(c.sureAccuracy! * 100)}% right when sure` : sure > 0 ? `Too few "sure" answers (${sure})` : 'Too few answers',
    detail: enough
      ? `Based on ${sure} answers you marked "sure", out of ${c.sample} marked with confidence. ${c.reading}`
      : `${c.sample} answer${c.sample === 1 ? '' : 's'} marked with confidence, ${sure} of them "sure". At least 5 "sure" answers are needed before a percentage means anything.`,
  }
}

export function weekLine(s: Signals): SignalLine {
  const e = s.execution
  const unresolved = e.unreported
  return {
    label: 'This week', tone: unresolved > 0 ? 'warn' : 'neutral', href: '/app/calendar',
    value: e.total === 0 ? 'Nothing planned' : `${e.completed} of ${e.total} done`,
    detail: e.total === 0 ? 'No learning sessions are planned this week.' : `${e.partial} partly done · ${e.postponed} deferred · ${e.skipped} skipped · ${unresolved} unresolved.`,
  }
}
