import { CalendarCheck, Check, Clock3, Target, ShieldCheck, Repeat2 } from 'lucide-react'

const DAYS = [
  { d: 'Mon', t: 'Ethics', m: '45 min' }, { d: 'Tue', t: 'Quant methods', m: '60 min' }, { d: 'Wed', t: 'Rest', m: '' },
  { d: 'Thu', t: 'Economics', m: '45 min' }, { d: 'Fri', t: 'Quant recap', m: '30 min' }, { d: 'Sat', t: 'Review', m: '60 min' }, { d: 'Sun', t: 'Paper', m: '90 min' },
]

function Points({ items }: { items: { Icon: typeof Target; title: string; text: string }[] }) {
  return (
    <ol className="su-steps">
      {items.map(({ Icon, title, text }) => <li key={title}><span><Icon size={18} aria-hidden /></span><div><strong>{title}</strong><small>{text}</small></div></li>)}
    </ol>
  )
}

/** The dark panel is the same dark in every theme, so its colours are fixed in CSS. */
export function SignupAside() {
  return (
    <aside className="su-aside" aria-label="What happens next">
      <div className="su-aside__inner">
        <h2>Your first week, planned</h2>
        <p>Study around your life, not the other way round</p>
        <div className="su-week" role="img" aria-label="Example week: study sessions most days, a rest day on Wednesday and a practice paper on Sunday">
          <span className="su-week__tag">Example week</span>
          <ul>{DAYS.map(x => <li key={x.d} className={x.t === 'Rest' ? 'is-rest' : x.t === 'Paper' ? 'is-paper' : ''}><b>{x.d}</b><span>{x.t}</span><em>{x.m}</em></li>)}</ul>
        </div>
        <Points items={[
          { Icon: Target, title: '1. Set your exam', text: 'Pick the sitting you are aiming for' },
          { Icon: Clock3, title: '2. Share your week', text: 'Tell us when you can study' },
          { Icon: CalendarCheck, title: '3. Get your plan', text: 'A week you can actually follow' },
        ]} />
      </div>
    </aside>
  )
}

export function LoginAside() {
  return (
    <aside className="su-aside" aria-label="About PrepPlan">
      <div className="su-aside__inner">
        <h2>Pick up where you left off</h2>
        <p>Your week is waiting, rebuilt from what you actually did</p>
        <div className="su-week" role="img" aria-label="Example of today: two tasks done, one to do and a paper on Sunday">
          <span className="su-week__tag">Example, today</span>
          <ul>
            <li className="is-done"><b><Check size={14} aria-hidden /></b><span>Quant: time value of money</span><em>60 min</em></li>
            <li className="is-done"><b><Check size={14} aria-hidden /></b><span>Ethics: code and standards</span><em>45 min</em></li>
            <li><b />  <span>Economics: demand and supply</span><em>45 min</em></li>
            <li className="is-paper"><b>Sun</b><span>Weekly paper</span><em>90 min</em></li>
          </ul>
        </div>
        <Points items={[
          { Icon: Repeat2, title: 'Rebuilt every Sunday', text: 'From what you covered and got right' },
          { Icon: ShieldCheck, title: 'Four signals, never one score', text: 'No pass predictions' },
        ]} />
      </div>
    </aside>
  )
}
