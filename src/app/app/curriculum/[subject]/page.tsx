import { SectionFailed } from '../../../../components/home/SectionFailed'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { getSubjectReadings } from '../../../../lib/curriculum/spine'
import { NoteEditor } from '../../../../components/curriculum/NoteEditor'
import { FlashcardPanel } from '../../../../components/curriculum/FlashcardPanel'
import { starterDoc } from '../../../../lib/curriculum/notes/doc'
import { getLosTracker } from '../../../../lib/curriculum/losTrackerService'
import { getRevisionOverview } from '../../../../lib/curriculum/revisionOverview'
import { safeInAppReturn } from '../../../../lib/curriculum/workspaceIndex'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ subject: string }> }) {
  const data = await getSubjectReadings((await params).subject)
  return { title: data?.subject.name ?? 'Subject unavailable' }
}

/** One subject: every reading as a card, in syllabus order. A pure read. */
export default async function SubjectPage({ params, searchParams }: { params: Promise<{ subject: string }>; searchParams: Promise<{ q?: string; tab?: string; return?: string }> }) {
  const { subject: subjectId } = await params
  const { q: qParam, tab: tabParam, return: returnParam } = await searchParams
  const tab = tabParam === 'notes' ? 'notes' : tabParam === 'cards' ? 'cards' : 'work'
  const q = (qParam ?? '').slice(0, 100), back = safeInAppReturn(returnParam)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/app/curriculum/${subjectId}`)

  const data = await getSubjectReadings(subjectId)
  if (!data) notFound()
  const { subject, readings } = data
  const [noteRead, tracker, overview] = await Promise.all([
    tab === 'notes' ? supabase.from('curriculum_notes').select('doc, revision').eq('scope_type', 'subject').eq('scope_id', subject.id).maybeSingle() : null,
    tab === 'work' ? getLosTracker(user.id) : null,
    tab === 'work' ? getRevisionOverview(user.id).catch(() => null) : null,
  ])
  const note = noteRead?.data, noteError = noteRead?.error
  const status = new Map((tracker?.topics.find(t => t.id === subject.id)?.modules ?? []).map(m => [m.id, m]))
  const shownReadings = q ? readings.filter(r => `${r.title} reading ${r.readingNo}`.toLowerCase().includes(q.toLowerCase())) : readings
  const COVER: Record<string, string> = { taught: 'Covered in class', studied: 'Studied', verified: 'Verified by a paper', decaying: 'Going stale' }

  return (
    <div className="page-content curriculum-page">
      <nav className="crumbs" aria-label="Breadcrumb">{back && <><Link href={back}>&larr; Back</Link> · </>}<Link href="/app/curriculum?view=overview">Curriculum</Link> / {subject.name}</nav>
      <header className="page-header">
        <div>
          <h1>{subject.name}</h1>
          <p className="reading-summary">{subject.summary}</p>
          <ul className="reading-stats" aria-label="This subject"><li><strong>{subject.weightMin}–{subject.weightMax}%</strong> of the exam</li><li><strong>{subject.readingCount}</strong> readings</li></ul>
        </div>
      </header>
      {subject.structurePending && <p className="note">The outcome structure for this subject is still being defined. Readings are listed; details will follow.</p>}
      <nav className="reading-tabs" aria-label="Subject sections">
        {([['work', 'Readings'], ['notes', 'Notes'], ['cards', 'Cards']] as const).map(([k, l]) => (
          <Link key={k} href={`/app/curriculum/${subject.id}${k === 'work' ? '' : `?tab=${k}`}${back ? `${k === 'work' ? '?' : '&'}return=${encodeURIComponent(back)}` : ''}`} aria-current={tab === k ? 'page' : undefined}>{l}</Link>
        ))}
      </nav>
      {tab === 'work' && <form role="search" method="get" className="curriculum-search"><label>Find a reading <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Title or number" /></label> <button type="submit" className="secondary-button">Search</button>{q && <Link href={`/app/curriculum/${subject.id}`} className="text-button">Clear</Link>}</form>}
      {tab === 'work' && shownReadings.length === 0 && <p className="muted">{q ? 'No reading in this subject matches that search.' : 'No readings are listed.'}</p>}
      {tab === 'work' && <ul className="reading-grid">
        {shownReadings.map(r => (
          <li key={r.id}>
            <Link href={`/app/curriculum/${subject.id}/${r.id}${back ? `?return=${encodeURIComponent(back)}` : ''}`} className="reading-card">
              <span className="reading-card__no">Reading {r.readingNo}</span>
              <strong>{r.title}</strong>
              {(() => {
                const m = status.get(r.id)
                if (!m) return null
                const parts = [['Repair', m.counts.repair], ['Verify', m.counts.verify], ['Maintain', m.counts.maintain]].filter(([, n]) => Number(n) > 0)
                const bits = [COVER[m.coverage], ...parts.map(([l, n]) => `${n} ${l}`), overview?.byReading[r.id]?.status === 'in_plan' || overview?.byReading[r.id]?.status === 'next' ? `Revision: ${overview.byReading[r.id].label.toLowerCase()}` : null].filter(Boolean)
                return bits.length ? <span className="reading-card__meta">{bits.join(' · ')}</span> : null
              })()}
              <span className="reading-card__meta">
                {r.structurePending ? 'Structure to come' : `${r.moduleCount} module${r.moduleCount === 1 ? '' : 's'} · ${r.outcomeCount} outcome${r.outcomeCount === 1 ? '' : 's'}`} · {r.pageCount} pages
              </span>
            </Link>
          </li>
        ))}
      </ul>}

      {tab === 'notes' && <section aria-labelledby="subject-notes-h" className="reading-notes">
        <h2 id="subject-notes-h">Your notes on {subject.name}</h2>
        {noteError ? <SectionFailed what="Your notes" /> : <NoteEditor ownerId={user.id} scopeType="subject" scopeId={subject.id} label={subject.name}
          initialDoc={note?.doc ?? starterDoc('subject')} initialRevision={(note?.revision as number | undefined) ?? 0} />}
      </section>}
      {tab === 'cards' && <section aria-labelledby="subject-cards-h" className="reading-cards">
        <h2 id="subject-cards-h">Flashcards for {subject.name}</h2>
        <FlashcardPanel scopeType="subject" scopeId={subject.id} label={subject.name} />
      </section>}
    </div>
  )
}
