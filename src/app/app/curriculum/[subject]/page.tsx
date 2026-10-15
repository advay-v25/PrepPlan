import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { getSubjectReadings } from '../../../../lib/curriculum/spine'
import { NoteEditor } from '../../../../components/curriculum/NoteEditor'
import { FlashcardPanel } from '../../../../components/curriculum/FlashcardPanel'
import { starterDoc } from '../../../../lib/curriculum/notes/doc'
import { getLosTracker } from '../../../../lib/curriculum/losTrackerService'

export const dynamic = 'force-dynamic'

/** One subject: every reading as a card, in syllabus order. A pure read. */
export default async function SubjectPage({ params }: { params: Promise<{ subject: string }> }) {
  const { subject: subjectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/curriculum/${subjectId}`)

  const data = await getSubjectReadings(subjectId)
  if (!data) notFound()
  const { subject, readings } = data
  const { data: note } = await supabase.from('curriculum_notes').select('doc, revision').eq('scope_type', 'subject').eq('scope_id', subject.id).maybeSingle()
  const tracker = await getLosTracker(user.id)
  const status = new Map((tracker.topics.find(t => t.id === subject.id)?.modules ?? []).map(m => [m.id, m]))
  const COVER: Record<string, string> = { taught: 'Covered in class', studied: 'Studied', verified: 'Verified by a paper', decaying: 'Going stale' }

  return (
    <div className="page-content curriculum-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/curriculum?view=overview">Curriculum</Link> / {subject.name}</nav>
      <header className="page-header">
        <div>
          <h1>{subject.name}</h1>
          <p>{subject.summary} About {subject.weightMin}–{subject.weightMax}% of the exam. {subject.readingCount} readings.</p>
        </div>
      </header>
      {subject.structurePending && <p className="note">The outcome structure for this subject is still being defined. Readings are listed; details will follow.</p>}
      <ul className="reading-grid">
        {readings.map(r => (
          <li key={r.id}>
            <Link href={`/app/curriculum/${subject.id}/${r.id}`} className="reading-card">
              <span className="reading-card__no">Reading {r.readingNo}</span>
              <strong>{r.title}</strong>
              {r.summary && <span className="reading-card__summary">{r.summary}</span>}
              {(() => {
                const m = status.get(r.id)
                if (!m) return null
                const parts = [['Repair', m.counts.repair], ['Verify', m.counts.verify], ['Maintain', m.counts.maintain]].filter(([, n]) => Number(n) > 0)
                const bits = [COVER[m.coverage], ...parts.map(([l, n]) => `${n} ${l}`)].filter(Boolean)
                return bits.length ? <span className="reading-card__meta">{bits.join(' · ')}</span> : null
              })()}
              <span className="reading-card__meta">
                {r.structurePending ? 'Structure to come' : `${r.moduleCount} module${r.moduleCount === 1 ? '' : 's'} · ${r.outcomeCount} outcome${r.outcomeCount === 1 ? '' : 's'}`} · {r.pageCount} pages
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="subject-notes-h" className="reading-notes">
        <h2 id="subject-notes-h">Your notes on {subject.name}</h2>
        <NoteEditor scopeType="subject" scopeId={subject.id} label={subject.name}
          initialDoc={note?.doc ?? starterDoc('subject')} initialRevision={(note?.revision as number | undefined) ?? 0} />
      </section>
      <section aria-labelledby="subject-cards-h" className="reading-cards">
        <h2 id="subject-cards-h">Flashcards for {subject.name}</h2>
        <FlashcardPanel scopeType="subject" scopeId={subject.id} label={subject.name} />
      </section>
    </div>
  )
}
