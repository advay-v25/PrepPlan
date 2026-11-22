'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Lock } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { animate } from 'animejs'

type Task = { id: string; day: string; title: string; when: string; min: number; done: boolean; paper?: boolean }
const WEEK: Task[] = [
  { id: 'a', day: 'Mon', title: 'Ethics: code and standards', when: '7:30pm', min: 45, done: true },
  { id: 'b', day: 'Tue', title: 'Quant: time value of money', when: '7:30pm', min: 60, done: true },
  { id: 'c', day: 'Thu', title: 'Economics: demand and supply', when: '7:30pm', min: 45, done: false },
  { id: 'd', day: 'Fri', title: 'Quant: re-do Tuesday’s misses', when: '12:30pm', min: 30, done: false },
  { id: 'e', day: 'Sat', title: 'Review the week’s notes', when: '10:00am', min: 60, done: false },
  { id: 'f', day: 'Sun', title: 'Weekly paper', when: '10:00am', min: 90, done: false, paper: true },
]
const TABS = [
  { key: 'plan', label: 'Plan', title: 'Study goes where your week has room', text: 'You tell PrepPlan the hours you really have, around work, classes and life, and it places each session inside them' },
  { key: 'check', label: 'Check', title: 'A short paper every Sunday', text: 'It measures what you can apply, what you missed, and how sure you were when you answered' },
  { key: 'repair', label: 'Repair', title: 'A miss becomes one small task', text: 'The cause is usually a prerequisite or a misconception, so that is what gets scheduled, not a re-read of the whole chapter' },
  { key: 'prove', label: 'Prove', title: 'Then it checks the fix held', text: 'After a gap, a fresh question confirms the repair worked, and only then does your understanding move' },
] as const
const SIGNALS = [
  ['Covered', 'What you say you have finished', 'Mastery'],
  ['Understanding', 'What a scored paper showed', 'A pass prediction'],
  ['This week', 'Whether the plan is on track', 'How well you know it'],
  ['Confidence', 'Whether “sure” turned out right', 'How good you are'],
]
const FAQ = [
  ['Is it a course?', 'No, it does not teach chapters. It tells you what to study, when, and how much, then checks that it worked. Use the materials you already have'],
  ['Will it predict if I pass?', 'No. It shows four separate signals and never blends them into one number'],
  ['Is it affiliated with CFA Institute?', 'No, PrepPlan is independent and not endorsed by CFA Institute'],
]

function Panel({ k }: { k: (typeof TABS)[number]['key'] }) {
  if (k === 'plan') return (
    <ul className="lp-plan">
      {[['Mon', 'Ethics', '7:30 to 8:15pm'], ['Tue', 'Quant methods', '7:30 to 8:30pm'], ['Wed', 'Free', ''], ['Thu', 'Economics', '7:30 to 8:15pm'], ['Sat', 'Review', '10:00 to 11:00am'], ['Sun', 'Weekly paper', '10:00 to 11:30am']].map(([d, t, w]) => (
        <li key={d} className={t === 'Free' ? 'is-free' : t === 'Weekly paper' ? 'is-paper' : ''}><b>{d}</b><span>{t}</span><em>{w}</em></li>
      ))}
    </ul>
  )
  if (k === 'check') return (
    <div className="lp-q">
      <p>A $9,000 investment grows to $9,900 What is the holding-period return?</p>
      {['$900', '10%', '9%', '$9,900'].map((o, i) => <div key={o} className={`lp-opt${i === 2 ? ' is-picked' : ''}`}><span />{o}</div>)}
      <div className="lp-conf"><small>How sure are you?</small><span>Guess</span><span>Think so</span><span className="on">Sure</span></div>
    </div>
  )
  if (k === 'repair') return (
    <div className="lp-repair">
      <div className="lp-miss"><small>What went wrong</small><b>Return calculation</b><p>You answered 9% and were sure The base is the starting value, not the ending one</p></div>
      <div className="lp-fix"><small>Your repair task</small><b>20 min, Tuesday after work</b><p>Three holding-period return problems, worked from the starting value</p></div>
    </div>
  )
  return (
    <div className="lp-proof">
      <span className="lp-proof__tick"><Check size={30} aria-hidden /></span>
      <b>The repair held</b>
      <p>A fresh question a week later, answered correctly and with the right confidence</p>
      <div className="lp-chips"><span>Return calculation</span><span className="ok">Supported</span></div>
    </div>
  )
}

export function LandingExperience({ className = '' }: { className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [tasks, setTasks] = useState(WEEK)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('plan')
  const doneCount = tasks.filter(t => t.done).length

  useEffect(() => {
    const el = root.current
    if (!el) return
    // Light touch: no scroll effects at all for reduced motion, small screens or touch devices.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px), (pointer: coarse)').matches
    const underline = el.querySelector<SVGPathElement>('.lp-under path')
    if (calm) { underline?.setAttribute('stroke-dashoffset', '0'); return }
    gsap.registerPlugin(ScrollTrigger)
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.from('.lp-hero h1 .ln > span', { yPercent: 105, duration: .8, stagger: .12 })
        .from('.lp-hero__sub, .lp-hero__cta', { y: 14, opacity: 0, duration: .6, stagger: .08 }, '-=.4')
        .from('.lp-app', { y: 36, opacity: 0, duration: .9 }, '-=.6')
        .add(() => { if (underline) animate(underline, { strokeDashoffset: [100, 0], duration: 900, ease: 'outCubic' }) }, '-=.5')
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach(n => gsap.from(n, { y: 24, opacity: 0, duration: .7, ease: 'power3.out', scrollTrigger: { trigger: n, start: 'top 88%', once: true } }))
      ScrollTrigger.create({ start: 8, onUpdate: s => el.querySelector('.lp-nav')?.classList.toggle('is-stuck', s.scroll() > 8) })
    }, el)
    return () => ctx.revert()
  }, [])

  const toggle = (id: string) => setTasks(ts => ts.map(t => t.id === id && !t.paper ? { ...t, done: !t.done } : t))
  const active = TABS.find(t => t.key === tab)!

  return (
    <div className={`lp ${className}`} ref={root}>
      <header className="lp-nav">
        <Link href="/" className="lp-brand"><span className="brand-mark" aria-hidden="true" />PrepPlan</Link>
        <nav aria-label="Main"><a href="#how">How it works</a><a href="#signals">Signals</a><a href="#faq">Questions</a></nav>
        <div className="lp-nav__cta"><Link href="/login" className="lp-link">Sign in</Link><Link href="/signup" className="lp-btn lp-btn--sm">Get started</Link></div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero__copy">
          <h1 aria-label="How to study, when to study">
            <span className="ln" aria-hidden><span>How to study</span></span>
            <span className="ln" aria-hidden><span><em className="lp-when">When<svg className="lp-under" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden><path d="M3 9 C 25 3, 48 12, 70 6 S 108 4, 117 8" pathLength="100" strokeDasharray="100" strokeDashoffset="0" /></svg></em> to study</span></span>
          </h1>
          <p className="lp-hero__sub">A CFA Level I plan that fits around your job and your week, rebuilt every Sunday from what you actually covered and got right</p>
          <div className="lp-hero__cta">
            <Link href="/signup" className="lp-btn">Get started <ArrowRight size={18} aria-hidden /></Link>
            <Link href="/demo" className="lp-btn lp-btn--quiet">Try the walkthrough</Link>
          </div>
        </div>

        <figure className="lp-app" aria-label="Example PrepPlan home screen. Tick a task to see the week update">
          <div className="lp-app__chrome"><span>This week</span><em>Example, tick things off</em></div>
          <div className="lp-app__tiles">
            <div><small>Covered</small><b>18<u>/60</u></b></div>
            <div><small>Understanding</small><b className="w">Developing</b></div>
            <div><small>This week</small><b>{doneCount}<u>/{tasks.length}</u></b></div>
            <div><small>Confidence</small><b>72<u>%</u></b></div>
          </div>
          <div className="lp-meter" aria-hidden><i style={{ width: `${(doneCount / tasks.length) * 100}%` }} /></div>
          <ul className="lp-tasks">
            {tasks.map(t => (
              <li key={t.id}>
                <button type="button" className={`lp-task${t.done ? ' is-done' : ''}${t.paper ? ' is-paper' : ''}`} onClick={() => toggle(t.id)} aria-pressed={t.done} disabled={t.paper} aria-label={t.paper ? `${t.title}, cannot be ticked, it has to be taken` : `${t.title}, ${t.done ? 'done' : 'not done'}`}>
                  <span className="lp-box">{t.paper ? <Lock size={12} aria-hidden /> : <Check size={13} aria-hidden />}</span>
                  <span className="lp-task__t"><b>{t.title}</b><small>{t.day} {t.when} · {t.min} min</small></span>
                </button>
              </li>
            ))}
          </ul>
          <figcaption>The Sunday paper can&rsquo;t be ticked off, it has to be taken</figcaption>
        </figure>
      </section>

      <section className="lp-how" id="how">
        <div className="lp-how__head" data-reveal>
          <h2>Not a course, not a tutor</h2>
          <p>It decides what is next, then checks it worked</p>
        </div>
        <div className="lp-how__body" data-reveal>
          <div className="lp-tabs" role="tablist" aria-label="How PrepPlan works">
            {TABS.map((t, i) => (
              <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="lp-panel" className={tab === t.key ? 'is-on' : ''} onClick={() => setTab(t.key)}><i>{i + 1}</i>{t.label}</button>
            ))}
          </div>
          <div className="lp-panel" id="lp-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} key={tab}>
            <div className="lp-panel__text"><h3>{active.title}</h3><p>{active.text}</p></div>
            <div className="lp-panel__art"><Panel k={tab} /></div>
          </div>
        </div>
      </section>

      <section className="lp-signals" id="signals">
        <div className="lp-signals__head" data-reveal>
          <h2>Four signals, never one score</h2>
          <p>Studying isn&rsquo;t understanding, and confidence isn&rsquo;t accuracy, so each is tracked on its own</p>
        </div>
        <table className="lp-table" data-reveal>
          <thead><tr><th scope="col">Signal</th><th scope="col">Tells you</th><th scope="col">Never means</th></tr></thead>
          <tbody>{SIGNALS.map(([a, b, c]) => <tr key={a}><th scope="row">{a}</th><td>{b}</td><td>{c}</td></tr>)}</tbody>
        </table>
        <p className="lp-promises" data-reveal>No pass predictions <i>·</i> practice never counts as evidence <i>·</i> export or delete your data any time</p>
      </section>

      <section className="lp-end" id="faq">
        <div className="lp-faq" data-reveal>
          <h2>Questions</h2>
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={18} aria-hidden /></summary><p>{a}</p></details>)}
        </div>
        <div className="lp-cta" data-reveal>
          <h2>Tell PrepPlan what you can commit</h2>
          <p>Five short steps, and every answer stays editable</p>
          <Link href="/signup" className="lp-btn lp-btn--light">Get started <ArrowRight size={18} aria-hidden /></Link>
        </div>
      </section>

      <footer className="lp-footer">
        <span>&copy; {new Date().getFullYear()} PrepPlan</span>
        <span>Not affiliated with CFA Institute</span>
        <span><Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link></span>
      </footer>
    </div>
  )
}
