'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WhenReady } from '../ui/WhenReady'
import { NAME_ERROR, normalizePersonName } from '../../lib/auth/personName'

/** Name-only patch: changes nothing about the exam, route, sitting limit or plan. */
export function DisplayNameForm({ initial }: { initial: string }) {
  const router = useRouter()
  const [name, setName] = useState(initial), [saved, setSaved] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle')
  const trimmed = normalizePersonName(name), valid = trimmed !== null
  const saving = state === 'saving'
  const composing = useRef(false)
  async function save() {
    const submitted = trimmed // snapshot: a newer typed edit must survive this response
    if (submitted === null) return
    setState('saving')
    try {
      const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: submitted }), signal: AbortSignal.timeout(15_000) })
      if (res.ok) { setSaved(submitted); setState('saved'); router.refresh() } else setState({ error: (await res.json().catch(() => null))?.error ?? 'Not saved. Your edit is kept; try again.' })
    } catch { setState({ error: 'Could not reach PrepPlan. Your edit is kept; try again.' }) }
  }
  return (
    <form onSubmit={e => { e.preventDefault(); if (valid && trimmed !== saved && !saving && !composing.current) void save() }} data-display-name>
      <WhenReady>
      <div className="field"><label htmlFor="display-name-input">Display name</label><input id="display-name-input" value={name} maxLength={200} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onChange={e => { setName(e.target.value); if (!saving) setState('idle') }} autoComplete="name" aria-describedby="display-name-rule" /><small id="display-name-rule">{NAME_ERROR}</small></div>
      <button type="submit" className="secondary-button" disabled={!valid || trimmed === saved || saving}>{saving ? 'Saving…' : 'Save name'}</button>
      {state === 'saved' && <span role="status" className="fine-print">{trimmed === saved ? ' Saved.' : ' Earlier name saved. Your current edit is not saved.'}</span>}
      {typeof state === 'object' && <p role="alert" className="review-error">{state.error}</p>}
      </WhenReady>
    </form>
  )
}
