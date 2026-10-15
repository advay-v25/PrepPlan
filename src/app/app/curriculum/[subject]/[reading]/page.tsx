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

export const dynamic = 'force-dynamic'

/** One reading: what it covers, its modules and learning outcomes. A pure read. */
export default async function ReadingPage({ params }: { params: Promise<{ subject: string; reading: string }> }) {
  const { subject, reading: readingId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/curriculum/${subject}/${readingId}`)

  const r = await getReading(subject, readingId)
  if (!r) notFound()
  const { data: note } = await supabase.from('curriculum_notes').select('doc, revision').eq('scope_type', 'reading').eq('scope_id', readingId).maybeSingle()
  const tracker = await getLosTracker(user.id)
  const readingStatus = tracker.topics.find(t => t.id === subject)?.modules.find(m => m.id === readingId)
  const rowByOutcome = new Map((readingStatus?.rows ?? []).map(x => [x.outcomeId, x]))
  const BAND: Record<string, string> = { repair: 'Repair', verify: 'Verify', maintain: 'Maintain', untested: 'Untested' }
  const PROGRESS: Record<string, string> = { not_started: 'Not started', scheduled: 'Scheduled', in_progress: 'Worked — awaiting retest', retest_due: 'Retest due', complete: 'Holding' }

  return (
    <div className="page-content curriculum-page reading-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/app/curriculum?view=overview">Curriculum</Link> / <Link href={`/app/curriculum/${r.subject.id}`}>{r.subject.name}</Link> / Reading {r.readingNo}
      </nav>
      <header className="page-header">
        <div>
          <p className="eyebrow">Reading {r.readingNo} · {r.subject.name}</p>
          <h1>{r.title}</h1>
          {r.summary && <p>{r.summary}</p>}
          {r.relevance && <p className="relevance"><strong>Why it matters:</strong> {r.relevance}</p>}
          <p><Link href={`/app/coach?q=${encodeURIComponent(`I am struggling with Reading ${r.readingNo}: ${r.title}. What should I do next?`)}`} className="text-button">Ask the Coach about this reading &rarr;</Link></p>
        </div>
      </header>

      {!r.structurePending && readingStatus && (
        <section aria-labelledby="mark-h" className="reading-mark">
          <h2 id="mark-h">How confident are you in this reading?</h2>
          <MarkControl scopeType="reading" scopeId={r.id} current={readingStatus.selfMark} label={r.title} />
          <p className="mark-check">
            {CHECK_LABEL[readingStatus.markCheck]}
            {readingStatus.verdict !== 'none' && ` · what your tests show: ${VERDICT_LABEL[readingStatus.verdict]}`}
            {readingStatus.needsRevision && ' · this goes on your revision list'}
          </p>
          <p className="muted">Your mark is your own view. Test evidence checks it — and never changes because of it.</p>
        </section>
      )}

      {r.structurePending ? (
        <p className="note">The outcome structure for this subject is still being defined.</p>
      ) : (
        <section aria-labelledby="outcomes-h">
          <h2 id="outcomes-h">Modules and learning outcomes</h2>
          {r.modules.map(m => (
            <div key={m.id} className="reading-module">
              <h3>Module {m.moduleNo}: {m.title} <small>p. {m.startPage}</small></h3>
              {m.outcomes.length === 0 ? <p className="muted">Its outcomes are listed under the neighbouring module.</p> : (
                <ol className="outcome-list" type="a">
                  {m.outcomes.map(o => (
                    <li key={o.id}>{o.title} <small>p. {o.page}</small>
                      {(() => {
                        const row = rowByOutcome.get(o.id)
                        if (!row) return null
                        return (
                          <>
                          <span className="outcome-status">
                            {' '}<strong>{BAND[row.band]}</strong>
                            {row.progress !== 'not_started' && ` · ${PROGRESS[row.progress]}`}
                            {row.classCoverage !== 'none' && ` · ${row.classCoverage === 'full' ? 'Covered in class' : 'Partly covered in class'}`}
                            {row.verdict !== 'none' && ` · ${VERDICT_LABEL[row.verdict]}`}
                            {row.markCheck !== 'unmarked' && ` · ${CHECK_LABEL[row.markCheck]}`}
                            {row.needsRevision && ' · revision list'}
                          </span>
                          <div className="outcome-controls">
                            <MarkControl scopeType="outcome" scopeId={o.id} current={row.selfMark} label={o.title} />
                            <OverrideControl outcomeId={o.id} current={row.override ? { band: row.override.band, reason: row.override.reason } : null} />
                          </div>
                          </>
                        )
                      })()}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </section>
      )}

      {!r.structurePending && (
        <>
          <section aria-labelledby="notes-h" className="reading-notes">
            <h2 id="notes-h">Your notes</h2>
            <NoteEditor scopeType="reading" scopeId={r.id} label={r.title}
              initialDoc={note?.doc ?? starterDoc('reading')} initialRevision={(note?.revision as number | undefined) ?? 0} />
          </section>
          <section aria-labelledby="cards-h" className="reading-cards">
            <h2 id="cards-h">Flashcards</h2>
            <FlashcardPanel scopeType="reading" scopeId={r.id} label={r.title} />
          </section>
        </>
      )}

      {!r.structurePending && (
        <p><Link href={`/app/calendar/log-class?reading=${r.id}`} className="secondary-button">Log class coverage for this reading</Link></p>
      )}

      <p className="reading-facts">{r.pageCount} pages in the 2027 volume.</p>

      <nav className="reading-nav" aria-label="Neighbouring readings">
        {r.prev ? <Link href={`/app/curriculum/${r.subject.id}/${r.prev.id}`}>&larr; {r.prev.title}</Link> : <span />}
        {r.next ? <Link href={`/app/curriculum/${r.subject.id}/${r.next.id}`}>{r.next.title} &rarr;</Link> : <span />}
      </nav>
    </div>
  )
}
