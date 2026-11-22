import { comparable, describeScore, DIFFICULTIES, type Difficulty, type MockReport, type Scale } from './report'

/**
 * The debrief (pure): facts separated from hypotheses. Every finding names its SOURCE (always the student's own report here), the SCOPE it supports,
 * its UNCERTAINTY and what it means for PLANNING. Nothing here is demonstrated understanding: no concept verdicts, no repair closure, no pass talk.
 * Notes are the student's data and are never interpreted.
 */
export type Finding = {
  id: string
  kind: 'overall' | 'topic' | 'timing' | 'answer_changes' | 'calculation' | 'knowledge' | 'plateau' | 'high_with_gaps'
  source: 'your report'
  /** What the report supports, in plain words. */
  fact: string
  /** What it does NOT show. */
  uncertainty: string
  /** What it can do for planning. */
  implication: string
  /** The planning activity this can drive, if any. */
  activity?: 'review' | 'pacing' | 'answer_change'
  /** Subjects the student's own topic results point at; they still choose the readings. */
  topicIds?: string[]
  needsSelection?: boolean
}
export type Debrief = { findings: Finding[]; question: string | null; limits: string[]; comparison: { ok: boolean; message: string } | null }

const pctLike = (s: Scale) => s === 'percent' || s === 'percentile'

export function buildDebrief(report: MockReport, topicName: (id: string) => string, earlier: MockReport[] = []): Debrief {
  const f: Finding[] = []
  const topicValue = (t: MockReport['topics'][number]) => (t.scale === 'marks' ? `${t.value} of ${t.max} marks` : t.scale === 'percent' ? `${t.value}%` : t.scale === 'percentile' ? `${t.value}th percentile` : `${t.value} (type not stated)`)
  const partial = report.scope === 'partial'
  f.push({
    id: 'overall', kind: 'overall', source: 'your report', activity: undefined,
    fact: `${partial ? 'A partial exam' : 'A mock'}${report.provider ? ` from ${report.provider}` : ''} on ${report.takenOn}: ${describeScore(report.score, report.scale, report.scoreMax)}.`,
    uncertainty: `An overall result does not show which concepts were weak${partial ? ', and a partial exam says nothing about the parts it did not cover' : ''}. It is not test evidence in Roadmap.`,
    implication: report.score === null ? 'Add what you remember, or use the concerns below, so the plan has something to work from.' : 'It is context for planning. It does not create a diagnosis or close any repair.',
  })
  const withTopics = report.topics.filter(t => t.value >= 0)
  if (withTopics.length) {
    f.push({
      id: 'topics', kind: 'topic', source: 'your report', activity: 'review', needsSelection: true, topicIds: withTopics.map(t => t.topicId),
      fact: `You reported ${withTopics.map(t => `${topicName(t.topicId)} ${topicValue(t)}`).join('; ')}.`,
      uncertainty: 'A subject result does not show which readings or outcomes were the problem, and the subjects do not have to add up to the overall result. Not every reading in a subject is assumed weak.',
      implication: 'Choose the readings or outcomes you think were behind it for a bounded targeted review. Nothing is chosen for you.',
    })
  }
  const d = new Set<Difficulty>(report.difficulties)
  if (d.has('ran_out_of_time') || d.has('rushed_omissions')) f.push({
    id: 'timing', kind: 'timing', source: 'your report', activity: 'pacing',
    fact: `You reported: ${[d.has('ran_out_of_time') && DIFFICULTIES.ran_out_of_time, d.has('rushed_omissions') && DIFFICULTIES.rushed_omissions].filter(Boolean).join('; ')}.`,
    uncertainty: 'Running out of time does not mean the material was not understood. Roadmap cannot tell, from this, whether it was pacing, knowledge or both.',
    implication: 'A pacing and application activity: timed work on material you already know, with a note of where the time went.',
  })
  if (d.has('changed_right_to_wrong')) f.push({
    id: 'answer_changes', kind: 'answer_changes', source: 'your report', activity: 'answer_change',
    fact: 'You reported changing answers that were right into wrong ones.',
    uncertainty: 'One mock does not show a pattern, and there is no universal rule about changing answers.',
    implication: 'An activity to record WHY you change an answer when you do, and review what you notice. It does not tell you never to change answers.',
  })
  if (d.has('calculation_errors') || d.has('misread_questions')) f.push({
    id: 'calculation', kind: 'calculation', source: 'your report', activity: 'pacing',
    fact: `You reported: ${[d.has('calculation_errors') && DIFFICULTIES.calculation_errors, d.has('misread_questions') && DIFFICULTIES.misread_questions].filter(Boolean).join('; ')}.`,
    uncertainty: 'Slips are not the same as not understanding the concept.',
    implication: 'Practice matching the error type, then a later check of whether it improved.',
  })
  if (d.has('knowledge_gaps')) f.push({
    id: 'knowledge', kind: 'knowledge', source: 'your report', activity: 'review', needsSelection: true,
    fact: 'You reported not knowing some of the material.',
    uncertainty: 'This is your own impression; it does not say which outcomes.',
    implication: 'Choose the readings you have in mind for a targeted review. Roadmap only proposes what you select.',
  })
  if (report.score !== null && pctLike(report.scale) && report.score >= 70 && withTopics.some(t => pctLike(t.scale) && t.scale === report.scale && t.value < report.score! - 10)) f.push({
    id: 'high_with_gaps', kind: 'high_with_gaps', source: 'your report',
    fact: 'Your overall result was relatively high, with some subject results well below it.',
    uncertainty: 'These are your own figures on one mock.',
    implication: 'Keep your broader maintenance and target only the subjects you reported low; do not rebuild a whole programme.',
  })

  let comparison: Debrief['comparison'] = null
  const prior = earlier.filter(r => r.id !== report.id && r.status === 'active' && r.takenOn < report.takenOn).sort((a, b) => b.takenOn.localeCompare(a.takenOn))[0]
  if (prior) {
    const c = comparable(prior, report)
    comparison = c.ok
      ? { ok: true, message: `Compared with your ${prior.takenOn} report (same score type, scope and source): ${describeScore(prior.score, prior.scale, prior.scoreMax)} then, ${describeScore(report.score, report.scale, report.scoreMax)} now. Two reports are a comparison, not a trend, and scope, timing and how consistently you followed the plan matter more than the number.` }
      : { ok: false, message: `These two reports are not comparable (${c.reasons.join('; ')}), so no change or trend is shown. Compare scope, scale, source, timing and how much of the plan you completed first.` }
    if (c.ok) f.push({ id: 'plateau', kind: 'plateau', source: 'your report', fact: comparison.message, uncertainty: 'A flat or falling pair of results has many possible causes.', implication: 'Before adding any work, look at what you completed and what the mock covered.' })
  }
  const asks = !withTopics.length && !d.size && report.score !== null
  const question = asks ? 'Only an overall result is recorded. Is there one thing you remember going wrong (running out of time, certain subjects, careless slips)? Add it, or take an optional mixed check if one is available.' : null
  return {
    findings: f, question, comparison,
    limits: ['Everything above is your own report. It guides planning; it is not demonstrated understanding and it closes nothing.', ...(partial ? ['A partial exam is not treated as a full mock.'] : [])],
  }
}
