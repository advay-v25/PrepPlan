import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '../../../../../lib/supabase/server'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { getClassLogCatalog } from '../../../../../lib/planning/classlog/service'
import { buildDebrief } from '../../../../../lib/mocks/debrief'
import { describeScore } from '../../../../../lib/mocks/report'
import { getReport, listReports } from '../../../../../lib/mocks/reportService'
import { recoveryRemainder } from '../../../../../lib/mocks/recovery'
import { sittingCeiling } from '../../../../../lib/planning/classlog/consolidation'
import { MockRecoveryPanel } from '../../../../../components/calendar/MockRecoveryPanel'
import { MockReportActions } from '../../../../../components/calendar/MockReportActions'

export const metadata = { title: 'Mock report' }

export const dynamic = 'force-dynamic'

/** The saved report, its debrief (facts apart from hypotheses) and the reviewed recovery plan. Owner-checked: a foreign or missing id is a 404. */
export default async function MockReportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ plan?: string }> }) {
  const { id } = await params
  const { plan } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/calendar/mock-report/${id}`)
  const report = await getReport(user.id, id)
  if (!report) notFound()
  const admin = createAdminClient()
  const [{ data: topics }, earlier, { data: profile }, catalog, remainder, tasks] = await Promise.all([
    admin.from('topics').select('id, name'), listReports(user.id), admin.from('profiles').select('max_session_minutes').eq('id', user.id).maybeSingle(),
    getClassLogCatalog(), recoveryRemainder(user.id, report),
    admin.from('plan_blocks').select('id, title, local_date, execution, duration_minutes, source_report_version').eq('user_id', user.id).eq('source_report_id', id).is('cancelled_at', null).order('local_date'),
  ])
  const name = new Map((topics ?? []).map(t => [t.id as string, t.name as string]))
  const debrief = buildDebrief(report, i => name.get(i) ?? 'that subject', earlier)
  const stale = (tasks.data ?? []).some(t => t.source_report_version !== report.version)
  return (
    <div className="page-content calendar-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/calendar">Calendar</Link> / Mock report</nav>
      <h1>Your mock report{report.status === 'withdrawn' ? ' (withdrawn)' : ''}</h1>
      <p data-testid="report-summary">{report.takenOn} · {report.scope === 'full' ? 'Full mock' : 'Partial exam'}{report.provider ? ` · ${report.provider}` : ''} · {describeScore(report.score, report.scale, report.scoreMax)} <small className="muted">(your own report, version {report.version})</small></p>
      <p><Link href={`/app/coach?report=${report.id}&q=${encodeURIComponent('How should I work on this mock report?')}`} className="secondary-button" data-testid="report-ask-coach">Ask the Coach about this report</Link></p>
      {report.status === 'active' && <MockReportActions reportId={report.id} version={report.version} planned={(tasks.data ?? []).length} unplacedMinutes={remainder.reduce((n, x) => n + x.minutes - x.allocated, 0)} />}
      <section aria-labelledby="debrief-h" data-testid="debrief">
        <h2 id="debrief-h">What this does and does not tell us</h2>
        <ul>{debrief.findings.map(f => (
          <li key={f.id} data-finding={f.id}>
            <strong>{f.fact}</strong>
            <br /><small><em>Source:</em> {f.source}. <em>Not shown:</em> {f.uncertainty}</small>
            <br /><small><em>For planning:</em> {f.implication}</small>
          </li>
        ))}</ul>
        {debrief.comparison && <p className="note" data-testid="comparison">{debrief.comparison.message}</p>}
        {debrief.question && <p className="note" data-testid="debrief-question">{debrief.question}</p>}
        {debrief.limits.map(l => <p key={l} className="muted">{l}</p>)}
      </section>
      {stale && <p role="status" className="note" data-testid="report-edited-note">This report was edited after some of the work below was planned. Your accepted sittings are unchanged; review a new plan if you want them to follow the edit.</p>}
      {(tasks.data ?? []).length > 0 && (
        <section aria-labelledby="planned-h"><h2 id="planned-h">Planned from this report</h2>
          <ul>{(tasks.data ?? []).map(t => <li key={t.id as string}><Link href={`/app/calendar?week=${t.local_date}&view=agenda&task=${t.id}`}>{t.title as string}</Link> · {t.local_date as string} · {t.duration_minutes as number} min · {t.execution as string}</li>)}</ul>
        </section>
      )}
      {report.status === 'active'
        ? <MockRecoveryPanel reportId={report.id} version={report.version} debrief={debrief} catalog={catalog} maxSitting={sittingCeiling((profile?.max_session_minutes as number | null) ?? null)} remainder={remainder} defaultSelection={report.planSelection} autoPlan={plan === 'left'} />
        : <p>A withdrawn report cannot be used to plan new work. Sittings already planned from it stay in your Calendar.</p>}
    </div>
  )
}
