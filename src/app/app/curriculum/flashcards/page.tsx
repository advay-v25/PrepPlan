import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { DueFlashcards } from '../../../../components/curriculum/DueFlashcards'
import { getWorkspaceRows } from '../../../../lib/curriculum/workspaceIndex'

export const metadata = { title: 'Flashcards' }

export const dynamic = 'force-dynamic'

/** Everything due for review across your subjects and readings. A pure read. */
export default async function FlashcardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/curriculum/flashcards')
  const rows = await getWorkspaceRows(user.id, supabase).then(w => w.rows).catch(() => null)
  const withCards = (rows ?? []).filter(r => r.cards > 0)
  const back = encodeURIComponent('/app/curriculum/flashcards')
  return (
    <div className="page-content curriculum-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/curriculum">Curriculum</Link> / Flashcards</nav>
      <h1>Flashcards due</h1>
      <p>Your recall ratings decide when a card comes back. They are your own report and never change what the tests show.</p>
      <DueFlashcards />
      <h2>Your cards by reading</h2>
      {rows === null ? <p role="alert" className="review-error">Your cards by reading could not be listed just now. Nothing was changed. <Link href="/app/curriculum/flashcards">Try again</Link></p>
        : withCards.length === 0 ? <p className="muted">No cards yet. Open a reading, choose Cards, and add one when it helps. Cards are optional.</p>
        : <ul className="reading-list">{withCards.map(r => <li key={r.readingId}><Link href={`/app/curriculum/${r.subjectId}/${r.readingId}?tab=cards&return=${back}`}>Reading {r.readingNo}: {r.title}</Link> <span className="muted">· {r.cards} card{r.cards === 1 ? '' : 's'}{r.due > 0 ? ` · ${r.due} due` : ''}</span></li>)}</ul>}
    </div>
  )
}
