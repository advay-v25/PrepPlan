import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { AttemptRunner } from '../../../../components/tests/AttemptRunner'
import { paperUnavailable, validPaperId } from '../../../../lib/tests/paperLinks'

export const metadata = { title: 'Take your paper' }

export default async function DiagnosticAttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params
  if (!validPaperId(attemptId)) paperUnavailable()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: attempt } = await supabase
    .from('assessment_attempts')
    .select('id, status, rehearsal_id, deadline_at')
    .eq('id', attemptId)
    .eq('user_id', user.id)
    .maybeSingle().throwOnError()

  if (!attempt) {
    paperUnavailable()
  }

  // A rehearsal session whose clock has not been started is opened from the hub, where its Start button is.
  if (attempt.rehearsal_id && attempt.deadline_at === null && ['ready', 'in_progress'].includes(attempt.status as string)) redirect(`/app/tests/rehearsal/${attempt.rehearsal_id}`)
  if (attempt.rehearsal_id && !['ready', 'in_progress'].includes(attempt.status as string)) redirect(`/app/tests/rehearsal/${attempt.rehearsal_id}`)
  if (attempt.status === 'scored') {
    redirect(`/app/tests/${attempt.id}/result`)
  }
  if (attempt.status !== 'ready' && attempt.status !== 'in_progress') paperUnavailable()

  return (
    <div className="page-content tests-page" style={{ paddingTop: 40 }}>
      <AttemptRunner attemptId={attempt.id} />
    </div>
  )
}
