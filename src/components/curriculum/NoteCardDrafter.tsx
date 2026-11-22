'use client'

import { useEffect, useRef, useState } from 'react'
import { noteText, type NoteDoc } from '../../lib/curriculum/notes/doc'
import { cardCall, keyring } from './cards'

type Row = { front: string; back: string; support: string; keep: boolean; saved: boolean; error: string | null }
const MAX = 3000

/**
 * Optional, explicit. The student chooses the note text (their own, from this scope), asks for drafts, edits and selects, then saves. Nothing is generated on load;
 * the excerpt is the ONLY thing sent; a failed or slow provider leaves the excerpt and everything else as it was. Saved drafts are ordinary private cards with
 * their own request key, so a retry cannot duplicate one.
 */
export function NoteCardDrafter({ scopeType, scopeId, label, onSaved }: { scopeType: 'subject' | 'reading'; scopeId: string; label: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [excerpt, setExcerpt] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<'load' | 'draft' | 'save' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const keys = useRef(keyring()), abort = useRef<AbortController | null>(null)
  const active = useRef(0)
  useEffect(() => () => { active.current++; abort.current?.abort() }, [])

  async function loadNote() {
    const version = ++active.current
    abort.current = new AbortController()
    setBusy('load'); setMsg(null)
    try {
      const res = await fetch(`/api/curriculum/notes?scopeType=${scopeType}&scopeId=${encodeURIComponent(scopeId)}`, { signal: abort.current.signal }), b = await res.json().catch(() => null)
      if (version !== active.current) return
      if (!res.ok || !b?.ok) setMsg({ kind: 'error', text: b?.error ?? 'Your note could not be loaded. Nothing was changed.' })
      else { const t = b.doc ? noteText(b.doc as NoteDoc) : ''; setExcerpt(t.slice(0, MAX)); if (!t.trim()) setMsg({ kind: 'info', text: 'You have not written a note here yet. Write one first, or paste the text you want cards from.' }) }
    } catch { if (version === active.current) setMsg({ kind: 'error', text: 'Could not reach the server. Nothing was changed.' }) }
    if (version === active.current) setBusy(null)
  }
  async function draft() {
    const version = ++active.current
    setBusy('draft'); setMsg(null); abort.current = new AbortController()
    try {
      const res = await fetch('/api/curriculum/flashcards/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.current.signal, body: JSON.stringify({ scopeType, scopeId, text: excerpt, label }) })
      const b = await res.json().catch(() => null)
      if (version !== active.current) return
      if (res.ok && b?.ok) {
        setRows(b.drafts.map((d: { front: string; back: string; support: string }) => ({ ...d, keep: false, saved: false, error: null })))   // nothing is kept until the student chooses it
        setMsg({ kind: 'info', text: b.drafts.length ? `${b.label}${b.dropped ? ` ${b.dropped} draft(s) were discarded because they did not pass the checks.` : ''}` : 'No clear fact worth a card was found in that text. Nothing was saved.' })
      } else setMsg({ kind: 'error', text: b?.error ?? 'Drafting did not work. Nothing was saved; your text is still here.' })
    } catch (e) { if (version === active.current) setMsg({ kind: 'error', text: (e as Error).name === 'AbortError' ? 'Drafting was cancelled. Your text is still here.' : 'Could not reach the server. Nothing was saved; your text is still here.' }) }
    if (version === active.current) setBusy(null)
  }
  async function save() {
    const version = ++active.current
    setBusy('save'); let ok = 0
    const next = [...rows]
    for (let i = 0; i < next.length; i++) {
      if (version !== active.current) return
      const r = next[i]; if (!r.keep || r.saved) continue
      const sig = `${i}:${r.front}:${r.back}`
      const res = await cardCall({ action: 'create', scopeType, scopeId, front: r.front, back: r.back, source: 'note_draft', requestKey: keys.current.keyFor(sig) })
      if (res.ok) { keys.current.done(sig); next[i] = { ...r, saved: true, error: null }; ok++ } else next[i] = { ...r, error: res.error ?? 'Not saved.' }
    }
    if (version !== active.current) return
    setRows(next); setBusy(null)
    if (ok) onSaved()
    setMsg(next.some(r => r.keep && !r.saved) ? { kind: 'error', text: 'Some cards were not saved. They are still here; Save again is safe and will not duplicate the ones that were saved.' } : { kind: 'info', text: `${ok} card${ok === 1 ? '' : 's'} saved. They are your private practice cards.` })
  }

  if (!open) return <button type="button" className="text-button" onClick={() => { setOpen(true); void loadNote() }}>Draft cards from my note…</button>
  return (
    <section className="flashcards__drafter" aria-label="Draft cards from my note">
      <p className="muted">Optional. Choose the part of <em>your own note</em> you want cards from (up to {MAX.toLocaleString('en-GB')} characters). Only this text is sent. The drafts are a starting point: edit them, keep what is useful. They are not checked against any course material and they do not show that you understand the topic. Each draft is shown with the passage of your note it came from.</p>
      <label>Text to draw cards from
        <textarea value={excerpt} maxLength={MAX} rows={6} onChange={e => setExcerpt(e.target.value)} disabled={busy !== null} aria-describedby="drafter-count" /></label>
      <p id="drafter-count" className="muted">{excerpt.length.toLocaleString('en-GB')} / {MAX.toLocaleString('en-GB')}</p>
      <p>
        <button type="button" className="secondary-button" disabled={busy !== null || excerpt.trim().length < 40} onClick={draft}>{busy === 'draft' ? 'Drafting…' : 'Draft up to 5 cards'}</button>{' '}
        {busy === 'draft' && <button type="button" className="text-button" onClick={() => abort.current?.abort()}>Cancel</button>}{' '}
        <button type="button" className="text-button" disabled={busy === 'save'} onClick={() => { active.current++; abort.current?.abort(); setBusy(null); setOpen(false); setRows([]); setMsg(null) }}>Close</button>
      </p>
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'review-error' : 'muted'}>{msg.text}</p>}
      {rows.length > 0 && (
        <>
          <ul className="flashcards__list">{rows.map((r, i) => (
            <li key={i} className="flashcards__edit">
              <blockquote className="flashcards__support"><small>From your note:</small> {r.support}</blockquote>
              <label><input type="checkbox" checked={r.keep} disabled={r.saved || busy !== null} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, keep: e.target.checked } : y))} /> {r.saved ? 'Saved' : 'I have read it against my note and want to keep this card'}</label>
              <input type="text" value={r.front} maxLength={1000} disabled={r.saved || busy !== null} aria-label={`Draft ${i + 1} front`} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, front: e.target.value } : y))} />
              <textarea value={r.back} maxLength={2000} rows={2} disabled={r.saved || busy !== null} aria-label={`Draft ${i + 1} back`} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, back: e.target.value } : y))} />
              {r.error && <span role="alert" className="review-error">{r.error}</span>}
            </li>))}
          </ul>
          <button type="button" className="primary-button" disabled={busy !== null || !rows.some(r => r.keep && !r.saved && r.front.trim() && r.back.trim())} onClick={save}>Save selected cards</button>
        </>
      )}
    </section>
  )
}
