'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ScopeConfirmForm } from '../tests/ScopeForms'

type Context = { ok: boolean; error?: string; unmapped?: boolean; automatic?: boolean; revision: number;
  reading: { id: string; title: string; topic_id: string }; outcomes: { id: string; code: string; title: string }[]; confirmed: string[] }

/** Shared confirmation command: Calendar and Tests edit the same owned observation. */
export function TaskLearningScope({ taskId, revision }: { taskId: string; revision: number }) {
  const [state, setState] = useState<Context | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setState(null); setFailed(false)
    fetch(`/api/tests/scope/confirm?blockId=${encodeURIComponent(taskId)}`, { signal: abort.signal })
      .then(async r => { const body = await r.json(); if (!r.ok || !body.ok) throw Error(); return body })
      .then(body => { if (!abort.signal.aborted) setState(body) })
      .catch(() => { if (!abort.signal.aborted) setFailed(true) })
    return () => abort.abort()
  }, [taskId, revision, retry])
  return (
    <section className="task-drawer__block" aria-label="Covered outcomes">
      <h3>{state?.automatic ? 'Recorded coverage' : 'What did this sitting cover?'}</h3>
      <p className="fine-print">{state?.automatic ? 'This completed task names one outcome, so that outcome is recorded as covered. Reopen the task if recorded incorrectly.' : 'Choose only the outcomes you covered. This updates Curriculum and test scope; it does not record test evidence.'}</p>
      {failed ? <p role="alert">Coverage could not be loaded. <button type="button" className="text-button" onClick={() => setRetry(n => n + 1)}>Try again</button></p>
        : !state ? <p role="status">Loading outcomes…</p>
        : state.unmapped ? <p>This task needs a curriculum mapping. <Link href="/app/curriculum">Open Curriculum</Link> to identify the reading you studied.</p>
        : <>
          <p><Link href={`/app/curriculum/${state.reading.topic_id}/${state.reading.id}`}>{state.reading.title}</Link></p>
          {state.automatic ? <p>{state.outcomes[0]?.title}. Covered does not mean understood.</p> : <>
            {state.confirmed.length > 0 && <p className="fine-print" role="status">Saved coverage: {state.confirmed.length} outcome{state.confirmed.length === 1 ? '' : 's'}. Edit below if needed.</p>}
            <ScopeConfirmForm key={`${taskId}:${state.revision}`} blockId={taskId} expectedRevision={state.revision} outcomes={state.outcomes} initialPicked={state.confirmed} />
          </>}
          <p className="fine-print"><Link href="/app/tests#scope-h">Review this week&apos;s test scope</Link></p>
        </>}
    </section>
  )
}
