import type { ForecastDay, Reserved } from '../../exam/runwayForecast'
import { packWhole, type Gap } from '../pulse/gaps'
import { nextSitting, SPLITTABLE } from '../weeklyReview/composer'
import { addDays } from '../studyWeek'
import type { NewStudy } from './firstPass'

/**
 * Can the owed work still be caught up in the usable time before the mock runway? (pure). Booked work has its time first, then demands the Roadmap will
 * make but the student has not accepted yet (revision and weekly papers, labelled provisional), then each piece of owed work once: study and revision
 * across sittings, a check or repair whole and within the sitting limit. New first-pass study comes last, in the Roadmap's order and under the daily
 * limit on new learning, so it can show a trade-off but never changes whether what is owed fits.
 */
export type OwedPiece = { title: string; minutes: number; taskType: string }
export type Provisional = { /** First day of each week that has no accepted plan yet. */ weeks: string[]; revisionPerWeek: number; paperMinutes: number }
export type FitResult = { fits: boolean; /** The week (1 = the first) by which everything owed is placed; null when it does not all fit. */ weeksToClear: number | null; unplacedMinutes: number; unplaced: { title: string; minutes: number; reason: string }[] }
/** New study to forecast: the named pieces, the daily limit, and anything the student's accepted path keeps out (said, not counted). */
export type NewStudyInput = { items: NewStudy[]; dailyMinutes: number; notCounted?: { minutes: number; reason: string } | null; studyFrom?: string | null }
export type Forecast = {
  /** New first-pass study asked for, what of it found room and what would wait, named. */
  newStudy: { minutes: number; placed: number; waiting: { title: string; minutes: number }[] }
  revisionPlaced: number; revisionWaiting: number; paperPlaced: number; paperWaiting: number
  /** New study that would still wait if revision were paused instead. */
  newStudyWaitingWithoutRevision: number
}
export type CatchUpFit = {
  /** What the unaccepted work does under the student's path. Absent only on values built by hand. */
  forecast?: Forecast; notCounted?: { minutes: number; reason: string } | null; /** Broad study resumes on this day, after an accepted mock-led week. */ studyFrom?: string | null; /** Revision waits until the owed work clears, as the student chose. */ revisionHeld?: boolean; /** Last day counted. */ until?: string
  /** Usable minutes after commitments, bookings and accepted work. */ usableMinutes: number; weeks: number
  /** Provisional minutes that actually found room, by kind. */ provisional: { revision: number; paper: number }
  all: FitResult; withoutProvisional: FitResult; withoutRevision: FitResult
}

export function catchUpFit(days: ForecastDay[], reserved: Reserved[], owed: OwedPiece[], provisional: Provisional, maxSitting: number, newStudy: NewStudyInput = { items: [], dailyMinutes: 0 }, /** The accepted path: revision waits until the owed work clears. */ revisionAfterOwed = false): CatchUpFit {
  const run = (use: { revision: boolean; paper: boolean }, held = false) => {
    const gaps = new Map<string, Gap[]>(days.map(d => [d.date, d.gaps.map(g => ({ ...g }))]))
    /** Packs a splittable need over the given days; returns what is left and the last week used. */
    const spread = (minutes: number, on: ForecastDay[]) => {
      let need = minutes, week = 0
      for (const d of on) {
        for (let i = 0; need > 0 && i < gaps.get(d.date)!.length;) {
          const g = gaps.get(d.date)![i], take = nextSitting(need, g.end - g.start, maxSitting)
          if (!take) { i++; continue }
          gaps.set(d.date, gaps.get(d.date)!.map((x, k) => k === i ? { start: x.start + take, end: x.end } : x)); need -= take; week = d.week
        }
        if (need <= 0) break
      }
      return { need, week }
    }
    for (const r of reserved) spread(r.minutes, days.filter(d => !r.notBefore || d.date >= r.notBefore))
    const usedProvisional = { revision: 0, paper: 0 }, waitingProvisional = { revision: 0, paper: 0 }
    const placeRevision = (start: string) => {
      const left = spread(provisional.revisionPerWeek, days.filter(d => d.date >= start && d.date <= addDays(start, 6))).need
      usedProvisional.revision += provisional.revisionPerWeek - left; waitingProvisional.revision += left
    }
    for (const start of provisional.weeks) {
      // A weekly paper sits on the week's last day; it only competes when that day is also a study day.
      const paperDay = days.find(d => d.date === addDays(start, 6))
      if (use.paper && paperDay && provisional.paperMinutes > 0) {
        const next = packWhole(gaps.get(paperDay.date)!, provisional.paperMinutes)
        if (next) { gaps.set(paperDay.date, next); usedProvisional.paper += provisional.paperMinutes }
        else waitingProvisional.paper += provisional.paperMinutes
      }
      if (use.revision && !held && provisional.revisionPerWeek > 0) placeRevision(start)
    }
    const unplaced: FitResult['unplaced'] = []
    let last = 0
    for (const piece of owed) {
      if (piece.minutes <= 0) continue
      if (SPLITTABLE.includes(piece.taskType)) {
        const r = spread(piece.minutes, days); last = Math.max(last, r.week)
        if (r.need > 0) unplaced.push({ title: piece.title, minutes: r.need, reason: 'No usable opening is left for it.' })
        continue
      }
      const day = piece.minutes <= maxSitting ? days.find(d => packWhole(gaps.get(d.date)!, piece.minutes)) : undefined
      if (!day) { unplaced.push({ title: piece.title, minutes: piece.minutes, reason: piece.minutes > maxSitting ? `It is done in one sitting of ${piece.minutes} minutes, longer than your ${maxSitting}-minute study sitting.` : `No single ${piece.minutes}-minute opening is left for it.` }); continue }
      gaps.set(day.date, packWhole(gaps.get(day.date)!, piece.minutes)!); last = Math.max(last, day.week)
    }
    const unplacedMinutes = unplaced.reduce((n, x) => n + x.minutes, 0)
    // Held revision returns only in weeks that start after everything owed has cleared.
    if (use.revision && held && provisional.revisionPerWeek > 0) {
      const cleared = unplacedMinutes ? null : days.filter(d => d.week <= last).at(-1)?.date ?? ''
      for (const start of provisional.weeks) if (cleared !== null && start > cleared) placeRevision(start)
    }
    // New study last, in order: a reading never starts before the one ahead of it, and once one cannot finish the rest wait behind it.
    const study = { minutes: 0, placed: 0, waiting: [] as { title: string; minutes: number }[] }
    const used = new Map<string, number>()
    let cursor = '', blocked = false
    for (const item of newStudy.items) {
      let need = item.minutes
      study.minutes += item.minutes
      for (const d of blocked ? [] : days) {
        if (need <= 0) break
        if (d.date < cursor || (item.notBefore && d.date < item.notBefore)) continue
        for (let i = 0; need > 0 && i < gaps.get(d.date)!.length;) {
          const g = gaps.get(d.date)![i], room = newStudy.dailyMinutes - (used.get(d.date) ?? 0), take = nextSitting(need, Math.min(g.end - g.start, room), maxSitting)
          if (!take) { i++; continue }
          gaps.set(d.date, gaps.get(d.date)!.map((x, k) => k === i ? { start: x.start + take, end: x.end } : x)); used.set(d.date, (used.get(d.date) ?? 0) + take); need -= take; cursor = d.date
        }
      }
      study.placed += item.minutes - need
      if (need > 0) { blocked = true; study.waiting.push({ title: item.title, minutes: need }) }
    }
    return { result: { fits: unplacedMinutes === 0, weeksToClear: unplacedMinutes === 0 ? last : null, unplacedMinutes, unplaced } satisfies FitResult, usedProvisional, waitingProvisional, study }
  }
  const all = run({ revision: true, paper: true })
  const path = revisionAfterOwed ? run({ revision: true, paper: true }, true) : all
  const sumWaiting = (l: { minutes: number }[]) => l.reduce((n, x) => n + x.minutes, 0)
  return {
    forecast: { newStudy: path.study, revisionPlaced: path.usedProvisional.revision, revisionWaiting: path.waitingProvisional.revision, paperPlaced: path.usedProvisional.paper, paperWaiting: path.waitingProvisional.paper,
      newStudyWaitingWithoutRevision: sumWaiting(run({ revision: false, paper: true }).study.waiting) },
    notCounted: newStudy.notCounted ?? null, studyFrom: newStudy.studyFrom ?? null, revisionHeld: revisionAfterOwed, until: days.at(-1)?.date,
    usableMinutes: days.reduce((n, d) => n + d.gaps.reduce((m, g) => m + (g.end - g.start >= 15 ? g.end - g.start : 0), 0), 0),
    weeks: new Set(days.map(d => d.week)).size, provisional: all.usedProvisional,
    all: all.result, withoutProvisional: run({ revision: false, paper: false }).result, withoutRevision: run({ revision: false, paper: true }).result,
  }
}
