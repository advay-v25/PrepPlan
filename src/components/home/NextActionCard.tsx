import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { ActionableDecision } from '../../lib/state/types'

/** The real verb for what the button does — resuming a task, taking a paper and reviewing a week are different actions. */
function verbFor(action: ActionableDecision): string {
  switch (action.code) {
    case 'recover_activation': return action.permittedCommands.includes('start_activation') ? 'Review my week' : 'Retry'
    case 'resolve_conflict': return 'Refresh'
    case 'resume_task': return 'Resume'
    case 'complete_logs': return 'Log activities'
    case 'take_paper': return action.permittedCommands.includes('resume_paper') ? 'Resume paper' : 'Start paper'
    case 'review_scored_paper': return 'Review result'
    case 'review_repair': return 'Review proposal'
    case 'start_timed_task':
    case 'start_preferred_task': return 'Start session'
    case 'review_draft': return 'Review this week'
    case 'place_task': return 'Schedule it'
    case 'complete_closure': return 'Review this week'
    default: return 'See the week'
  }
}

const KIND: Record<string, string> = {
  study: 'Study', class_consolidation: 'Class follow-up', repair: 'Weak area', recheck: 'Check again',
  review: 'Review', verification: 'Check understanding', diagnostic: 'Paper', mock: 'Mock',
}

export function NextActionCard({ action }: { action: ActionableDecision }) {
  const kind = KIND[action.scope] ?? null
  const minutes = action.expectedDurationMinutes && action.expectedDurationMinutes > 0 ? action.expectedDurationMinutes : null
  const empty = action.code === 'honest_empty'
  return (
    <section className={`next-up ${empty ? 'next-up--quiet' : ''}`} aria-labelledby="next-up-h">
      <div className="next-up__body">
        <p className="next-up__eyebrow">{empty ? 'Today' : 'Up next'}{kind ? <span className="next-up__kind">{kind}</span> : null}</p>
        <h2 id="next-up-h">{action.title}</h2>
        <p className="next-up__why">{action.rationale}</p>
      </div>
      <div className="next-up__side">
        {minutes && (
          <p className="next-up__duration"><strong>{minutes}</strong><span>min</span></p>
        )}
        <Link href={action.destination} className="next-up__cta">
          {empty ? 'See the week' : verbFor(action)} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  )
}
