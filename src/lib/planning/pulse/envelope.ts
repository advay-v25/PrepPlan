import type { CycleObservation } from '../cycleObservation'

/**
 * How big a week to propose, as a multiple of the even split of what is left. These are PLANNING ASSUMPTIONS,
 * not measurements of the student and not hours they must study. All limits live here.
 */
export const ADAPTATION = {
  /** The proposal when no finished week gives a reliable read, and after a break. */
  opening: 0.6,
  restart: 0.6,
  /** Never smaller than this from evidence, and never larger than the ceiling. Above 1 is optional extra work only. */
  floor: 0.5,
  ceiling: 1.15,
  /** How many of the latest usable weeks are read, newest weighted most. One week alone moves the proposal one small step. */
  window: 3,
  weights: [1, 0.7, 0.5],
  singleWeekStep: 0.15,
  /** A latest week this far from the others is damped, so one unusual week cannot define the student. */
  outlierGap: 0.4,
  /** Delivered share of accepted work (the proven part only) → proposed share of the even split. */
  bands: [{ from: 0.9, factor: 1.15 }, { from: 0.7, factor: 1.0 }, { from: 0.5, factor: 0.8 }, { from: 0.3, factor: 0.55 }, { from: 0, factor: 0.5 }],
  /** What "Make this draft lighter" multiplies the proposal by, and its own floor. */
  lighter: 0.75,
  lighterFloor: 0.4,
  /** A gap this long between the last closed week and the proposed one is treated as a break. */
  breakDays: 7,
} as const

export type AdaptationMode = 'opening' | 'steady' | 'lighter' | 'cautious_lighter' | 'cautious_stronger' | 'stronger' | 'restart'

export type Adaptation = {
  mode: AdaptationMode
  /** Multiple of the even split actually used. Above 1 only for optional extra work. */
  factor: number
  /** The part of it that is accepted work; the rest, if any, is optional extra. */
  committed: number
  headline: string
  reasons: string[]
  usedCycles: number
  /** Closed weeks that could not be read, so the student can see what was set aside. */
  setAside: { cycleId: string; why: string }[]
  lighter: boolean
}

const pct = (x: number) => `${Math.round(x * 100)}%`

export function adaptEnvelope(input: { observations: CycleObservation[]; afterBreak: boolean; lighter?: boolean }): Adaptation {
  const A = ADAPTATION
  const usable = input.observations.filter(o => o.quality === 'usable' && o.executionLow != null).slice(0, A.window)
  const setAside = input.observations.filter(o => o.quality !== 'usable').map(o => ({
    cycleId: o.cycleId, why: o.quality === 'empty' ? 'it had no accepted study work' : (o.reasons[0] ?? 'its records could not settle what happened').replace(/\.$/, ''),
  }))
  const reasons: string[] = []
  let mode: AdaptationMode, factor: number, headline: string

  if (input.afterBreak) {
    mode = 'restart'; factor = A.restart
    headline = 'A manageable restart after a break.'
    reasons.push('There was no study week just before this one, so the proposal starts light instead of picking up where an older week left off.')
  } else if (usable.length === 0) {
    mode = 'opening'; factor = A.opening
    headline = 'Standard opening load.'
    reasons.push(input.observations.length === 0
      ? 'No finished week gives a reliable read yet, so this uses the standard opening load.'
      : 'Your finished weeks could not be read reliably, so this uses the standard opening load.')
  } else {
    const rates = usable.map(o => o.executionLow as number)
    let w = A.weights.slice(0, usable.length).slice()
    if (usable.length >= 3) {
      const rest = rates.slice(1).sort((a, b) => a - b)
      const median = (rest[Math.floor((rest.length - 1) / 2)] + rest[Math.ceil((rest.length - 1) / 2)]) / 2
      if (Math.abs(rates[0] - median) > A.outlierGap) { w[0] *= 0.5; reasons.push('Your latest week differed a lot from the ones before it, so it counts for less.') }
    }
    const mean = rates.reduce((s, r, i) => s + r * w[i], 0) / w.reduce((s, x) => s + x, 0)
    if (usable.length === 1) {
      const r = rates[0]
      factor = r >= A.bands[0].from ? A.opening + A.singleWeekStep : r < 0.5 ? A.opening - A.singleWeekStep / 1.5 : A.opening
      mode = factor > A.opening ? 'cautious_stronger' : factor < A.opening ? 'cautious_lighter' : 'opening'
      headline = mode === 'cautious_lighter' ? 'A slightly lighter week, as a cautious step.' : mode === 'cautious_stronger' ? 'A slightly fuller week, as a cautious step.' : 'Standard opening load.'
      reasons.push(`One finished week is not a trend: ${pct(r)} of its accepted work is confirmed done, so the proposal moves only a small step.`)
    } else {
      factor = A.bands.find(b => mean >= b.from)!.factor
      mode = factor > 1 ? 'stronger' : factor >= 1 ? 'steady' : 'lighter'
      headline = mode === 'stronger' ? 'Recent weeks went well, so there is optional extra work.' : mode === 'steady' ? 'A steady week, in line with recent delivery.' : 'A lighter week, because recent weeks asked for more than was finished.'
      reasons.push(`Across your last ${usable.length} readable weeks, about ${pct(mean)} of accepted work is confirmed done.`)
    }
  }
  factor = Math.min(A.ceiling, Math.max(A.floor, factor))
  if (setAside.length > 0 && !input.afterBreak) reasons.push(`${setAside.length} finished week${setAside.length === 1 ? ' was' : 's were'} set aside: ${setAside.map(s => s.why).join('; ')}.`)
  if (input.lighter) {
    factor = Math.max(A.lighterFloor, Math.min(factor, 1) * A.lighter)
    reasons.push('You asked for a lighter draft, so the new work is reduced. What waits is listed below and returns in later weeks.')
  }
  reasons.push('This is a planning assumption, not a judgement of your ability. It does not show what you understand.')
  return { mode, factor: Number(factor.toFixed(3)), committed: Number(Math.min(1, factor).toFixed(3)), headline, reasons,
    usedCycles: usable.length, setAside, lighter: Boolean(input.lighter) }
}

/**
 * Divide what is left across the weeks left in the phase first, then scale: never multiply the whole remaining
 * effort by a factor, which would size one week as if it could absorb the phase.
 */
export function computeWeeklyEnvelope(input: { phaseRemainingEffort: number; usableWeeksRemainingInPhase: number; adaptation: Pick<Adaptation, 'factor' | 'committed'> }) {
  const evenSplit = input.phaseRemainingEffort / Math.max(1, input.usableWeeksRemainingInPhase)
  return { total: evenSplit * input.adaptation.factor, committed: evenSplit * input.adaptation.committed }
}
