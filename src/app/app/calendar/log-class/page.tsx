import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { getClassLogCatalog, getClassLogContext, getClassLogWeek, getSavedClassLog, loadOutcomes } from '../../../../lib/planning/classlog/service'
import { todayInZone } from '../../../../lib/planning/studyWeek'
import { ClassLogForm } from '../../../../components/calendar/ClassLogForm'

export const metadata = { title: 'Log a class' }

export const dynamic = 'force-dynamic'

/** Log what a class covered. A pure read until the student confirms a previewed plan. */
export default async function LogClassPage({ searchParams }: { searchParams: Promise<{ reading?: string; session?: string; occurrence?: string; from?: string }> }) {
  const { reading, session, occurrence, from } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/calendar/log-class')

  const saved = typeof session === 'string' ? await getSavedClassLog(user.id, session) : null
  const ctx = session === undefined ? await getClassLogContext(user.id) : null
  const classCtx = ctx?.classLed ? ctx : null
  const cycle = saved ? await getClassLogWeek(user.id) : classCtx?.cycle
  const selected = saved?.occurrence ?? classCtx?.occurrences.find(o => o.key === occurrence && o.status !== 'legacy')
  const unavailable = (session !== undefined && !saved) || (occurrence !== undefined && !selected)
  const returnHref = from === 'review' ? '/app/review-week' : '/app/calendar'
  const backLabel = from === 'review' ? 'Weekly review' : 'Calendar'
  const outcomes = saved && !cycle ? await loadOutcomes(saved.session.items.map(i => i.outcomeId)) : null

  return (
    <div className="page-content calendar-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href={returnHref}>{backLabel}</Link> / Log a class</nav>
      <h1>{selected?.sessionId ? selected.label : 'Log what you covered in class'}</h1>
      {unavailable ? (
        <p role="status">This class report is unavailable. <Link href={returnHref}>Return to {backLabel}</Link>.</p>
      ) : !saved && !classCtx ? (
        <p>Class logging is for students with a class schedule. Add your classes in <Link href="/app/settings">Settings</Link>.</p>
      ) : !cycle ? (
        <>
          {saved && <section aria-label="Saved class report">
            <p>{saved.session.classDate} · {saved.session.completed ? 'Finished log' : 'Saved and still open'}</p>
            {saved.session.items.length === 0 ? <p>No coverage reported.</p> : <ul>{saved.session.items.map(item => (
              <li key={item.outcomeId}>{outcomes?.get(item.outcomeId)?.title ?? item.outcomeId} · {item.extent === 'full' ? 'All of it' : 'Partly reported'}{item.portionNote ? ` · ${item.portionNote}` : ''}</li>
            ))}</ul>}
          </section>}
          <p>There is no open study week. <Link href="/app/calendar">Prepare your week in Calendar</Link> to plan follow-up.</p>
        </>
      ) : (
        <>
          <p>{saved ? 'Review or correct the coverage you recorded. Follow-up can be planned in the open study week.'
            : 'Choose what this class covered. Review the proposed follow-up before adding it to Calendar.'}</p>
          <ClassLogForm
            catalog={await getClassLogCatalog()}
            occurrences={saved ? [saved.occurrence] : classCtx?.occurrences ?? []}
            sessions={saved ? [saved.session] : classCtx?.sessions ?? []}
            cycleStart={cycle.startsAt}
            today={classCtx?.today ?? todayInZone(cycle.timezone)}
            selectedKey={selected?.key}
            fixedSession={Boolean(saved)}
            returnHref={from === 'review' ? returnHref : undefined}
            initialReadingId={reading ?? null}
          />
        </>
      )}
    </div>
  )
}
