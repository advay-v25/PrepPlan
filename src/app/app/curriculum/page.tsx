import { Suspense } from 'react'
import { PageLoading } from '../../../components/ui/PageLoading'
import { AdaptationLine } from '../../../components/review/AdaptationLine'
import { getCurrentAdaptation } from '../../../lib/planning/weeklyReview/adaptationRecord'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { computeProgress, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'
import { RoadmapView } from '../../../components/curriculum/RoadmapView'
import { onboardingHref } from '../../../lib/routing/registry'
import { ReadinessTracker } from '../../../components/curriculum/ReadinessTracker'
import { getLosTracker, getRepairLinks } from '../../../lib/curriculum/losTrackerService'
import type { LosBand } from '../../../lib/curriculum/losTracker'
import { COVERAGE_LABEL, FILTERS, filterRows, getCardTotals, getWorkspaceRows, isFilterKey, snippetFor, type CardTotals, type WorkspaceRow } from '../../../lib/curriculum/workspaceIndex'
import { getCurrentOperatingState } from '../../../lib/state/operatingState'
import { noteText, type NoteDoc } from '../../../lib/curriculum/notes/doc'
import type { ReadingCoverageSummary } from '../../../lib/curriculum/readingCoverage'

export const metadata = { title: 'Curriculum' }

export const dynamic = 'force-dynamic'

/**
 * Curriculum owns the long-term roadmap; Calendar owns the accepted week.
 *
 * This page answers where the student is in the syllabus, what order the rest
 * comes in, whether the plan fits the time left, and how far actual progress
 * has drifted from what was planned.
 */
type CurriculumProps = { searchParams: Promise<{ view?: string; band?: string; q?: string; f?: string }> }

export default function CurriculumPage(props: CurriculumProps) {
  return <Suspense fallback={<PageLoading message="Loading your curriculum…" />}><CurriculumContent {...props} /></Suspense>
}

async function CurriculumContent({ searchParams }: CurriculumProps) {
  const { view: viewParam, band: bandParam, q: qParam, f: fParam } = await searchParams
  const view = viewParam === 'roadmap' ? 'roadmap' : viewParam === 'readiness' ? 'readiness' : viewParam === 'notes' ? 'notes' : 'overview'
  const q = (qParam ?? '').slice(0, 100), filterKey = isFilterKey(fParam) ? fParam : null
  const band = (['repair', 'verify', 'maintain', 'untested'] as const).find(b => b === bandParam) ?? 'all'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/curriculum')

  const admin = createAdminClient()

  const [roadmap, tracker, repairLinks, workspace, totals, next] = await Promise.all([
    view === 'roadmap' ? Promise.all([
      admin.from('profiles').select('exam_year, exam_sitting, registered').eq('id', user.id).maybeSingle().throwOnError(),
      admin.from('topics').select('id, name, exam_weight_min, exam_weight_max, default_sequence, summary').order('default_sequence').throwOnError(),
      admin.from('learning_modules').select('id, topic_ref, name, summary, effort_band, difficulty_weight, sequence_hint').eq('is_active', true).order('sequence_hint').throwOnError(),
      admin.from('user_module_state').select('lm_id, coverage_state, source').eq('user_id', user.id).throwOnError(),
      getActiveRoadmap(user.id),
    ]).then(async ([profile, topics, modules, coverage, active]) => ({
      profile: profile.data, topics: topics.data, modules: modules.data, coverage: coverage.data, active,
      progress: active ? await computeProgress(user.id, active.roadmap, active.input) : null,
    })) : null,
    view === 'readiness' ? getLosTracker(user.id) : null,
    view === 'readiness' ? getRepairLinks(user.id).catch(() => ({} as Record<string, string>)) : {},
    view === 'overview' || view === 'notes' ? getWorkspaceRows(user.id, supabase).catch(() => null) : null,
    view === 'overview' ? getCardTotals(supabase).catch(() => null) : null,
    view === 'overview' ? getCurrentOperatingState(user.id).then(s => s.nextAction).catch(() => null) : null,
  ])
  const { profile, topics, modules, coverage, active, progress } = roadmap ?? {}
  const rows = workspace?.rows
  let subjectNotes: { id: string; name: string; updatedAt: string; preview: string; text: string }[] = [], subjectNotesError = false
  if (view === 'notes') {
    const sn = await supabase.from('curriculum_notes').select('scope_id, doc, updated_at').eq('scope_type', 'subject').limit(100)
    if (sn.error) subjectNotesError = true
    else { const names = new Map((rows ?? []).map(r => [r.subjectId, r.subjectName])); subjectNotes = (sn.data ?? []).map(n => ({ id: n.scope_id as string, name: names.get(n.scope_id as string) ?? (n.scope_id as string), updatedAt: n.updated_at as string, ...(() => { const text = noteText(n.doc as NoteDoc).replace(/\s+/g, ' ').trim(); return { preview: text.slice(0, 160), text } })() })) }
  }
  const adaptation = view === 'roadmap' ? await getCurrentAdaptation(user.id).catch(() => null) : null

  const changeExamHref = onboardingHref('exam', '/app/curriculum')

  return (
    <div className="page-content curriculum-page">
      <header className="page-header">
        <div>
          <h1>Curriculum</h1>
          <p>
            {view === 'overview'
              ? 'Find a reading, see where you stand and pick up the next piece of work.'
              : view === 'notes' ? 'Your private notes, by reading and subject.'
              : view === 'readiness'
              ? 'What your tests show on each outcome, and what to work on next.'
              : 'The syllabus in order, and how you are tracking against the plan.'}
          </p>
        </div>
        <Link href="/app/calendar" className="text-button">Calendar &rarr;</Link>
      </header>

      <nav className="curriculum-views" aria-label="Curriculum views">
        <Link href="/app/curriculum" aria-current={view === 'overview' ? 'page' : undefined}>Overview</Link>
        <Link href="/app/curriculum?view=notes" aria-current={view === 'notes' ? 'page' : undefined}>Notes</Link>
        <Link href="/app/curriculum/flashcards">Cards</Link>
        <Link href="/app/curriculum?view=readiness" aria-current={view === 'readiness' ? 'page' : undefined}>Readiness</Link>
        <Link href="/app/curriculum?view=roadmap" aria-current={view === 'roadmap' ? 'page' : undefined}>Roadmap</Link>
      </nav>

      <AdaptationLine record={adaptation} />

      {view === 'overview' ? (
        !workspace ? <p role="alert" className="review-error">Your curriculum could not be loaded just now. <Link href="/app/curriculum">Try again</Link></p>
        : <Overview rows={workspace.rows} coverage={workspace.coverage} totals={totals} revisionUnavailable={workspace.revisionUnavailable} q={q} filterKey={filterKey} next={next ? { title: next.title, href: next.destination, label: next.actionLabel ?? 'Open', scope: next.scope } : null} />
      ) : view === 'notes' ? (
        !rows ? <p role="alert" className="review-error">Your notes could not be loaded just now. <Link href="/app/curriculum?view=notes">Try again</Link></p>
        : <NotesIndex rows={rows} q={q} subjectNotes={subjectNotes} subjectNotesError={subjectNotesError} />
      ) : view === 'readiness' && tracker ? (
        <ReadinessTracker tracker={tracker} band={band as LosBand | 'all'} repairLinks={repairLinks} />
      ) : !active ? (
        <section className="note" aria-labelledby="exam-h">
          <h2 id="exam-h">Choose your exam</h2>
          <p>Your roadmap is built backwards from your exam. Set it in the same place you set it up, then come back here.</p>
          <p><Link className="primary-button" href={changeExamHref}>Choose your exam</Link></p>
        </section>
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
          changeExamHref={changeExamHref}
          examLabel={profile?.exam_sitting && profile?.exam_year
            ? `${String(profile.exam_sitting).replace(/^./, c => c.toUpperCase())} ${profile.exam_year}`
            : null}
        />
      )}
    </div>
  )
}

const attention = (n: number) => `${n} need${n === 1 ? 's' : ''} attention`

function Overview({ rows, coverage, totals, revisionUnavailable, q, filterKey, next }: { rows: WorkspaceRow[]; coverage: ReadingCoverageSummary; totals: CardTotals | null; revisionUnavailable: boolean; q: string; filterKey: (typeof FILTERS)[number]['key'] | null; next: { title: string; href: string; label: string; scope: string } | null }) {
  const shown = filterRows(rows, { q, f: filterKey, inNotes: true })
  const due = totals?.due ?? 0, cardsTotal = totals?.total ?? 0   // exact counts across every scope: the same numbers as Home
  const bySubject = new Map<string, WorkspaceRow[]>(); for (const r of shown) bySubject.set(r.subjectId, [...(bySubject.get(r.subjectId) ?? []), r])
  const filtered = Boolean(q || filterKey)
  const href = (f: string | null) => { const p = new URLSearchParams(); if (q) p.set('q', q); if (f) p.set('f', f); const s = p.toString(); return `/app/curriculum${s ? `?${s}` : ''}` }
  const back = encodeURIComponent(href(filterKey))
  return (
    <>
      <section className="cur-summary" aria-label="Where you are">
        <div className="cur-summary__main">
          <span className="sr-only">{coverage.covered} of {coverage.total} readings recorded as covered · {coverage.partial} partly · {coverage.total - coverage.covered - coverage.partial} not yet.</span>
          <strong aria-hidden>{coverage.covered}<small>/{coverage.total}</small></strong>
          <span aria-hidden>readings covered<span className="cur-summary__sub"> · {coverage.partial} partly · {coverage.total - coverage.covered - coverage.partial} not yet</span></span>
          <span className="cur-bar" role="img" aria-label={`${coverage.covered} of ${coverage.total} readings covered`}><span style={{ width: `${coverage.total ? Math.round(100 * coverage.covered / coverage.total) : 0}%` }} /></span>
        </div>
        <ul className="cur-summary__links">
          {next && <li><span>Next</span><Link href={next.href}>{next.title}</Link></li>}
          <li><span>Cards</span>{!totals ? <Link href="/app/curriculum">Try again</Link> : cardsTotal === 0 ? <em>None yet</em> : due > 0 ? <Link href="/app/curriculum/flashcards"><span aria-hidden>{due} due</span><span className="sr-only">{due} card{due === 1 ? '' : 's'} due for recall practice</span></Link> : <Link href="/app/curriculum/flashcards">None due</Link>}</li>
        </ul>
        <p className="fine-print">Covered is your own record, and does not mean understood. Only tests show understanding.</p>
      </section>

      <form role="search" method="get" action="/app/curriculum" className="curriculum-search">
        <label>Find a reading <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Title, number or subject" /></label>
        {filterKey && <input type="hidden" name="f" value={filterKey} />}
        <button type="submit" className="secondary-button">Search</button>
      </form>
      <p className="curriculum-filters" aria-label="Filter readings">
        <Link href={href(null)} aria-current={!filterKey ? 'true' : undefined}>All</Link>
        {FILTERS.map(f => <Link key={f.key} href={href(f.key)} aria-current={filterKey === f.key ? 'true' : undefined}>{f.label}</Link>)}
      </p>
      {revisionUnavailable && <p role="alert" className="review-error">Your revision queue could not be loaded just now, so the Revision queued filter and labels are not shown rather than guessed. <Link href="/app/curriculum">Try again</Link></p>}
      {filterKey === 'revision' && revisionUnavailable ? null : filtered && <p role="status" className="muted">{shown.length} reading{shown.length === 1 ? '' : 's'} match{shown.length === 1 ? 'es' : ''}. <Link href="/app/curriculum">Clear</Link></p>}
      {shown.length === 0 && !(filterKey === 'revision' && revisionUnavailable) && <p className="muted">{filtered ? 'No reading matches. Try a different word or filter.' : 'No readings are available.'}</p>}

      <div className="curriculum-outline">
        {[...bySubject].map(([subjectId, list], i) => (
          <details key={subjectId} open={filtered || i === 0}>
            <summary><Link href={`/app/curriculum/${subjectId}`}>{list[0].subjectName}</Link> <span className="muted">· {list.length} reading{list.length === 1 ? '' : 's'}{list.some(r => r.needsAttention > 0) ? ` · ${list.filter(r => r.needsAttention > 0).length} need attention` : ''}</span></summary>
            <ul className="reading-list">
              {list.map(r => (
                <li key={r.readingId}>
                  <Link href={`/app/curriculum/${r.subjectId}/${r.readingId}?return=${back}`}><span className="reading-card__no">{r.readingNo}</span> {r.title}</Link>
                  <span className="muted"> · {r.structurePending ? 'Structure to come' : COVERAGE_LABEL[r.coverage]}{r.needsAttention > 0 ? ` · ${attention(r.needsAttention)}` : ''}{r.revision ? ` · ${r.revision}` : ''}</span>
                  {r.note && <Link className="text-button" href={`/app/curriculum/${r.subjectId}/${r.readingId}?tab=notes&return=${back}`}> Notes</Link>}
                  {r.cards > 0 && <Link className="text-button" href={`/app/curriculum/${r.subjectId}/${r.readingId}?tab=cards&return=${back}`}> Cards{r.due > 0 ? ` (${r.due} due)` : ` (${r.cards})`}</Link>}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  )
}

function NotesIndex({ rows, q, subjectNotes, subjectNotesError }: { rows: WorkspaceRow[]; q: string; subjectNotes: { id: string; name: string; updatedAt: string; preview: string; text: string }[]; subjectNotesError: boolean }) {
  const mine = filterRows(rows.filter(r => r.note), { q, inNotes: true })
  const subs = subjectNotes.filter(n => !q || `${n.name} ${n.text}`.toLowerCase().includes(q.toLowerCase()))
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
  const back = encodeURIComponent(`/app/curriculum?view=notes${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  return (
    <>
      <form role="search" method="get" action="/app/curriculum" className="curriculum-search">
        <input type="hidden" name="view" value="notes" />
        <label>Search your notes <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="A word from a reading title or your note" /></label>
        <button type="submit" className="secondary-button">Search</button>
      </form>
      {subjectNotesError && <p role="alert" className="review-error">Your subject notes could not be listed just now. Reading notes are shown below.</p>}
      {mine.length === 0 && subs.length === 0 && <p className="muted">{q ? 'No note matches that search.' : 'You have not written any notes yet. Open a reading and choose Notes to start; there is no required format.'}</p>}
      <ul className="note-index">
        {subs.map(n => <li key={`s-${n.id}`}><Link href={`/app/curriculum/${n.id}?tab=notes&return=${back}`}><strong>{n.name}</strong></Link> <span className="muted">subject · saved {when(n.updatedAt)}</span><p>{q ? snippetFor(n.text, q) : n.preview || 'Empty note'}</p></li>)}
        {mine.map(r => <li key={r.readingId}><Link href={`/app/curriculum/${r.subjectId}/${r.readingId}?tab=notes&return=${back}`}><strong>Reading {r.readingNo}: {r.title}</strong></Link> <span className="muted">{r.subjectName} · saved {when(r.note!.updatedAt)}</span><p>{q ? snippetFor(r.note!.text, q) : r.note!.preview || 'Empty note'}</p></li>)}
      </ul>
    </>
  )
}
