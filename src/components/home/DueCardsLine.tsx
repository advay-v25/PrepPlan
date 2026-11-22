import Link from 'next/link'
import { createClient } from '../../lib/supabase/server'

/**
 * One quiet line: how many of the student's own recall cards are due. A read only; it plans nothing, creates no task and moves nothing. A failed count shows
 * nothing (not "0 due"). Recall practice is the student's own report and is never evidence, so it is not presented as progress.
 */
export async function DueCardsLine() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [due, all] = await Promise.all([
    supabase.from('flashcards').select('id', { count: 'exact', head: true }).eq('suspended', false).lte('due_at', new Date().toISOString()),
    supabase.from('flashcards').select('id', { count: 'exact', head: true }),
  ])
  if (due.error || all.error || due.count === null || !all.count) return null
  return <p className="muted home-due-cards">{due.count > 0 ? <><Link className="prose-link" href="/app/curriculum/flashcards">{due.count} recall card{due.count === 1 ? '' : 's'} due</Link> · optional practice, your own report.</> : 'No recall cards due right now.'}</p>
}
