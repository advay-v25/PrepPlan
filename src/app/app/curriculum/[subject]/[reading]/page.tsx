import { SectionFailed } from '../../../../../components/home/SectionFailed'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '../../../../../lib/supabase/server'
import { getReading } from '../../../../../lib/curriculum/spine'
import { getLosTracker } from '../../../../../lib/curriculum/losTrackerService'
import { CHECK_LABEL, VERDICT_LABEL } from '../../../../../lib/curriculum/confidence'
import { NoteEditor } from '../../../../../components/curriculum/NoteEditor'
import { FlashcardPanel } from '../../../../../components/curriculum/FlashcardPanel'
import { starterDoc } from '../../../../../lib/curriculum/notes/doc'
import { MarkControl, OverrideControl } from '../../../../../components/curriculum/ConfidenceControls'
import { LogLearningButton } from '../../../../../components/log/LogLearningButton'
import { getRevisionOverview, readingCheckCapability } from '../../../../../lib/curriculum/revisionOverview'
import { CoverageControl } from '../../../../../components/curriculum/CoverageControl'
import { RevisionStatus } from '../../../../../components/curriculum/RevisionStatus'
import { safeInAppReturn } from '../../../../../lib/curriculum/workspaceIndex'
import { classLogHref } from '../../../../../lib/routing/calendar'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ subject: string; reading: string }> }) {
  const { subject, reading } = await params
  const r = await getReading(subject, reading)
  return { title: r ? `Reading ${r.readingNo} · ${r.title}` : 'Reading unavailable' }
}

/** One reading: what it covers, its modules and learning outcomes. A pure read. */
export default async function ReadingPage({ params, searchParams }: { params: Promise<{ subject: string; reading: string }>; searchParams: Promise<{ los?: string; tab?: string; return?: string; result?: string }> }) {
  const { subject, reading: readingId } = await params
  const { los, tab: tabParam, return: returnParam, result: resultParam } = await searchParams
  const tab = tabParam === 'notes' ? 'notes' : tabParam === 'cards' ? 'cards' : 'work'
  const back = safeInAppReturn(returnParam)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/curriculum/${subject}/${readingId}`)

  const r = await getReading(subject, readingId)
  if (!r) notFound()
  // Only the section being shown reads its own data: the rich editor and the deck are not mounted (or fetched) until chosen.
  const noteRead = tab === 'notes' ? await supabase.from('curriculum_notes').select('doc, revision').eq('scope_type', 'reading').eq('scope_id', readingId).maybeSingle() : null
  const note = noteRead?.data, noteError = noteRead?.error
  const [noteCount, cardCount] = await Promise.all([
    supabase.from('curriculum_notes').select('scope_id', { count: 'exact', head: true }).eq('scope_type', 'reading').eq('scope_id', readingId),
    supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('scope_type', 'reading').eq('scope_id', readingId),
  ])
  const [overview, capability] = await Promise.all([getRevisionOverview(user.id).catch(() => null), readingCheckCapability(user.id, readingId).catch(() => null)])
  const tracker = await getLosTracker(user.id)
  const covRead = tab === 'work' ? await supabase.from('user_module_state').select('coverage_state, source').eq('lm_id', readingId).maybeSingle() : null
  // Optional context from a result: shown only if that attempt is THIS student's (own-row read). Nothing is opened, scored or changed by it.
  const resultCtx = resultParam && /^[0-9a-f-]{36}$/i.test(resultParam)
    ? await supabase.from('assessment_attempts').select('id, status').eq('id', resultParam).eq('user_id', user.id).maybeSingle() : null
  const readingStatus = tracker.topics.find(t => t.id === subject)?.modules.find(m => m.id === readingId)
  // ?los=<id> opens/highlights ONE outcome of THIS reading. An id that is not one of its outcomes selects nothing and says so.
  const selectedLos = los && r.modules.some(m => m.outcomes.some(o => o.id === los)) ? los : null
  const rowByOutcome = new Map((readingStatus?.rows ?? []).map(x => [x.outcomeId, x]))
  const BAND: Record<string, string> = { repair: 'Repair', verify: 'Verify', maintain: 'Maintain', untested: 'Untested' }
  const PROGRESS: Record<string, string> = { not_started: 'Not started', scheduled: 'Scheduled', in_progress: 'Worked — awaiting retest', retest_due: 'Retest due', complete: 'Holding' }

  return (
    <div className="page-content curriculum-page reading-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        {back && <><Link href={back}>&larr; Back</Link> · </>}<Link href="/app/curriculum?view=overview">Curriculum</Link> / <Link href={`/app/curriculum/${r.subject.id}`}>{r.subject.name}</Link> / Reading {r.readingNo}
      </nav>
      <header className="page-header">
        <div>
          <p className="eyebrow">Reading {r.readingNo} · {r.subject.name}</p>
          <h1>{r.title}</h1>
          {r.summary && <p className="reading-summary">{r.summary}</p>}
          {r.relevance && <details className="reading-why"><summary>Why it matters</summary><p className="relevance">{r.relevance}</p></details>}
          <ul className="reading-stats" aria-label="This reading">
            <li><strong>{r.outcomeCount}</strong> outcomes</li><li><strong>{r.modules.length}</strong> module{r.modules.length === 1 ? '' : 's'}</li><li><strong>{r.pageCount}</strong> pages</li>
          </ul>
          <div className="reading-actions">
            {!r.structurePending && <LogLearningButton readingId={r.id} />}
            <Link href={`/app/coach?q=${encodeURIComponent(`I am struggling with Reading ${r.readingNo}: ${r.title}. What should I do next?`)}`} className="text-button">Ask the Coach &rarr;</Link>
          </div>
        </div>
      </header>


      {resultParam && (resultCtx?.error ? <p className="note" role="status">That result could not be checked just now, so its link was not added.</p>
        : resultCtx?.data ? <p className="note" role="status">From your result: <Link href={`/app/tests/${resultCtx.data.id}/result`}>open that result</Link>. Notes and cards here are your own practice; they do not change what the result shows.</p>
        : <p className="note" role="status">That result is not available to you, so nothing was linked.</p>)}
      {tab !== 'work' && selectedLos && <p className="note" role="status">About outcome: {r.modules.flatMap(m => m.outcomes).find(o => o.id === selectedLos)?.title}. <Link href={`/app/curriculum/${r.subject.id}/${r.id}?los=${selectedLos}#los-${selectedLos}`}>Show it in the reading</Link></p>}
      <nav className="reading-tabs" aria-label="Reading sections">
        {([['work', 'Work'], ['notes', noteCount.error ? 'Notes' : `Notes${(noteCount.count ?? 0) > 0 ? ' (saved)' : ''}`], ['cards', cardCount.error ? 'Cards' : `Cards (${cardCount.count ?? 0})`]] as const).map(([k, l]) => (
          <Link key={k} href={`/app/curriculum/${r.subject.id}/${r.id}?${new URLSearchParams({ ...(k !== 'work' ? { tab: k } : {}), ...(selectedLos ? { los: selectedLos } : {}), ...(resultCtx?.data ? { result: resultCtx.data.id } : {}), ...(back ? { return: back } : {}) })}`} aria-current={tab === k ? 'page' : undefined}>{l}</Link>
        ))}
      </nav>

      {tab === 'work' && readingStatus && readingStatus.learning.recordedSittings > 0 && (
        <section className="note" aria-label="Recorded learning">
          <strong>{readingStatus.learning.recordedSittings} recorded sitting{readingStatus.learning.recordedSittings === 1 ? '' : 's'}</strong>
          {' · '}{readingStatus.learning.confirmedOutcomes} of {readingStatus.rows.length} outcomes confirmed covered.
          {' '}This is study activity, not test evidence.
          {readingStatus.learning.awaitingConfirmation > 0 && <> <Link href="/app/tests#scope-h">Confirm what your other sittings covered</Link>.</>}
        </section>
      )}

      {tab === 'work' && selectedLos && <p className="note" role="status" data-selected-los><a href={`#los-${selectedLos}`}>Showing the outcome you came from</a>.</p>}
      {tab === 'work' && los && !selectedLos && <p className="note" role="status">That outcome is not part of this reading, so nothing is highlighted.</p>}
      {tab === 'work' && <RevisionStatus revision={overview?.byReading[readingId] ?? null} capability={capability} />}

      {tab === 'work' && (covRead?.error
        ? <p role="alert" className="review-error">Your reported coverage could not be loaded just now, so it is not shown. <Link href={`/app/curriculum/${r.subject.id}/${r.id}`}>Try again</Link></p>
        : <section aria-labelledby="cov-h" className="reading-coverage"><h2 id="cov-h">What have you covered of this reading?</h2>
            <CoverageControl readingId={r.id} topicId={r.subject.id} label={r.title}
              current={({ studied: 'covered', decaying: 'covered', verified: 'covered', taught: 'partly' } as Record<string, 'covered' | 'partly'>)[covRead?.data?.coverage_state as string] ?? 'not_started'}
              protectedBy={covRead?.data && (covRead.data.coverage_state === 'verified' || covRead.data.source === 'diagnostic') ? 'Your answers on a test already set this reading’s coverage, so it cannot be changed here.' : null} /></section>)}

      {tab === 'work' && !r.structurePending && readingStatus && (
        <section aria-labelledby="mark-h" className="reading-mark">
          <h2 id="mark-h">How confident are you in this reading?</h2>
          <MarkControl scopeType="reading" scopeId={r.id} current={readingStatus.selfMark} label={r.title} />
          <p className="mark-check">
            {CHECK_LABEL[readingStatus.markCheck]}
            {readingStatus.verdict !== 'none' && ` · what your tests show: ${VERDICT_LABEL[readingStatus.verdict]}`}
            {readingStatus.needsRevision && ' · this goes on your revision list'}
          </p>
          <p className="fine-print">Your own view. Test evidence checks it and is never changed by it.</p>
        </section>
      )}

      {tab === 'work' && (r.structurePending ? (
        <p className="note">The outcome structure for this subject is still being defined.</p>
      ) : (
        <details open={Boolean(selectedLos)} className="reading-outcomes">
          <summary><h2 id="outcomes-h" style={{ display: 'inline' }}>Modules and learning outcomes</h2> <span className="muted">({r.outcomeCount})</span></summary>
          {r.modules.map(m => (
            <div key={m.id} className="reading-module">
              <h3>Module {m.moduleNo}: {m.title} <small>p. {m.startPage}</small></h3>
              {m.outcomes.length === 0 ? <p className="muted">Its outcomes are listed under the neighbouring module.</p> : (
                <ol className="outcome-list" type="a">
                  {m.outcomes.map(o => (
                    <li key={o.id} id={`los-${o.id}`} className={selectedLos === o.id ? 'is-selected-los' : undefined} aria-current={selectedLos === o.id ? 'location' : undefined}>{o.title} <small>p. {o.page}</small>
                      {(() => {
                        const row = rowByOutcome.get(o.id)
                        if (!row) return null
                        return (
                          <>
                          <span className={`outcome-chip outcome-chip--${row.band}`}>{BAND[row.band]}</span>
                          <details className="outcome-more">
                            <summary>Details and your mark</summary>
                            <p className="outcome-status">
                              {row.progress !== 'not_started' ? PROGRESS[row.progress] : 'Not started'}
                              {row.classCoverage !== 'none' && ` · ${row.classCoverage === 'full' ? 'Covered in class' : 'Partly covered in class'}`}
                              {row.verdict !== 'none' && ` · ${VERDICT_LABEL[row.verdict]}`}
                              {row.markCheck !== 'unmarked' && ` · ${CHECK_LABEL[row.markCheck]}`}
                              {row.needsRevision && ' · revision list'}
                            </p>
                          {row.classReports && row.classReports.length > 0 && <details>
                            <summary>Class reports ({row.classReports.length})</summary>
                            <ul>{row.classReports.map(report => <li key={report.sessionId}>
                              <Link href={classLogHref({ sessionId: report.sessionId })}>{report.label} on {report.date}</Link> · {report.extent === 'full' ? 'Whole outcome' : 'Partly covered'}
                            </li>)}</ul>
                          </details>}
                          <div className="outcome-controls">
                            <MarkControl scopeType="outcome" scopeId={o.id} current={row.selfMark} label={o.title} />
                            <OverrideControl outcomeId={o.id} current={row.override ? { band: row.override.band, reason: row.override.reason } : null} />
                          </div>
                          </details>
                          </>
                        )
                      })()}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </details>
      ))}

      {!r.structurePending && (
        <>
          {tab === 'notes' && <section aria-labelledby="notes-h" className="reading-notes">
            <h2 id="notes-h">Your notes</h2>
            {noteError ? <SectionFailed what="Your notes" /> : <NoteEditor ownerId={user.id} scopeType="reading" scopeId={r.id} label={r.title}
              initialDoc={note?.doc ?? starterDoc('reading')} initialRevision={(note?.revision as number | undefined) ?? 0} />}
          </section>}
          {tab === 'cards' && <section aria-labelledby="cards-h" className="reading-cards">
            <h2 id="cards-h">Flashcards</h2>
            <FlashcardPanel scopeType="reading" scopeId={r.id} label={r.title} />
          </section>}
        </>
      )}

      {tab === 'work' && !r.structurePending && (
        <p><Link href={`/app/calendar/log-class?reading=${r.id}`} className="secondary-button">Log class coverage for this reading</Link></p>
      )}

      <nav className="reading-nav" aria-label="Neighbouring readings">
        {r.prev ? <Link href={`/app/curriculum/${r.subject.id}/${r.prev.id}`}>&larr; {r.prev.title}</Link> : <span />}
        {r.next ? <Link href={`/app/curriculum/${r.subject.id}/${r.next.id}`}>{r.next.title} &rarr;</Link> : <span />}
      </nav>
    </div>
  )
}
