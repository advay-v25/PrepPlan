import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../../lib/supabase/server'
import { listExamHistory, loadExamStatus } from '../../../lib/exam/status'
import { loadFinalStretch } from '../../../lib/exam/finalStretchService'
import { ExamPanel } from '../../../components/exam/ExamPanel'
import { FinalStretchView } from '../../../components/exam/FinalStretchView'

export const metadata = { title: 'Exam status' }

export const dynamic = 'force-dynamic'

export default async function ExamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const [status, history] = await Promise.all([loadExamStatus(user.id), listExamHistory(user.id).catch(() => null)])
  const stretch = status.phase === 'sat' ? null : await loadFinalStretch(user.id, status).catch(() => null)
  return (
    <div className="page-content">
      <header className="page-header"><div><p className="eyebrow">Exam</p><h1>{status.examDate ? `Exam on ${status.examDate}` : 'Your exam'}</h1></div><Link href="/app" className="text-button">&larr; Home</Link></header>
      {stretch && <FinalStretchView plan={stretch} />}
      <ExamPanel status={status} />
      {history === null ? <p role="status">Previous sittings could not be loaded. <Link href="/app/exam">Try again</Link>.</p> : history.length > 0 && (
        <section aria-labelledby="exam-history-h" className="note">
          <h2 id="exam-history-h">Previous sittings</h2>
          <ul>{history.map(sitting => <li key={sitting.id}>
            Sat on {sitting.sat_on}{sitting.reported_result ? ` · Your reported result: ${sitting.reported_result}` : ''}
            {' · '}<Link href={`/app/calendar?week=${sitting.sat_on}`}>Calendar at this sitting</Link>
          </li>)}</ul>
          <Link href="/app/tests#history">Paper history</Link>{' · '}<Link href="/app/calendar#mock-reports-h">Mock reports</Link>
        </section>
      )}
    </div>
  )
}
