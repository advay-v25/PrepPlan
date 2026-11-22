'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

const STEPS = ['Calendar', 'Paper', 'Result', 'Weekly review', 'Next week'] as const
const CHOICES = ['$9,200', '$10,000', '$10,800']

export function StudyWalkthrough() {
  const [step, setStep] = useState(0)
  const [answer, setAnswer] = useState<number | null>(null)
  const [confidence, setConfidence] = useState('')
  const [move, setMove] = useState(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const go = (next: number) => {
    setStep(next)
    requestAnimationFrame(() => heading.current?.focus())
  }
  const correct = answer === 1
  const action = correct && confidence === 'Sure' ? 'Quick retrieval' : 'Rework the gain calculation'

  return (
    <section aria-labelledby="walkthrough-step" className="review-form">
      <p className="walk-step">Step {step + 1} of {STEPS.length}</p>
      <div className="walk-bar" aria-hidden>{STEPS.map((_, i) => <span key={i} className={i <= step ? 'is-on' : ''} />)}</div>
      <h2 id="walkthrough-step" ref={heading} tabIndex={-1}>{STEPS[step]}</h2>
      {step === 0 && <>
        <ul>
          <li><strong>Tuesday</strong> · Work is blocked out until 19:00</li>
          <li><strong>Thursday</strong> · 30 min on returns, recorded as done</li>
          <li><strong>Saturday</strong> · 20 min of retrieval, missed</li>
          <li><strong>Sunday</strong> · A diagnostic on the completed returns work</li>
        </ul>
        <button type="button" className="primary-button" onClick={() => go(1)}>Open the sample paper</button>
      </>}
      {step === 1 && <>
        <fieldset className="review-tasks">
          <legend>An investment earns 8% over one year, producing a gain of $800. What was its initial value?</legend>
          {CHOICES.map((choice, i) => <label key={choice} className="review-ack">
            <input type="radio" name="demo-answer" checked={answer === i} onChange={() => setAnswer(i)} /> {choice}
          </label>)}
        </fieldset>
        <fieldset className="review-tasks">
          <legend>How sure are you?</legend>
          {['Guessing', 'Fairly sure', 'Sure'].map(choice => <label key={choice} className="review-ack">
            <input type="radio" name="demo-confidence" checked={confidence === choice} onChange={() => setConfidence(choice)} /> {choice}
          </label>)}
        </fieldset>
        <button type="button" className="primary-button" disabled={answer === null || !confidence} onClick={() => go(2)}>See my example result</button>
      </>}
      {step === 2 && <>
        <p><strong>{correct ? '1 of 1 correct' : '0 of 1 correct'}</strong> · Confidence reported: {confidence.toLowerCase()}.</p>
        <p>The correct answer is $10,000. Divide the $800 gain by 0.08 to recover the initial value.</p>
        <p><strong>Suggested next step</strong> · {action}. A single answer gives one observation about this outcome.</p>
        <button type="button" className="primary-button" onClick={() => go(3)}>Review the week</button>
      </>}
      {step === 3 && <>
        <p>Thursday&apos;s 30 minutes stay in this week. The result suggests a short follow-up on returns.</p>
        <label className="review-ack"><input type="checkbox" checked={move} onChange={e => setMove(e.target.checked)} /> Carry the missed retrieval session into next week</label>
        <button type="button" className="primary-button" onClick={() => go(4)}>Show the adjusted week</button>
      </>}
      {step === 4 && <>
        <ul>
          <li><strong>Tuesday</strong> · {action}, 20 min after work</li>
          {move && <li><strong>Thursday</strong> · Continue the retrieval session, 20 min</li>}
          <li><strong>Sunday</strong> · Check the outcome again after spacing</li>
        </ul>
        <p className="fine-print" role="status">Walkthrough complete: 5 of 5 steps. Nothing here was saved.</p>
        <Link className="primary-button" href="/signup">Create your plan</Link>{' '}
        <Link className="secondary-button" href="/login">Sign in to Roadmap</Link>{' '}
        <button type="button" className="secondary-button" onClick={() => { setAnswer(null); setConfidence(''); setMove(true); go(0) }}>Start again</button>
      </>}
      {step > 0 && step < 4 && <p><button type="button" className="text-button" onClick={() => go(step - 1)}>Back</button></p>}
    </section>
  )
}
