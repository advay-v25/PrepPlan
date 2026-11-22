import Link from 'next/link'
import type { StretchPlan } from '../../lib/exam/finalStretch'

/** The final stretch: a few things to do, in priority order, and what is waiting and why. */
export function FinalStretchView({ plan }: { plan: StretchPlan }) {
  return (
    <section aria-labelledby="stretch-h" data-final-stretch>
      <h2 id="stretch-h">{plan.headline}</h2>
      <p className="muted">{plan.note}</p>
      <ol>{plan.items.map(i => <li key={i.key} data-stretch={i.kind}><Link href={i.href}><strong>{i.title}</strong></Link>{i.minutes ? ` · ${i.minutes >= 60 ? `${Math.round(i.minutes / 6) / 10} h` : `${i.minutes} min`}` : ''}{i.status === 'on_calendar' && i.date ? <small> · on your calendar {i.date}</small> : i.status === 'proposal' ? <small> · review a proposal first</small> : null}<br /><span className="muted">{i.why}</span></li>)}</ol>
      {plan.waits.length > 0 && (<><h3>Waiting, on purpose</h3><ul data-stretch-waits>{plan.waits.map(w => <li key={w.title}><strong>{w.title}</strong> — {w.reason}</li>)}</ul></>)}
    </section>
  )
}
