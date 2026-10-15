import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { computeProgress, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'
import { RoadmapView } from '../../../components/curriculum/RoadmapView'
import { ExamTargetPicker } from '../../../components/curriculum/ExamTargetPicker'
import { ReadinessTracker } from '../../../components/curriculum/ReadinessTracker'
import { getLosTracker } from '../../../lib/curriculum/losTrackerService'
import type { LosBand } from '../../../lib/curriculum/losTracker'
import { getSubjects } from '../../../lib/curriculum/spine'

export const dynamic = 'force-dynamic'

/**
 * Curriculum owns the long-term roadmap; Calendar owns the accepted week.
 *
 * This page answers where the student is in the syllabus, what order the rest
 * comes in, whether the plan fits the time left, and how far actual progress
 * has drifted from what was planned.
 */
export default async function CurriculumPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; band?: string }>
}) {
  const { view: viewParam, band: bandParam } = await searchParams
  const view = viewParam === 'roadmap' ? 'roadmap' : viewParam === 'readiness' ? 'readiness' : 'overview'
  const band = (['repair', 'verify', 'maintain', 'untested'] as const).find(b => b === bandParam) ?? 'all'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/curriculum')

  const admin = createAdminClient()

  const [{ data: profile }, { data: windows }, { data: topics }, { data: modules }, { data: coverage }] =
    await Promise.all([
      admin.from('profiles').select('exam_window_id, exam_year, exam_sitting, registered').eq('id', user.id).maybeSingle(),
      admin.from('exam_windows').select('id, year, sitting, window_opens, is_confirmed').order('year').order('window_opens'),
      admin.from('topics').select('id, name, exam_weight_min, exam_weight_max, default_sequence, summary').order('default_sequence'),
      admin.from('learning_modules').select('id, topic_ref, name, summary, effort_band, difficulty_weight, sequence_hint').eq('is_active', true).order('sequence_hint'),
      admin.from('user_module_state').select('lm_id, coverage_state, source').eq('user_id', user.id),
    ])

  const active = await getActiveRoadmap(user.id)
  const progress = active && view === 'roadmap' ? await computeProgress(user.id, active.roadmap, active.input) : null
  const tracker = view === 'readiness' ? await getLosTracker(user.id) : null
  const subjects = view === 'overview' ? await getSubjects() : []
  const overviewTracker = view === 'overview' ? await getLosTracker(user.id) : null
  const bandsBySubject = new Map((overviewTracker?.topics ?? []).map(t => [t.id, t.counts]))

  const today = new Date().toISOString().slice(0, 10)
  const futureWindows = (windows ?? []).filter(w => !w.window_opens || w.window_opens > today)

  return (
    <div className="page-content curriculum-page">
      <header className="page-header">
        <div>
          <h1>Curriculum</h1>
          <p>
            {view === 'overview'
              ? 'The whole syllabus by subject and reading, in the order it comes. Open a subject to see its readings.'
              : view === 'readiness'
              ? 'What you have actually demonstrated on each learning outcome — and what to work on next. Bands move only on diagnostic and revision evidence.'
              : 'The whole syllabus, the order it comes in, and how far you actually are against the plan. The calendar turns the near end of this into a week.'}
          </p>
        </div>
        <Link href="/app/calendar" className="text-button">Calendar &rarr;</Link>
      </header>

      <nav className="curriculum-views" aria-label="Curriculum views">
        <Link href="/app/curriculum" aria-current={view === 'overview' ? 'page' : undefined}>Overview</Link>
        <Link href="/app/curriculum?view=readiness" aria-current={view === 'readiness' ? 'page' : undefined}>Readiness</Link>
        <Link href="/app/curriculum?view=roadmap" aria-current={view === 'roadmap' ? 'page' : undefined}>Roadmap</Link>
      </nav>

      {view === 'overview' ? (
        <>
        <p><Link href="/app/curriculum/flashcards" className="text-button">Review flashcards that are due &rarr;</Link></p>
        <ul className="subject-grid">
          {subjects.map(sub => (
            <li key={sub.id}>
              <Link href={`/app/curriculum/${sub.id}`} className="subject-card">
                <strong>{sub.name}</strong>
                <span className="subject-card__summary">{sub.summary}</span>
                <span className="subject-card__meta">
                  {sub.readingCount} readings · {sub.pageCount} pages · {sub.weightMin}–{sub.weightMax}% of the exam
                  {sub.structurePending ? ' · structure to come' : ''}
                </span>
                {(() => {
                  const c = bandsBySubject.get(sub.id)
                  if (!c || c.total === 0) return null
                  const parts = [['Repair', c.repair], ['Verify', c.verify], ['Maintain', c.maintain]].filter(([, n]) => Number(n) > 0)
                  return <span className="subject-card__meta">{parts.length ? parts.map(([l, n]) => `${n} ${l}`).join(' · ') : `${c.untested} outcomes untested`}</span>
                })()}
              </Link>
            </li>
          ))}
        </ul>
        </>
      ) : view === 'readiness' && tracker ? (
        <ReadinessTracker tracker={tracker} band={band as LosBand | 'all'} />
      ) : !active ? (
        <ExamTargetPicker
          windows={futureWindows.map(w => ({
            id: w.id as string, year: w.year as number, sitting: w.sitting as string,
            opens: (w.window_opens ?? null) as string | null,
            confirmed: Boolean(w.is_confirmed),
          }))}
          currentWindowId={(profile?.exam_window_id ?? null) as string | null}
        />
      ) : (
        <RoadmapView
          roadmap={active.roadmap}
          status={active.status}
          progress={progress!}
          topics={(topics ?? []).map(t => ({
            id: t.id as string, name: t.name as string,
            weightMin: Number(t.exam_weight_min), weightMax: Number(t.exam_weight_max),
            summary: (t.summary ?? '') as string,
          }))}
          modules={(modules ?? []).map(m => ({
            id: m.id as string, topic: (m.topic_ref ?? '') as string, name: m.name as string,
            summary: (m.summary ?? '') as string,
            effortBand: (m.effort_band ?? 3) as number,
            difficulty: Number(m.difficulty_weight ?? 3),
          }))}
          coverage={Object.fromEntries((coverage ?? []).map(c => [c.lm_id as string, c.coverage_state as string]))}
          examLabel={profile?.exam_sitting && profile?.exam_year
            ? `${String(profile.exam_sitting).replace(/^./, c => c.toUpperCase())} ${profile.exam_year}`
            : null}
        />
      )}
    </div>
  )
}
