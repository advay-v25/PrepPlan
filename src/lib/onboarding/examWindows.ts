/**
 * Which exam sittings a candidate can still aim for, and whether a booked date fits one.
 * One rule for the Exam screen, the page's window query and saveExam, so they cannot disagree.
 *
 * A sitting stays selectable until it has CLOSED: a candidate entering during an open sitting can still have
 * a booked date later in it. (The page used to require window_opens to be in the future, which hid that sitting.)
 */
export type SittingDates = { window_opens: string | null; window_closes: string | null }

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null)

export function isSelectableSitting(w: SittingDates, nowIso: string): boolean {
  // shortcut: a sitting without a closing date falls back to its opening date, tighten when every sitting is confirmed.
  const end = w.window_closes ?? w.window_opens
  return !!end && end > nowIso
}

/** Null when the booked date is acceptable; otherwise the field problem to show. `today` is the candidate's local date. */
export function bookedDateProblem(w: SittingDates & { sitting: string; year: number }, examDate: string, today: string): string | null {
  const opens = day(w.window_opens)
  if (opens && examDate.slice(0, 7) !== opens.slice(0, 7)) return `That date is not in the ${w.sitting[0].toUpperCase()}${w.sitting.slice(1)} ${w.year} sitting you chose.`
  if (examDate < today) return 'That date has already passed. Enter the date you are booked to sit.'
  return null
}
