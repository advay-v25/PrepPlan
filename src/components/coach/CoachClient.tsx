'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, Send } from 'lucide-react'
import Link from 'next/link'
import type { StoredMessage } from '../../lib/coach/service'

type Intent = 'struggling' | 'day_was_bad' | 'redo' | 'next'
const QUICK: { intent: Intent; label: string; text: string }[] = [
  { intent: 'next', label: 'What should I focus on?', text: 'What should I focus on next?' },
  { intent: 'struggling', label: 'I keep getting this wrong', text: 'I keep getting the same thing wrong.' },
  { intent: 'redo', label: 'Let me try that again', text: 'I want another go at what I got wrong.' },
  { intent: 'day_was_bad', label: 'Today went badly', text: 'Today went badly and I could not study.' },
]

const STATUS: Record<string, string> = { pending: '', executed: 'Done', rejected: 'Dismissed', stale: 'No longer current' }

export function CoachClient({ initialDraft = '', initialMessages = [] }: { initialDraft?: string; initialMessages?: StoredMessage[] }) {
  const router = useRouter()
  const [messages, setMessages] = useState<StoredMessage[]>(initialMessages)
  const [draft, setDraft] = useState(initialDraft)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const send = async (text?: string, intent?: Intent) => {
    const payload = (text ?? draft).trim()
    if (!payload || loading) return
    setDraft(''); setError(null); setNotice(null); setLoading(true)
    const optimistic: StoredMessage = { id: `local-${Date.now()}`, role: 'student', body: payload, intent: intent ?? null, links: [], createdAt: new Date().toISOString(), proposals: [] }
    setMessages(prev => [...prev, optimistic])
    try {
      const res = await fetch('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: payload, ...(intent ? { intent } : {}) }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to communicate with the coach')
      setMessages(prev => [...prev, { id: data.messageId, role: 'coach', body: data.reply, intent: data.intent ?? null, links: data.links ?? [], createdAt: new Date().toISOString(), proposals: data.proposals ?? [] }])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const decide = async (messageId: string, proposalId: string, decision: 'accept' | 'reject') => {
    setError(null); setNotice(null)
    const res = await fetch(`/api/coach/proposals/${proposalId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
    const data = await res.json().catch(() => ({}))
    const status = data.ok ? data.status : data.code === 'STALE' ? 'stale' : null
    if (status) setMessages(prev => prev.map(m => m.id !== messageId ? m : { ...m, proposals: m.proposals.map(p => p.id === proposalId ? { ...p, status } : p) }))
    if (data.ok && decision === 'accept') { setNotice(data.applied ? `Done — ${data.applied} change${data.applied === 1 ? '' : 's'} made. You can undo from Calendar.` : 'Done.'); router.refresh() }
    if (!data.ok) setError(data.error || 'That could not be applied. Nothing was changed.')
  }

  const clear = async () => {
    if (!window.confirm('Clear this conversation? Changes you already confirmed stay in your plan.')) return
    const res = await fetch('/api/coach/history', { method: 'DELETE' })
    if (res.ok) setMessages([])
  }

  return (
    <>
      <div className="coach-thread" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-secondary">Ask what to work on, why something keeps going wrong, or how to recover from a bad day. I plan from your evidence; I do not teach the content.</p>
        )}
        {messages.map(message => (
          <div key={message.id} className={`coach-message coach-message--${message.role}`}>
            <span className="coach-avatar">{message.role === 'coach' ? <MessageCircle size={18} /> : 'A'}</span>
            <div>
              <strong>{message.role === 'coach' ? 'Roadmap Coach' : 'You'}</strong>
              <p>{message.body}</p>

              {message.proposals.map(p => (
                <div key={p.id} className="coach-proposal" role="group" aria-label="Suggested change" style={{ border: '1px solid var(--line, #d0d5dd)', borderRadius: 8, padding: '.75rem', marginTop: '.5rem' }}>
                  <p className="eyebrow">Suggested change — nothing happens until you confirm</p>
                  <p><strong>{p.title}</strong></p>
                  <p className="text-secondary">{p.reasoning}</p>
                  {p.status === 'pending' ? (
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button className="primary-button" onClick={() => void decide(message.id, p.id, 'accept')}>Confirm</button>
                      <button className="text-button" onClick={() => void decide(message.id, p.id, 'reject')}>Not now</button>
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
            <div><strong>Roadmap Coach</strong><p>Checking your evidence…</p></div>
          </div>
        )}
        {error && <div className="coach-error" role="alert" style={{ color: 'var(--danger)' }}>{error}</div>}
        {notice && <div role="status" className="text-secondary">{notice}</div>}
      </div>

      <div className="coach-suggestions coach-suggestions--page">
        {QUICK.map(q => (
          <button onClick={() => void send(q.text, q.intent)} disabled={loading} key={q.intent}>{q.label}</button>
        ))}
      </div>

      <div className="glass-input-pill">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
          aria-label="Ask the coach"
          maxLength={1500}
          placeholder="Ask why you missed a topic, what to study next, or how to recover this week"
          disabled={loading}
        />
        <button onClick={() => void send()} disabled={loading}><Send size={16} aria-hidden /> Send</button>
      </div>
      <p style={{ textAlign: 'center', fontSize: '0.8rem', opacity: 0.7, marginTop: 16 }}>
        Suggestions change nothing until you confirm them. {messages.length > 0 && <button className="text-button" onClick={() => void clear()}>Clear conversation</button>}
      </p>
    </>
  )
}
