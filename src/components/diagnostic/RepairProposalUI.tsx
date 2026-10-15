'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, CalendarPlus, CheckCircle2, Loader2 } from 'lucide-react'

type ProposalTask = {
  title: string
  detail: string
  taskType: string
  durationMinutes: number
  rationale: string
  earliestDate: string
  suggestedApproach: string | null
}

type Proposal = {
  attemptId: string
  takenOn: string
  targetWeekLabel: string
  targetWeekStart: string
  targetWeekEnd: string
  rolledOver: boolean
  reason: string
  tasks: ProposalTask[]
}

/**
 * The diagnostic-to-calendar handoff, shown as a reviewable difference.
 *
 * The student sees exactly what will be added and which study week it lands in
 * before anything is written. Nothing here mutates an accepted week on its own.
 */
export function RepairProposalUI({ attemptId, needsRepairCount }: { attemptId: string; needsRepairCount: number }) {
  const router = useRouter()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState<{ count: number; weekStart: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/diagnostic/repair?attemptId=${encodeURIComponent(attemptId)}`, { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        if (data.ok) setProposal(data.proposal)
        else setError(data.error || 'Could not work out the follow-up')
      } catch {
        if (!cancelled) setError('Network error')
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [attemptId])

  async function apply() {
    setApplying(true)
    setError('')
    try {
      const res = await fetch('/api/diagnostic/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error || 'Could not add the work'); setApplying(false); return }
      setApplied({ count: data.created ?? 0, weekStart: data.targetWeekStart })
      router.refresh()
    } catch {
      setError('Network error')
    }
    setApplying(false)
  }

  if (loading) {
    return <p className="fine-print"><Loader2 size={13} className="animate-spin" aria-hidden /> Working out what follows from this…</p>
  }

  if (applied) {
    return (
      <div className="proposal-applied">
        <span className="status-line"><i />{applied.count} task{applied.count === 1 ? '' : 's'} added to your calendar</span>
        <Link href={`/app/calendar?week=${applied.weekStart}`} className="primary-button">
          <CalendarPlus size={16} aria-hidden /> See it in the calendar
        </Link>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div style={{ fontSize: '0.9rem' }}>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <p>{needsRepairCount > 0
          ? 'These weaknesses are already tracked. Check your Calendar for existing repair work, or prepare the next week if no active plan is shown.'
          : 'Nothing from this attempt needs repair. Widen the scope of your next diagnostic.'}</p>
        <Link href="/app/calendar" className="text-button">Open Calendar →</Link>
      </div>
    )
  }

  const repairs = proposal.tasks.filter(t => t.taskType !== 'recheck')
  const rechecks = proposal.tasks.filter(t => t.taskType === 'recheck')

  return (
    <div className="proposal">
      <div className="proposal__where">
        <strong>
          {proposal.rolledOver ? 'Lands in next week' : 'Fits in this week'}
          {': '}
          {proposal.targetWeekLabel}
        </strong>
        <p className="fine-print">{proposal.reason}</p>
      </div>

      <ul className="proposal__list">
        {repairs.map((t, i) => (
          <li key={i} className="proposal__item layer-repair">
            <span className="proposal__date">{t.earliestDate.slice(5)}</span>
            <span>
              <strong>{t.title}</strong>
              <small>{t.durationMinutes} min · {t.rationale}</small>
            </span>
          </li>
        ))}
        {rechecks.map((t, i) => (
          <li key={`r${i}`} className="proposal__item layer-recheck">
            <span className="proposal__date">{t.earliestDate.slice(5)}</span>
            <span>
              <strong>{t.title}</strong>
              <small>{t.durationMinutes} min · {t.rationale}</small>
            </span>
          </li>
        ))}
      </ul>

      {error && <p className="auth-error">{error}</p>}

      <button className="primary-button" onClick={apply} disabled={applying}>
        {applying
          ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Adding…</>
          : <><CheckCircle2 size={16} aria-hidden /> Add {proposal.tasks.length} task{proposal.tasks.length === 1 ? '' : 's'} to my calendar <ArrowRight size={15} aria-hidden /></>}
      </button>
      <p className="fine-print">
        These are added as day-preferred work: the date is set, the hour is not. You place them where they
        actually fit.
      </p>
    </div>
  )
}
