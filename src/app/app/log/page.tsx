import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { LogLearningSheet } from '../../../components/log/LogLearningSheet'

export const metadata = { title: 'Log learning' }

export const dynamic = 'force-dynamic'

/** The same Log learning sheet Home opens in a dialog, as a page for deep links (?reading=r028). */
export default async function LogLearningPage({ searchParams }: { searchParams: Promise<{ reading?: string; task?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/log')
  const { reading, task } = await searchParams
  const { data: profile } = await supabase.from('profiles').select('prep_mode, class_pattern').eq('id', user.id).maybeSingle()
  const classLed = (profile?.prep_mode === 'instructor_led' || profile?.prep_mode === 'hybrid') && !!profile?.class_pattern && profile.class_pattern !== 'none'

  return (
    <main className="page-content log-page">
      <Link href={task ? '/app/calendar' : '/app'} className="log-page__back"><ArrowLeft size={16} aria-hidden /> {task ? 'Calendar' : 'Home'}</Link>
      <header className="log-page__head">
        <h1>Log learning</h1>
        <p>Record study that already happened, against a planned block or as a separate session. Only covered outcomes in your open week can enter a new paper; logging does not prove understanding.</p>
      </header>
      <section className="log-page__card">
        <LogLearningSheet classLed={classLed} initialReadingId={reading} initialTaskId={task} />
      </section>
    </main>
  )
}
