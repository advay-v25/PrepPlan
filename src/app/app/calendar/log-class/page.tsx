import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { getClassLogCatalog, getClassLogContext } from '../../../../lib/planning/classlog/service'
import { ClassLogForm } from '../../../../components/calendar/ClassLogForm'

export const dynamic = 'force-dynamic'

/** Log what a class covered. A pure read until the student confirms a previewed plan. */
export default async function LogClassPage({ searchParams }: { searchParams: Promise<{ reading?: string }> }) {
  const { reading } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/calendar/log-class')

  const ctx = await getClassLogContext(user.id)

  return (
    <div className="page-content calendar-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/calendar">Calendar</Link> / Log a class</nav>
      <h1>Log what you covered in class</h1>
      {!ctx.classLed ? (
        <p>Class logging is for students with a class schedule. Add your classes in <Link href="/app/settings">Settings</Link>.</p>
      ) : !ctx.cycle ? (
        <p>There is no open week yet. <Link href="/app/calendar">Prepare your week in Calendar</Link> first.</p>
      ) : ctx.classDates.length === 0 ? (
        <p>No class day in this cycle has happened yet. Come back after your next class.</p>
      ) : (
        <>
          <p>Pick the readings and outcomes your class covered, and how much of each. Your Calendar then plans the rest of your week around it.
            Nothing is added until you confirm.</p>
          {ctx.pendingDates.length > 0 && <p className="note">Not logged yet: {ctx.pendingDates.join(', ')}</p>}
          <ClassLogForm
            catalog={await getClassLogCatalog()}
            classDates={ctx.classDates}
            defaultDate={ctx.pendingDates[ctx.pendingDates.length - 1] ?? ctx.classDates[ctx.classDates.length - 1]}
            initialReadingId={reading ?? null}
          />
        </>
      )}
    </div>
  )
}
