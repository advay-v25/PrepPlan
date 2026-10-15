import { redirect } from 'next/navigation'
import { createClient } from '../../../../lib/supabase/server'
import { AttemptRunner } from '../../../../components/tests/AttemptRunner'

export default async function DiagnosticAttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const resolvedParams = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: attempt } = await supabase
    .from('assessment_attempts')
    .select('id, status')
    .eq('id', resolvedParams.attemptId)
    .eq('user_id', user.id)
    .single()

  if (!attempt) {
    redirect('/app/tests')
  }

  if (attempt.status === 'scored' || attempt.status === 'completed') {
    redirect(`/app/tests/${attempt.id}/result`)
  }

  return (
    <div className="page-content tests-page" style={{ paddingTop: 40 }}>
      <AttemptRunner attemptId={attempt.id} />
    </div>
  )
}
