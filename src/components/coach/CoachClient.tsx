'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Send } from 'lucide-react'
import Link from 'next/link'
import type { StoredMessage } from '../../lib/coach/service'

import { QUICK_ACTIONS } from '../../lib/coach/capabilities'

type Intent = string
/** At most three suggestions, chosen for where the student is. Teaching is never advertised. */
const pick = (hasAttempt: boolean) => QUICK_ACTIONS.filter(q => (hasAttempt ? ['result', 'today', 'day_was_bad'] : ['today', 'day_was_bad', 'next']).includes(q.intent))

const STATUS: Record<string, string> = { pending: '', executed: 'Done', rejected: 'Dismissed', stale: 'No longer current' }

export function CoachClient({ initialDraft = '', initialMessages = [], attemptId, taskId, readingId, reportId, historyUnavailable = false }: { initialDraft?: string; initialMessages?: StoredMessage[]; attemptId?: string; taskId?: string; readingId?: string; reportId?: string; historyUnavailable?: boolean }) {
  const router = useRouter()
  const [messages, setMessages] = useState<StoredMessage[]>(initialMessages)
  const [draft, setDraft] = useState(initialDraft)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // One durable key per question. A retry reuses it, so a lost response never duplicates the message, the answer or a proposal.
  // The selected context is bound to the turn when it is first sent: Retry reuses it even if the student has since selected something else.
  const pending = useRef<{ key: string; text: string; intent?: Intent; taskId?: string; attemptId?: string; readingId?: string; reportId?: string } | null>(null)
  const [placedHref, setPlacedHref] = useState<string | null>(null)
  const sending = useRef(false)
  const send = async (text?: string, intent?: Intent, retry = false) => {
    if (sending.current) return
    const payload = retry && pending.current ? pending.current.text : (text ?? draft).trim()
    if (!payload) return
    if (!pending.current || pending.current.text !== payload) pending.current = { key: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, text: payload, intent: intent ?? (reportId ? 'mock' : undefined), taskId, attemptId, readingId, reportId }
    const turn = pending.current
    sending.current = true; setError(null); setNotice(null); setPlacedHref(null); setLoading(true)
    setMessages(prev => prev.some(m => m.id === `local-${turn.key}`) ? prev : [...prev, { id: `local-${turn.key}`, role: 'student', body: payload, intent: null, links: [], createdAt: new Date().toISOString(), proposals: [] }])
    try {
      let res: Response, data: any = {}
      // 202 = another request of this same turn is still answering: wait and ask again with the same key (never a second answer).
      for (let tries = 0; ; tries++) {
        res = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: payload, turnKey: turn.key, ...(turn.intent ? { intent: turn.intent } : {}), ...(turn.attemptId ? { attemptId: turn.attemptId } : {}), ...(turn.taskId ? { taskId: turn.taskId } : {}), ...(turn.readingId ? { readingId: turn.readingId } : {}), ...(turn.reportId ? { reportId: turn.reportId } : {}) }) })
        data = await res.json().catch(() => ({}))
        if (res.status !== 202 || tries >= 8) break
        await new Promise(r => setTimeout(r, data.retryAfterMs ?? 1500))
      }
      if (res.status === 202) throw new Error('The Coach is still working on this. Your question is kept; press Retry in a moment.')
      if (res.status === 409) { pending.current = null; setMessages(prev => prev.filter(m => m.id !== `local-${turn.key}`)); setFailed(false); setError(data.error || 'That question could not be added.'); return }
      if (!res.ok) throw new Error(data.error || 'The Coach could not respond. Your question is kept; try again.')
      pending.current = null; setDraft(draft => (draft.trim() === payload ? '' : draft)); setFailed(false)
      setMessages(prev => [...prev, { id: data.messageId, role: 'coach', body: data.reply, intent: data.intent ?? null, links: data.links ?? [], createdAt: new Date().toISOString(), proposals: data.proposals ?? [] }])
    } catch (err: any) {
      setFailed(true); setError(err?.message && err.message !== 'Failed to fetch' ? err.message : 'No connection. Your question is kept; try again.')
    } finally {
      sending.current = false; setLoading(false)
    }
  }

  const decide = async (messageId: string, proposalId: string, decision: 'accept' | 'reject') => {
    if (deciding) return
    setError(null); setNotice(null)
    setDeciding(proposalId); setRecoveryUrl(null)
    try {
      const res = await fetch(`/api/coach/proposals/${proposalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const data = await res.json().catch(() => ({}))
      const status = data.ok ? data.status : data.code === 'STALE' ? 'stale' : null
      if (status) setMessages(prev => prev.map(m => m.id !== messageId ? m : { ...m, proposals: m.proposals.map(p => p.id === proposalId ? { ...p, status } : p) }))
      if (data.ok && decision === 'accept' && data.effects?.placement) { setNotice(`Moved. It is now on ${data.effects.placement.toDate}${data.effects.placement.startsAt ? '' : ' with no set time'}${data.already ? ' (confirmed earlier; nothing was repeated)' : ''}.`); setPlacedHref(data.effects.placement.href); router.refresh() }
      else if (data.ok && decision === 'accept') { setNotice(data.applied ? `${data.applied} task${data.applied === 1 ? '' : 's'} marked deferred${data.already ? ' (confirmed earlier; nothing was repeated)' : ''}. ${data.effects?.placedMinutes ? `${data.effects.placedMinutes} min were added to later sessions; see Calendar.` : 'Nothing has been placed on another day yet: choose a time in Calendar, or it waits for your weekly review.'}` : 'Done.'); router.refresh() }
      if (!data.ok) { setError(data.error || 'That could not be confirmed. Check Calendar before trying again.'); setRecoveryUrl(data.nextUrl ?? null) }
    } catch { setError('The confirmation may not have reached the server. Press Confirm again: if it already went through, you will get the same result and nothing is repeated.') }
    finally { setDeciding(null) }
  }

  const clear = async () => {
    if (!window.confirm('Clear this conversation? Changes you already confirmed stay in your plan.')) return
    try {
      const res = await fetch('/api/coach/history', { method: 'DELETE' })
      if (res.ok) { setMessages([]); setNotice('Conversation cleared. Confirmed changes and their records are kept.'); setError(null) } else setError('The conversation could not be cleared. Nothing was removed; try again.')
    } catch { setError('The conversation could not be cleared. Nothing was removed; try again.') }
  }

  return (
    <>
      <div className="coach-thread" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-secondary">I help with how and when to study: your plan, your progress and recovery. Ask what to work on, why something keeps going wrong, or how to recover from a bad day. I plan from your evidence; I do not teach the content.</p>
        )}
        {messages.map(message => (
          <div key={message.id} className={`coach-message coach-message--${message.role}`}>
            <span className="coach-avatar">{message.role === 'coach' ? <MessageCircle size={18} /> : 'A'}</span>
            <div>
              <strong>{message.role === 'coach' ? 'PrepPlan Coach' : 'You'}</strong>
              <p>{message.body}</p>

              {message.proposals.map(p => (
                <div key={p.id} className="coach-proposal" role="group" aria-label="Suggested change" style={{ marginTop: 'var(--space-3)' }}>
                  <p className="eyebrow">Suggested change — nothing happens until you confirm</p>
                  <p><strong>{p.title}</strong></p>
                  <p className="text-secondary">{p.reasoning}</p>
                  {p.changes?.moves?.length > 0 && (
                    <ul aria-label="Exactly what will change">
                      {p.changes.moves.map((m: any) => <li key={m.id}>{m.title} — {m.minutes} min, {m.date}: marked deferred (stays due until you place or finish it)</li>)}
                    </ul>
                  )}
                  {p.changes?.staysDue?.length > 0 && <p className="text-secondary">Stays due: {p.changes.staysDue.map((t: any) => `${t.title} (${t.reason})`).join('; ')}.</p>}
                  {p.status === 'pending' ? (
                    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button type="button" className="primary-button" disabled={!!deciding} onClick={() => void decide(message.id, p.id, 'accept')}>{deciding === p.id ? 'Checking…' : 'Confirm'}</button>
                      <button type="button" className="text-button" disabled={!!deciding} onClick={() => void decide(message.id, p.id, 'reject')}>Not now</button>
                    </div>
                  ) : <p className="text-secondary">{STATUS[p.status] ?? p.status}</p>}
                </div>
              ))}

              {message.links.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.5rem' }}>
                  {message.links.map(l => <Link key={l.href + l.label} href={l.href} className="secondary-button">{l.label}</Link>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="coach-message coach-message--coach">
            <span className="coach-avatar"><MessageCircle size={18} /></span>
            <div><strong>PrepPlan Coach</strong><p>Checking your evidence…</p></div>
          </div>
        )}
        {error && <div className="coach-error" role="alert" style={{ color: 'var(--danger)' }}>{error} {failed && <button type="button" className="text-button" onClick={() => void send(undefined, undefined, true)}>Retry</button>}</div>}
        {historyUnavailable && messages.length === 0 && <div role="status" className="text-secondary">Earlier messages are unavailable right now.</div>}
        {recoveryUrl && <Link href={recoveryUrl} className="secondary-button">{recoveryUrl.startsWith('/app/calendar') ? 'Open it in Calendar' : 'Review current follow-up'}</Link>}
        {notice && <div role="status" className="text-secondary">{notice}{placedHref && <> <Link href={placedHref} className="text-button">Open it in Calendar</Link></>}</div>}
      </div>

      <div className="coach-suggestions coach-suggestions--page">
        {pick(Boolean(attemptId)).map(q => (
          <button type="button" onClick={() => void send(q.text, q.intent)} disabled={loading} key={q.intent}>{q.label}</button>
        ))}
      </div>

      <div className="glass-input-pill">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send() } }}
          aria-label="Ask the coach"
          maxLength={1500}
          placeholder="Ask why you missed a topic, what to study next, or how to recover this week"
          disabled={loading}
        />
        <button type="button" onClick={() => void send()} disabled={loading || !draft.trim()}><Send size={16} aria-hidden /> Send</button>
      </div>
      <p style={{ textAlign: 'center', fontSize: '0.8rem', opacity: 0.7, marginTop: 16 }}>
        Suggestions change nothing until you confirm them. {messages.length > 0 && <button type="button" className="text-button" onClick={() => void clear()}>Clear conversation</button>}
      </p>
    </>
  )
}
