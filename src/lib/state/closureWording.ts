import type { ClosureSummary } from './types'

/** The canonical weekly-review gate, in the words Home uses. `reason` is the gate's own reason where it has one. */
export function closureFromGate(gate: { kind: string; reason?: string; reportedResult?: string | null; completedOn?: string }): ClosureSummary {
  switch (gate.kind) {
    case 'paper_scored': return { gate: 'paper_scored', canClose: true, label: 'Your weekly paper is scored', reason: 'The week can be reviewed and closed.' }
    case 'external_mock': return { gate: 'external_mock', canClose: true, label: 'You recorded your mock', reason: `Your external mock${gate.reportedResult ? ` (${gate.reportedResult})` : ''} closes the week without a weekly paper.` }
    case 'rehearsal': return { gate: 'rehearsal', canClose: true, label: 'Your rehearsal is finished', reason: `Both rehearsal sessions were completed${gate.completedOn ? ` on ${gate.completedOn}` : ''}, which closes the week without a weekly paper.` }
    case 'no_paper_allowed': return { gate: 'no_paper_allowed', canClose: true, label: 'You can close this week without a paper', reason: gate.reason ?? 'No paper can be assembled this week.' }
    case 'mock_pending': return { gate: 'mock_pending', canClose: false, label: 'Record what happened to your mock', reason: gate.reason ?? 'You chose your mock as this week’s assessment.' }
    case 'paper_pending': return { gate: 'paper_pending', canClose: false, label: 'Your weekly paper comes first', reason: gate.reason ?? 'Take the paper, then close the week.' }
    default: return { gate: 'not_ready', canClose: false, label: 'The week is not ready to close', reason: gate.reason ?? 'The review opens once the assessment is done, or on the last day.' }
  }
}
