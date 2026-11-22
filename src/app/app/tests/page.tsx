import { Suspense } from 'react'
import { PageLoading } from '../../../components/ui/PageLoading'
import Link from 'next/link'
import { AlertTriangle, FlaskConical } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { PURPOSE_LABELS, type AssessmentPurpose } from '../../../lib/diagnostic/blueprint'
import { getStudyWeekContext } from '../../../lib/planning/schedule'
import { getPaperPreview } from '../../../lib/tests/paperPreview'
import { getClassLogCatalog } from '../../../lib/planning/classlog/service'
import { ScopePanel } from '../../../components/tests/ScopePanel'
import { WeeklyPaperCard } from '../../../components/tests/WeeklyPaperCard'
import { PracticePanel, type PracticeCatalog } from '../../../components/tests/PracticePanel'
import { getWeeklyPaperState, getOtherAssessments } from '../../../lib/tests/testsOverview'
import { checkIsReviewer } from '../../../lib/diagnostic/reviewAccess'
import { Badge } from '../../../components/ui/Badge'
import { Notice } from '../../../components/ui/Notice'
import { getCheckpointView, listAppointments } from '../../../lib/planning/checkpointService'
import { decideRehearsal } from '../../../lib/rehearsal/service'
import { MockSchedule } from '../../../components/tests/MockSchedule'
import { checkpointTitle } from '../../../lib/curriculum/mockCheckpoint'
import { SectionFailed } from '../../../components/home/SectionFailed'
import { recordFailure } from '../../../lib/ops/routeFailure'

export const metadata = { title: 'Tests' }

export const dynamic = 'force-dynamic'

const VIEWS = ['week', 'practice', 'mocks'] as const
type View = typeof VIEWS[number]
const VIEW_LABEL: Record<View, string> = { week: 'This week', practice: 'Practice and checks', mocks: 'Mocks' }
const PAGE = 10
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))_([0-9a-f-]{36})$/i

type Search = { notice?: string; view?: string; reading?: string; los?: string; before?: string; mode?: string }

/** A link can select a view and a preview. It cannot authorise a paper, a baseline, held-out access or any write. */
export default function TestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return <Suspense fallback={<PageLoading message="Loading your tests…" />}><TestsContent searchParams={searchParams} /></Suspense>
}

async function TestsContent({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? sp.view as View : 'week'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="page-content"><p>Unauthorized</p></div>
  const isReviewer = await checkIsReviewer(user.id)
  const here = (v: View, extra = '') => `/app/tests${v === 'week' ? '' : `?view=${v}`}${extra}`

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <h1>Tests</h1>
          <p>Short checks of what you have learned, and what to do next.</p>
        </div>
        <div className="page-header__actions">
          <a href="#history" className="text-button">History</a>
          {isReviewer && <Link href="/app/tests/review" className="secondary-button"><FlaskConical size={15} /> Item review</Link>}
        </div>
      </header>

      <nav className="tests-tabs" aria-label="Tests views">
        {VIEWS.map(v => <Link key={v} href={here(v)} className={v === view ? 'is-active' : ''} aria-current={v === view ? 'page' : undefined}>{VIEW_LABEL[v]}</Link>)}
      </nav>

      {sp.notice === 'paper-unavailable' && <Notice tone="warn" role="status">That paper could not be found. Open one from your Tests history.</Notice>}

      {view === 'week' && <WeekView userId={user.id} />}
      {view === 'practice' && <PracticeView userId={user.id} reading={sp.reading} los={sp.los} mode={sp.mode} />}
      {view === 'mocks' && <MocksView userId={user.id} />}

      <History supabase={supabase} userId={user.id} view={view} before={sp.before} />
    </div>
  )
}

async function WeekView({ userId }: { userId: string }) {
  const admin = createAdminClient()
  try {
    const [{ data: sat }, studyWeek, preview, catalog, checkpoint, appointments] = await Promise.all([
      admin.from('exam_completion').select('sat_on').eq('user_id', userId).maybeSingle(),
      getStudyWeekContext(userId),
      getPaperPreview(userId),
      getClassLogCatalog(),
      getCheckpointView(userId).catch(() => null),
      listAppointments(userId).catch(() => [] as Awaited<ReturnType<typeof listAppointments>>),
    ])
    if (sat?.sat_on) {
      return <section className="weekly-card" aria-labelledby="weekly-h"><h2 id="weekly-h">You sat the exam</h2><p>You told us you sat the exam on {sat.sat_on as string}. Your results and notes stay here, and no new paper is planned.</p><p><Link className="secondary-button" href="/app/exam">Open the exam page</Link></p></section>
    }
    const state = await getWeeklyPaperState(userId, preview)
    const readingNames = new Map(catalog.flatMap(sub => sub.readings.map(r => [r.id, `Reading ${r.no}: ${r.title}`] as const)))
    const resumeRehearsal = appointments.find(a => a.kind === 'internal_rehearsal' && a.rehearsal && a.rehearsal.stage !== 'complete' && a.rehearsal.primary && a.status === 'planned')
    let result: Parameters<typeof WeeklyPaperCard>[0]['result'] = null
    if (state.primary.kind === 'result') {
      const { data: a } = await admin.from('assessment_attempts').select('score, scoring_policy_version, valid_response_count, delivered_count, scoreable_count').eq('id', state.primary.attemptId).eq('user_id', userId).maybeSingle()
      if (a) result = { score: (a.score ?? null) as number | null, policy: (a.scoring_policy_version ?? null) as string | null, answered: (a.valid_response_count ?? null) as number | null, delivered: ((a.scoreable_count ?? a.delivered_count) ?? null) as number | null }
    }
    const needsConfirm = preview.scope.unresolved.length > 0
    return (
      <>
        {checkpoint && (
          <Notice tone="info" role="status">
            {checkpoint.choice === 'use_mock'
              ? <>You chose your {checkpointTitle(checkpoint.checkpoint)} ({checkpoint.checkpoint.date}) as the assessment for the week of {checkpoint.week.startDate}, so no weekly paper is planned for it. </>
              : checkpoint.choice === 'keep_paper'
                ? <>Your {checkpointTitle(checkpoint.checkpoint)} ({checkpoint.checkpoint.date}) sits alongside this week’s paper; neither replaces the other. </>
                : <>Your {checkpointTitle(checkpoint.checkpoint)} ({checkpoint.checkpoint.date}) has not been decided against this week’s paper yet. </>}
            <Link href={checkpoint.href} className="prose-link">View or change it in Calendar</Link>.
          </Notice>
        )}
        {resumeRehearsal?.rehearsal?.primary && (
          <section className="weekly-card" aria-labelledby="reh-h" data-state="rehearsal">
            <p className="eyebrow">Rehearsal in progress</p>
            <h2 id="reh-h">{resumeRehearsal.title}</h2>
            <p>Your rehearsal is open. Each session has its own clock, and nothing starts until you choose.</p>
            <div className="weekly-card__actions"><Link className="primary-button" href={resumeRehearsal.rehearsal.primary.href}>{resumeRehearsal.rehearsal.primary.label}</Link></div>
          </section>
        )}
        <WeeklyPaperCard preview={preview} state={state} readingName={readingNames} today={studyWeek.today} result={result} classLed={studyWeek.classLed} />
        {needsConfirm || preview.scope.pendingPortions.length > 0
          ? <ScopePanel preview={preview} catalog={catalog} />
          : (!preview.noPaperReason || preview.scope.excluded.length > 0) && <details className="scope-details"><summary>What this paper covers</summary><ScopePanel preview={preview} catalog={catalog} /></details>}
      </>
    )
  } catch (e) {
    return <SectionFailed what="Your weekly paper" reference={recordFailure('tests.week', e, 503)} />
  }
}

async function PracticeView({ userId, reading, los, mode }: { userId: string; reading?: string; los?: string; mode?: string }) {
  try {
    const [catalog, preview] = await Promise.all([getClassLogCatalog(), getPaperPreview(userId)])
    const other = await getOtherAssessments(userId, preview)
    const doneReadings = new Set(other.readings.map(r => r.id)), doneSubjects = new Set(other.subjects.map(s => s.id))
    const data: PracticeCatalog = {
      subjects: catalog.map(s => ({ id: s.id, name: s.name, completed: doneSubjects.has(s.id), readings: s.readings.map(r => ({ id: r.id, no: r.no, title: r.title, completed: doneReadings.has(r.id) })) })),
      outcomes: Object.fromEntries(catalog.flatMap(s => s.readings.map(r => [r.id, r.outcomes.map(o => ({ id: o.id, title: o.title }))] as const))),
    }
    // Validate the link: the reading must exist, and the outcome must belong to THAT reading. Anything else is dropped, with a note.
    const readingRow = reading ? catalog.flatMap(s => s.readings).find(r => r.id === reading) : undefined
    const losOk = Boolean(readingRow && los && readingRow.outcomes.some(o => o.id === los))
    const linkBad = Boolean((reading && !readingRow) || (los && !losOk))
    return (
      <>
        {linkBad && <div className="notice notice--warn" role="status"><AlertTriangle size={16} /><span>That link pointed to something that is not available, so nothing was preselected. Choose a check below.</span></div>}
        <PracticePanel catalog={data} initial={{ readingId: readingRow?.id ?? null, losId: losOk ? los! : null, mode: mode === 'adaptive' ? 'adaptive' : null }} />
        <p className="muted">Repair re-checks start from their task in <Link className="prose-link" href="/app/calendar">Calendar</Link>, once the repair work is done.</p>
      </>
    )
  } catch (e) {
    return <SectionFailed what="Your checks" reference={recordFailure('tests.practice', e, 503)} />
  }
}

async function MocksView({ userId }: { userId: string }) {
  try {
    const [appointments, capability] = await Promise.all([listAppointments(userId), decideRehearsal(userId, null).then(r => r.decision)])
    return <MockSchedule appointments={appointments} capability={capability} />
  } catch (e) {
    return <SectionFailed what="Your mocks" reference={recordFailure('tests.mocks', e, 503)} />
  }
}

async function History({ supabase, userId, view, before }: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; view: View; before?: string }) {
  const m = before ? CURSOR.exec(before) : null
  let q = supabase.from('assessment_attempts')
    .select('id, status, score, started_at, attempt_kind, open_key, rehearsal_id, session_no, scoring_policy_version, delivered_count, valid_response_count, scoreable_count, form:assessment_forms ( blueprint:assessment_blueprints ( purpose ) )')
    .eq('user_id', userId).order('started_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(PAGE + 1)
  if (m) q = q.or(`started_at.lt.${m[1]},and(started_at.eq.${m[1]},id.lt.${m[2]})`)
  const { data, error } = await q
  if (error) return <section id="history" aria-labelledby="hist-h"><h2 id="hist-h">History</h2><SectionFailed what="Your history" reference={recordFailure('tests.history', error, 503)} /></section>
  const rows = (data ?? []).slice(0, PAGE)
  const more = (data ?? []).length > PAGE
  const last = rows[rows.length - 1]
  const next = more && last?.started_at ? `${last.started_at}_${last.id}` : null
  const label = (a: any) => a.attempt_kind === 'practice' ? (String(a.open_key ?? '').startsWith('practice-run:') ? 'Practice set' : 'Timed practice') : a.rehearsal_id ? `Rehearsal, session ${a.session_no ?? ''}`.trim() : a.attempt_kind === 'weekly' ? 'Weekly paper' : a.attempt_kind === 'reading' ? 'Reading check' : a.attempt_kind === 'subject' ? 'Subject check' : a.attempt_kind === 'repair' ? 'Repair re-check' : (PURPOSE_LABELS[a.form?.blueprint?.purpose as AssessmentPurpose] ?? 'Check')
  const basis = (a: any) => a.scoring_policy_version === 'paper-score.1' ? `${a.valid_response_count ?? 0} of ${(a.scoreable_count ?? a.delivered_count) ?? 0} answered · paper score` : a.scoring_policy_version === '1.0' || a.scoring_policy_version === null ? 'answered questions only' : 'unsupported scoring version'
  return (
    <section id="history" aria-labelledby="hist-h" style={{ marginTop: 36 }}>
      <h2 id="hist-h">History</h2>
      <p className="fine-print">Scores from different papers are not directly comparable.</p>
      {rows.length === 0 ? <p className="text-muted">{m ? 'No older papers.' : 'You have not taken a paper yet.'}</p> : (
        <ul className="dashboard-list" style={{ listStyle: 'none', padding: 0 }}>
          {rows.map(a => {
            const done = a.status === 'scored'
            const open = a.status === 'ready' || a.status === 'in_progress'
            const status = done ? 'Scored' : a.status === 'ready' ? 'Not started' : a.status === 'expired' ? 'Time ran out' : open ? 'In progress' : 'Closed'
            const detail = (<>
                  <div>
                    <h3 style={{ fontSize: '1rem', margin: 0 }}>{label(a)}</h3>
                    <p>
                      <Badge tone={done ? 'success' : a.status === 'ready' ? 'neutral' : 'accent'}>{status}</Badge>
                      {' · '}{a.started_at ? new Date(a.started_at as string).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Reserved'}
                    </p>
                  </div>
                  <div className="attempt-row__score">
                    {done
                      ? <><strong>{a.score ?? '—'}</strong>{a.score !== null && <small>%</small>}<small className="muted" style={{ display: 'block' }}>{basis(a)}</small></>
                      : open ? <span className="text-button">{a.status === 'ready' ? 'Open' : 'Resume →'}</span> : null}
                  </div>
            </>)
            return <li key={a.id}>
              {done || open
                ? <Link href={done ? `/app/tests/${a.id}/result` : `/app/tests/${a.id}`} className="dashboard-list-item attempt-row">{detail}</Link>
                : <div className="dashboard-list-item attempt-row">{detail}</div>}
            </li>
          })}
        </ul>
      )}
      {next && <p><Link className="secondary-button" href={`/app/tests?${view === 'week' ? '' : `view=${view}&`}before=${encodeURIComponent(next)}#history`}>Show older</Link></p>}
    </section>
  )
}
