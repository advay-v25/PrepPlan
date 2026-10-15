import Link from 'next/link'
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, FlaskConical, Lock } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { Reveal } from '../../../components/Reveal'
import { StaggerList } from '../../../components/StaggerList'
import {
  AssessmentPurpose,
  PURPOSE_DESCRIPTIONS,
  PURPOSE_LABELS,
  PURPOSE_LENGTHS,
  allowedTiers,
  countAvailableItems,
} from '../../../lib/diagnostic/blueprint'
import { getStudyWeekContext } from '../../../lib/planning/schedule'
import { WEEKDAY_NAMES, formatWeekRange } from '../../../lib/planning/studyWeek'
import { getConceptSummariesForCurrentUser } from '../../../lib/diagnostic/conceptSummary'
import { getPaperPreview } from '../../../lib/tests/paperPreview'
import { getClassLogCatalog } from '../../../lib/planning/classlog/service'
import { ScopePanel } from '../../../components/tests/ScopePanel'
import { SignalsPanel } from '../../../components/tests/SignalsPanel'
import { getSignals } from '../../../lib/signals/signals-loader'
import { WeeklyPaperCard } from '../../../components/tests/WeeklyPaperCard'
import { OtherAssessments } from '../../../components/tests/OtherAssessments'
import { getWeeklyPaperState, getOtherAssessments } from '../../../lib/tests/testsOverview'
import { checkIsReviewer } from '../../../lib/diagnostic/reviewAccess'
import { Badge } from '../../../components/ui/Badge'

export const dynamic = 'force-dynamic'

const OFFERED: AssessmentPurpose[] = ['module_diagnostic', 'concept_check', 'weekly_cumulative']

export default async function TestsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <div className="page-content"><p>Unauthorized</p></div>

  const admin = createAdminClient()

  const { data: manifest } = await supabase
    .from('curriculum_manifests')
    .select('id, year, level, version, capabilities')
    .eq('is_active', true)
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Modules that actually have deliverable items, so the picker never offers a
  // scope that cannot be assembled.
  const { data: moduleRows } = await admin
    .from('learning_modules')
    .select('id, name, topic_id')
    .order('id')

  const availability = manifest ? await countAvailableItems(user.id, manifest.id) : { verified: 0, reviewed: 0, seen: 0 }

  const perModule = manifest
    ? await Promise.all(
        (moduleRows ?? []).map(async m => ({
          ...m,
          counts: await countAvailableItems(user.id, manifest.id, { modules: [m.id] }),
        }))
      )
    : []
  const liveModules = perModule.filter(m => m.counts.verified + m.counts.reviewed > 0)

  const { data: attempts } = await supabase
    .from('assessment_attempts')
    .select(`
      id, status, score, started_at, completed_at,
      form:assessment_forms (
        blueprint:assessment_blueprints ( purpose, requested_scope )
      )
    `)
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(20)

  const pastAttempts = attempts ?? []

  const summaries = await getConceptSummariesForCurrentUser()
  const supported = summaries.filter(s => s.current_state === 'supported').length
  const unstable = summaries.filter(s => s.current_state === 'unstable').length
  const needsRepair = summaries.filter(s => s.current_state === 'needs_repair').length

  const paperPreview = await getPaperPreview(user.id)
  const scopeCatalog = await getClassLogCatalog()
  const weeklyState = await getWeeklyPaperState(user.id, paperPreview)
  const otherData = await getOtherAssessments(user.id, paperPreview)
  const isReviewer = await checkIsReviewer(user.id)
  const signalsNow = await getSignals(user.id)
  const readingNames = new Map(scopeCatalog.flatMap(sub => sub.readings.map(r => [r.id, `Reading ${r.no}: ${r.title}`] as const)))
  const blueprintReady = Boolean((manifest?.capabilities as any)?.blueprint_available)

  const studyWeek = await getStudyWeekContext(user.id)
  const { data: activeCycle } = await admin
    .from('planning_cycles')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  const { data: scheduledDiagnostic } = activeCycle ? await admin
    .from('plan_blocks')
    .select('id, title, local_date, execution')
    .eq('user_id', user.id)
    .eq('cycle_id', activeCycle.id)
    .eq('task_type', 'diagnostic')
    .gte('local_date', studyWeek.week.startDate)
    .lte('local_date', studyWeek.week.endDate)
    .order('local_date', { ascending: true })
    .limit(1)
    .maybeSingle() : { data: null }

  function availableFor(purpose: AssessmentPurpose) {
    const tiers = allowedTiers(purpose)
    return tiers.includes('verified') ? availability.verified + availability.reviewed : availability.reviewed
  }

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <h1>Diagnostics</h1>
          <p>
            A diagnostic measures what you actually understand, not what you have covered. Nothing here
            records evidence unless the question was unseen and independently checked.
          </p>
        </div>
        {isReviewer && availability.reviewed + availability.verified > 0 && (
          <Link href="/app/tests/review" className="secondary-button">
            <FlaskConical size={15} /> Item review
          </Link>
        )}
      </header>

      <WeeklyPaperCard preview={paperPreview} state={weeklyState} readingName={readingNames} />
      <ScopePanel preview={paperPreview} catalog={scopeCatalog} />
      <OtherAssessments data={otherData} catalog={scopeCatalog} />
      <SignalsPanel s={signalsNow} />

      {error && (
        <div className="notice notice--warn" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {!manifest ? (
        <div className="notice notice--warn">
          <AlertTriangle size={16} />
          <span>No active curriculum is loaded, so no diagnostic can be assembled yet.</span>
        </div>
      ) : !blueprintReady ? (
        <div className="notice notice--warn">
          <AlertTriangle size={16} />
          <span>The {manifest.year} {manifest.level} curriculum is loaded but not yet cleared to generate diagnostics.</span>
        </div>
      ) : null}

      {scheduledDiagnostic && (
        <Link href={`/app/calendar?week=${studyWeek.week.startDate}`} className="scheduled-banner">
          <CalendarClock size={18} aria-hidden />
          <span>
            <strong>
              {scheduledDiagnostic.title} scheduled for {WEEKDAY_NAMES[studyWeek.anchorDay]}, {scheduledDiagnostic.local_date}
            </strong>
            <small>
              It closes your study week ({formatWeekRange(studyWeek.week)}). What it finds becomes the
              following week's repair work.
            </small>
          </span>
          <ChevronRight size={16} aria-hidden />
        </Link>
      )}

      <div className="diagnostics-columns">
        <section>
          <details className="more-checks">
          <summary><h2 className="section-heading" style={{ display: 'inline' }}>More checks (module and concept)</h2></summary>
          <StaggerList className="purpose-grid">
            {OFFERED.map(purpose => {
              const count = availableFor(purpose)
              const needed = Math.min(5, PURPOSE_LENGTHS[purpose])
              const enabled = blueprintReady && manifest && count >= needed
              const goldOnly = !allowedTiers(purpose).includes('verified')

              return (
                <form key={purpose} method="POST" action="/api/diagnostic/attempt" className="purpose-card">
                  <input type="hidden" name="purpose" value={purpose} />
                  <input type="hidden" name="manifestId" value={manifest?.id ?? ''} />

                  <div className="purpose-card__head">
                    <h3>{PURPOSE_LABELS[purpose]}</h3>
                    {goldOnly && (
                      <span className="tier-badge tier-badge--gold" title="Uses hand-reviewed questions only">
                        <Lock size={11} /> Reviewed only
                      </span>
                    )}
                  </div>
                  <p>{PURPOSE_DESCRIPTIONS[purpose]}</p>

                  {liveModules.length > 1 && purpose !== 'weekly_cumulative' && (
                    <label className="purpose-card__field">
                      <span>Scope</span>
                      <select name="module" defaultValue="all">
                        <option value="all">Everything available</option>
                        {liveModules.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.counts.verified + m.counts.reviewed})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="purpose-card__foot">
                    <small>
                      {enabled ? (
                        `${Math.min(PURPOSE_LENGTHS[purpose], count)} questions · ${count} unseen available`
                      ) : count === 0 && availability.seen > 0 ? (
                        goldOnly
                          ? 'You have already answered every reviewed question. More arrive as items are reviewed.'
                          : 'You have already answered every question in the bank.'
                      ) : (
                        `${count} unseen available, ${needed} needed to assemble this`
                      )}
                    </small>
                    <button type="submit" className="primary-button" disabled={!enabled}>
                      Start <ChevronRight size={16} />
                    </button>
                  </div>
                </form>
              )
            })}
          </StaggerList>
          </details>

          <h2 className="section-heading" style={{ marginTop: 36 }}>Past attempts</h2>
          <p className="fine-print">Scores from different papers are not directly comparable: each has its own questions, difficulty and scope.</p>
          {pastAttempts.length === 0 ? (
            <p className="text-muted">You have not taken a diagnostic yet.</p>
          ) : (
            <StaggerList className="dashboard-list">
              {pastAttempts.map(att => {
                const purpose = (att.form as any)?.blueprint?.purpose as AssessmentPurpose | undefined
                const done = att.status === 'scored'
                return (
                  <Link
                    key={att.id}
                    href={done ? `/app/tests/${att.id}/result` : `/app/tests/${att.id}`}
                    className="dashboard-list-item attempt-row"
                  >
                    <div>
                      <h4>{purpose ? PURPOSE_LABELS[purpose] : 'Diagnostic'}</h4>
                      <p>
                        <Badge tone={done ? 'success' : att.status === 'ready' ? 'neutral' : 'accent'}>
                          {done ? 'Scored' : att.status === 'ready' ? 'Not started' : 'In progress'}
                        </Badge>
                        {' · '}
                        {new Date(att.started_at as string).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="attempt-row__score">
                      {done ? <><strong>{att.score ?? 0}</strong><small>%</small></> : <span className="text-button">Resume →</span>}
                    </div>
                  </Link>
                )
              })}
            </StaggerList>
          )}
        </section>

        <section>
          <Reveal className="dashboard-hero-card">
            <h2 style={{ fontSize: '1.05rem', marginBottom: 16 }}>Evidence</h2>
            <div className="evidence-stat-row">
              <span>Supported</span>
              <strong className="is-green">{supported}</strong>
            </div>
            <div className="evidence-stat-row">
              <span>Unstable</span>
              <strong className="is-amber">{unstable}</strong>
            </div>
            <div className="evidence-stat-row">
              <span>Needs repair</span>
              <strong className="is-red">{needsRepair}</strong>
            </div>
            <p className="fine-print">
              Concepts, not questions. A concept counts as supported only when it was tested on an unseen,
              independently validated item. Completing a study block is not evidence.
            </p>
          </Reveal>

          <Reveal className="dashboard-hero-card" >
            <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>Questions left for you</h2>
            <p className="fine-print" style={{ marginBottom: 14 }}>
              Unseen questions only. Anything you have already answered is not evidence a second time.
            </p>
            <div className="evidence-stat-row">
              <span>
                Reviewed <small className="text-muted">(gold)</small>
              </span>
              <strong>{availability.reviewed}</strong>
            </div>
            <div className="evidence-stat-row">
              <span>Verifier-passed</span>
              <strong>{availability.verified}</strong>
            </div>
            <div className="evidence-stat-row">
              <span>Already answered</span>
              <strong className="text-muted">{availability.seen}</strong>
            </div>
            <p className="fine-print">
              Verifier-passed questions are used for routine practice. Only reviewed questions are allowed to
              move your readiness, so a weekly paper waits for them.
            </p>
          </Reveal>

          {supported + unstable + needsRepair > 0 && (
            <Reveal className="dashboard-hero-card">
              <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>
                <CheckCircle2 size={16} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--success)' }} />
                Where you stand
              </h2>
              <p className="fine-print" style={{ margin: 0 }}>
                {needsRepair > 0
                  ? `${needsRepair} concept${needsRepair === 1 ? '' : 's'} came back needing repair. Those are the ones worth this week's time.`
                  : 'Nothing is currently flagged for repair. Widen the scope of your next diagnostic.'}
              </p>
            </Reveal>
          )}
        </section>
      </div>
    </div>
  )
}
