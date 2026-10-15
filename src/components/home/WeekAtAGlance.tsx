import Link from 'next/link'
import type { CalendarEntry, CalendarWeekData } from '../../lib/planning/calendarData'
import type { StudyWeek } from '../../lib/planning/studyWeek'

function parts(dateLocal: string) {
  const [y, m, d] = dateLocal.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: d,
  }
}

function clock(min: number | null) {
  if (min == null) return null
  const h = Math.floor(min / 60), mm = min % 60
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}

const DONE = ['completed', 'skipped']

/**
 * The week, as a compact agenda: the same loadCalendarWeek data Calendar renders, so it can never
 * disagree with it. Classes and commitments show even before a week of study is accepted; the
 * last day of the cycle is always the paper day (Sunday for self-study, the day before a class
 * for class-led weeks).
 */
export function WeekAtAGlance({ week, today, data, accepted }: {
  week: StudyWeek; today: string; data: CalendarWeekData; accepted: boolean
}) {
  return (
    <section className="home-card week-cal" aria-labelledby="week-cal-h">
      <header className="home-card__head">
        <h2 id="week-cal-h">This week</h2>
        <Link href={`/app/calendar?week=${week.startDate}`} className="text-button">Calendar &rarr;</Link>
      </header>
      {!accepted && <p className="week-cal__note">No study is placed yet — review your proposed week to fill it.</p>}
      <ol className="week-cal__days">
        {week.days.map(date => {
          const { weekday, day } = parts(date)
          const items: CalendarEntry[] = data.byDate[date] ?? []
          const tasks = items.filter(e => e.isTask)
          const isPaper = date === week.endDate || tasks.some(e => e.taskType === 'diagnostic')
          const past = date < today
          const allDone = tasks.length > 0 && tasks.every(e => DONE.includes(e.execution ?? ''))
          const state = date === today ? 'today' : past ? (tasks.length === 0 ? 'past' : allDone ? 'done' : 'missed') : 'future'
          const shown = items.slice(0, 2)
          return (
            <li key={date} className={`week-cal__day is-${state} ${isPaper ? 'is-paper' : ''}`}>
              <div className="week-cal__date">
                <span>{weekday}</span>
                <strong>{day}</strong>
              </div>
              <div className="week-cal__items">
                {shown.length === 0 && !isPaper && <span className="week-cal__free">{past ? '—' : 'Free'}</span>}
                {isPaper && !tasks.some(e => e.taskType === 'diagnostic') && (
                  <span className="week-cal__item layer-diagnostic"><i aria-hidden /> Weekly paper</span>
                )}
                {shown.map(e => (
                  <span key={e.id} className={`week-cal__item layer-${e.layer} ${DONE.includes(e.execution ?? '') ? 'is-complete' : ''}`}>
                    <i aria-hidden />
                    <span className="week-cal__title">{e.title}</span>
                    {e.kind === 'timed' && <span className="week-cal__time">{clock(e.startMinutes)}</span>}
                  </span>
                ))}
                {items.length > shown.length && <span className="week-cal__more">+{items.length - shown.length} more</span>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
