'use client'

import { WhenReady } from '../ui/WhenReady'
import { useState } from 'react'
import Link from 'next/link'
import { itemStateLabel } from '../../lib/diagnostic/itemState'

export type PreviewItem = {
  id: string; version: number; state: string; stem: string; options: string[]; keyIndex: number | null
  feedback: Record<string, string>; solution: string | null; diagnoses: { optionIndex: number; errorCode: string; description: string }[]
}
type Level = 'low' | 'medium' | 'high'
const LEVELS: { v: Level; label: string }[] = [{ v: 'low', label: 'Guessing' }, { v: 'medium', label: 'Somewhat sure' }, { v: 'high', label: 'Sure' }]

/**
 * A reviewer's rehearsal of a question or a candidate paper, laid out like the student's paper.
 * It has no network calls at all: answers live in this component's memory and vanish with the page.
 * Nothing is recorded as a response, evidence, progress, repair or Calendar task.
 */
export function DraftPreview({ items, title, backHref }: { items: PreviewItem[]; title: string; backHref: string }) {
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<Record<string, { selected: number | null; confidence: Level | null }>>({})
  const [done, setDone] = useState(false)
  if (!items.length) return <p className="notice notice--warn">There are no questions to preview for this selection.</p>
  const it = items[idx]
  const a = picked[it.id] ?? { selected: null, confidence: null }
  const set = (patch: Partial<typeof a>) => setPicked(p => ({ ...p, [it.id]: { ...a, ...patch } }))
  const answered = items.filter(i => picked[i.id]?.selected != null && picked[i.id]?.confidence != null).length

  const banner = (
    <div className="rv-draftbar" role="note">Reviewer preview · draft content · nothing here is saved. No response, evidence, progress, repair or Calendar task is created.</div>
  )

  if (done) {
    const right = items.filter(i => picked[i.id]?.selected === i.keyIndex).length
    return (
      <div className="rv-preview">
        {banner}
        <h2>{title}: preview result</h2>
        <p>{right} of {items.length} correct in this rehearsal ({answered} answered with a confidence). This score is not stored and does not touch any student’s record.</p>
        <ol className="attempt-review__list">
          {items.map((i, n) => {
            const p = picked[i.id]
            const ok = p?.selected === i.keyIndex
            return (
              <li key={i.id}>
                <strong>{n + 1}. {ok ? 'Correct' : p?.selected == null ? 'Not answered' : 'Incorrect'}</strong> · <Link href={`/app/tests/review/${encodeURIComponent(i.id)}`}>{i.id}</Link> ({itemStateLabel(i.state)}) — {i.stem.slice(0, 110)}{i.stem.length > 110 ? '…' : ''}
                {p?.selected != null && !ok && <div className="fine-print">You chose {String.fromCharCode(65 + p.selected)}; key is {i.keyIndex == null ? '?' : String.fromCharCode(65 + i.keyIndex)}. {i.diagnoses.find(d => d.optionIndex === p.selected)?.description ?? i.feedback[String(p.selected)] ?? ''}</div>}
              </li>
            )
          })}
        </ol>
        <div className="rv-actions"><button type="button" className="secondary-button" onClick={() => { setPicked({}); setIdx(0); setDone(false) }}>Start the preview again</button><Link className="text-button" href={backHref}>Back to review</Link></div>
      </div>
    )
  }

  return (
    <WhenReady>
    <div className="rv-preview">
      {banner}
      <div className="attempt__head"><span><strong>{title}</strong> · Question {idx + 1} of {items.length}</span><span className="tag">{itemStateLabel(it.state)} · v{it.version}</span></div>
      <section className="question-card" aria-labelledby="pv-h">
        <h2 id="pv-h">{it.stem}</h2>
        <div className="answer-list" role="radiogroup" aria-label="Answer choices">
          {it.options.map((o, n) => (
            <button key={n} type="button" role="radio" aria-checked={a.selected === n} className={`answer-row ${a.selected === n ? 'is-selected' : ''}`} onClick={() => set({ selected: n })}>
              <span className="answer-letter" aria-hidden>{String.fromCharCode(65 + n)}</span><span>{o}</span><span className="answer-radio" aria-hidden />
            </button>
          ))}
        </div>
      </section>
      <div className="attempt__confidence">
        <span><strong>How sure are you?</strong></span>
        <div role="radiogroup" aria-label="Confidence" className="attempt__levels">
          {LEVELS.map(l => <button key={l.v} type="button" role="radio" aria-checked={a.confidence === l.v} className={`attempt__level ${a.confidence === l.v ? 'is-on' : ''}`} onClick={() => set({ confidence: l.v })}>{l.label}</button>)}
        </div>
      </div>
      {a.selected != null && (
        <details suppressHydrationWarning className="review-queue__details">
          <summary>Reviewer view: key, working and what each wrong answer means</summary>
          <p className="fine-print">Key: option {it.keyIndex == null ? '?' : String.fromCharCode(65 + it.keyIndex)}. {it.solution}</p>
          <ul className="rv-list">{it.options.map((o, n) => <li key={n}><strong>{String.fromCharCode(65 + n)}</strong> {it.feedback[String(n)] ?? ''} {it.diagnoses.find(d => d.optionIndex === n) ? `(${it.diagnoses.find(d => d.optionIndex === n)!.errorCode}: ${it.diagnoses.find(d => d.optionIndex === n)!.description})` : ''}</li>)}</ul>
        </details>
      )}
      <footer className="attempt__foot">
        <Link className="text-button" href={`/app/tests/review/${encodeURIComponent(it.id)}`}>Open in the workspace</Link>
        <span className="attempt__spacer" />
        <button type="button" className="secondary-button" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Previous</button>
        {idx < items.length - 1
          ? <button type="button" className="primary-button" onClick={() => setIdx(idx + 1)}>Next</button>
          : <button type="button" className="primary-button" onClick={() => setDone(true)}>Finish preview</button>}
      </footer>
    </div>
    </WhenReady>
  )
}
