import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { DueFlashcards } from '../../../../components/curriculum/DueFlashcards'

export const dynamic = 'force-dynamic'

/** Everything due for review across your subjects and readings. A pure read. */
export default async function FlashcardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/curriculum/flashcards')
  return (
    <div className="page-content curriculum-page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/app/curriculum">Curriculum</Link> / Flashcards</nav>
      <h1>Flashcards due</h1>
      <p>Your recall ratings decide when a card comes back. They never change your readiness — only tests do.</p>
      <DueFlashcards />
    </div>
  )
}
