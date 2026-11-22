import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { todayInZone } from '../../../../lib/planning/studyWeek'
import { getReport, listUnstructuredOutcomes } from '../../../../lib/mocks/reportService'
import { MockReportForm } from '../../../../components/calendar/MockReportForm'

export const metadata = { title: 'Record a mock result' }

export const dynamic = 'force-dynamic'

/** Record a mock already taken. A pure read until the student saves; no booking is needed or created. */
export default async function MockReportPage({ searchParams }: { searchParams: Promise<{ edit?: string; from?: string }> }) {
  const { edit, from } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/calendar/mock-report')
  const admin = createAdminClient()
  const [{ data: profile }, { data: topics }, initial, legacyAll] = await Promise.all([
    admin.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
    admin.from('topics').select('id, name, default_sequence').order('default_sequence'),
    edit ? getReport(user.id, edit) : Promise.resolve(null),
    from ? listUnstructuredOutcomes(user.id) : Promise.resolve([]),
  ])
  const legacy = from ? legacyAll.find(l => l.id === from) ?? null : null
  const today = todayInZone((profile?.timezone as string | null) ?? 'UTC')
  return (
    <div className="page-content calendar-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/calendar">Calendar</Link> / {initial ? 'Edit a mock report' : 'Record a mock already taken'}</nav>
      <h1>{initial ? 'Edit your mock report' : 'Record a mock you have already taken'}</h1>
      {edit && !initial ? <p>That report was not found. <Link href="/app/calendar">Back to Calendar</Link></p>
        : initial && initial.status === 'withdrawn' ? <p>That report was withdrawn and cannot be edited.</p>
        : <>
          <p>Tell us how it went, as much or as little as you know. You do not need to plan or book anything first, and you do not need a PDF.</p>
          <MockReportForm subjects={(topics ?? []).map(t => ({ id: t.id as string, name: t.name as string }))} today={today} initial={initial}
            legacy={legacy ? { id: legacy.id, text: [legacy.reportedResult, legacy.notes].filter(Boolean).join(' · ') || 'No text recorded' } : null} />
        </>}
    </div>
  )
}
