'use client'

import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { Notice } from '../ui/Notice'
import { Button } from '../ui/Button'
import { groupSittings } from '../../lib/onboarding/sittingGroups'
import { ASSESSMENT_AVAILABILITY_HREF, PAPER_UNAVAILABLE_BANK } from '../../lib/tests/assessmentStage'
import type { CurrentWeekPlanState } from '../../lib/planning/currentWeek/state'

type Task = { id: string; title: string; duration_minutes: number; task_type: string; local_date: string }
type Proposal = { draftId: string; revision: number; tasks: Task[]; paper: { kind: 'paper' | 'none'; reason: string | null } | null; planningDate: string; cycle: { start: string; end: string } }

const day = (d: string) => formatStudyDate(d, 'short')

/**
 * Calendar's explanation of a week with nothing planned, and the one next step: add study times (setup) or review a plan (the week).
 * Reviewing never changes the week; only "Add this plan" does, and it adds to THIS cycle.
 */
export function EmptyWeekPlan({ state: initial, autoOpen = false, ownerId }: { state: CurrentWeekPlanState; autoOpen?: boolean; ownerId: string }) {
  const router = useRouter()
  // A preview that finds nothing to add replaces the card's wording with the real reason (until the page is next loaded).
  const [override, setOverride] = useState<CurrentWeekPlanState | null>(null)
  const state = override ?? initial
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [error, setError] = useState('')
  const [needsRebuild, setNeedsRebuild] = useState(false)
  const [note, setNote] = useState('')
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null)
  const [pending, setPending] = useState<'accept' | 'dismiss' | null>(null)
  const autoOpened = useRef(false)
  const restored = useRef(false)
  const storageKey = `roadmap.current-week.pending.${ownerId}`

  function remember(action: 'accept' | 'dismiss') {
    setPending(action)
    try { sessionStorage.setItem(storageKey, JSON.stringify({ action, proposal })) } catch { /* In-memory retry still works. */ }
  }
  function clearPending() {
    setPending(null)
    try { sessionStorage.removeItem(storageKey) } catch { /* Storage is optional. */ }
  }
  function confirmed(receipt: { tasks_added: number }) {
    clearPending()
    setNote(`Added ${receipt.tasks_added} task${receipt.tasks_added === 1 ? '' : 's'} to this week.`)
    setOpen(false); setProposal(null); router.refresh()
  }

  const prepare = useCallback(async () => {
    setOverride(null); setNote(''); setRecoveryUrl(null)
    setOpen(true); setBusy(true); setError(''); setNeedsRebuild(false); setProposal(null)
    try {
      const res = await fetch('/api/planning/current-week/preview', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'We could not prepare a plan just now. Nothing was changed.')
      if (!data.draft) { setOverride(data.state); setOpen(false); return }
      setProposal(data.draft)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }, [])
  useEffect(() => {
    let recovering = false
    if (!restored.current) {
      restored.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
        if (['accept', 'dismiss'].includes(saved?.action) && saved.proposal?.draftId && Number.isInteger(saved.proposal.revision)) {
          setProposal(saved.proposal); setPending(saved.action); setOpen(true); recovering = true
          setError('A previous save has an unconfirmed response. Retry the same request to check safely.')
        }
      } catch { /* A previous in-memory request may still be retried. */ }
    }
    if (!autoOpen) { autoOpened.current = false; return }
    if (autoOpened.current) return
    autoOpened.current = true
    const url = new URL(window.location.href)
    url.searchParams.delete('plan')
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
    if (!recovering && !pending && initial.action?.kind === 'preview') void prepare()
  }, [autoOpen, initial.action?.kind, pending, prepare, router, storageKey])

  function refused(data: { error?: string; rebuild?: boolean; uncertain?: boolean; nextUrl?: string }, status: number) {
    setError(data.error ?? 'The save could not be confirmed. Retry the same request.')
    setNeedsRebuild(!!data.rebuild)
    setRecoveryUrl(data.nextUrl ?? null)
    if (status < 500 && !data.uncertain) clearPending()
  }
  async function accept() {
    if (!proposal || busy) return
    remember('accept'); setBusy(true); setError('')
    try {
      const res = await fetch('/api/planning/current-week/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: proposal.draftId, expectedRevision: proposal.revision }) })
      const data = await res.json()
      if (!res.ok || !data.ok) { refused(data, res.status); return }
      if (!Number.isInteger(data.receipt?.tasks_added)) throw new Error('Missing receipt')
      confirmed(data.receipt)
    } catch { setError('The response was lost. Your plan may already be saved. Retry the same save to check without adding it twice.') }
    finally { setBusy(false) }
  }
  async function keepEmpty() {
    if (!proposal || busy) return
    remember('dismiss'); setBusy(true); setError('')
    try {
      const res = await fetch('/api/planning/current-week/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: proposal.draftId, expectedRevision: proposal.revision }) })
      const data = await res.json()
      if (!res.ok || !data.ok) { refused(data, res.status); return }
      if (data.outcome === 'accepted' && Number.isInteger(data.receipt?.tasks_added)) { confirmed(data.receipt); return }
      if (!['dismissed', 'already_dismissed'].includes(data.outcome)) throw new Error('Missing receipt')
      clearPending(); setOpen(false); setProposal(null); setNote('Kept empty. Review a plan any time.'); router.refresh()
    } catch { setError('The response was lost. Retry keeping the week empty to check the outcome safely.') }
    finally { setBusy(false) }
  }

  const groups = useMemo(() => groupSittings(proposal?.tasks ?? []), [proposal])
  const days = [...new Set(groups.map(g => g.date))].sort()

  if (!pending && !open && (state.kind === 'not_applicable' || state.kind === 'plan_accepted')) return note ? <Notice tone="info" role="status">{note}</Notice> : null

  return (
    <section className="empty-week" aria-labelledby="empty-week-h">
      <Notice tone={state.kind === 'cycle_ended' || state.kind === 'proposal_stale' ? 'warn' : 'info'} role="status">
        <strong id="empty-week-h">{pending ? 'Check your previous save' : state.title}.</strong> {pending ? 'Retry its original request to confirm what happened.' : state.message}{' '}
        {!pending && state.action?.kind === 'link' && <Link href={state.action.href} className="prose-link">{state.action.label}</Link>}
        {!pending && state.action?.kind === 'preview' && !open && <button type="button" className="text-button" onClick={() => void prepare()}>{state.action.label}</button>}
        {state.kind === 'no_usable_windows' && <> <Link href="/app/tests" className="prose-link">See what can be assessed</Link></>}
      </Notice>
      {note && <Notice tone="info" role="status">{note}</Notice>}

      {open && (
        <div className="empty-week__panel" role="region" aria-label="Proposed plan for this week">
          {busy && !proposal && <p role="status"><Loader2 className="animate-spin" size={16} aria-hidden /> Preparing a plan for the rest of this week…</p>}
          {error && (
            <Notice tone="danger" role="alert">{error}{' '}
              {recoveryUrl && <Link href={recoveryUrl} className="prose-link">{recoveryUrl === '/app/review-week' ? 'Review the week' : 'Open Calendar'}</Link>}
              {!pending && (needsRebuild || !proposal) && <Button variant="secondary" onClick={() => void prepare()}><RefreshCw size={14} aria-hidden /> Rebuild the plan</Button>}
            </Notice>
          )}
          {proposal && (
            <>
              <h3>Proposed for the rest of this week</h3>
              <p className="fine-print">Built from your remaining study times, commitments and classes. Nothing is added until you add it.</p>
              <ol className="ob-weekpreview">
                {days.map(d => (
                  <li key={d} className="ob-weekpreview__day">
                    <strong>{day(d)}{d === proposal.cycle.end ? ' · last day' : ''}</strong>
                    {groups.filter(g => g.date === d).map(g => g.items.length === 1
                      ? <span key={g.key} className={`ob-block ob-block--${g.paper ? 'paper' : 'study'}`}>{g.title} · {g.minutes} min</span>
                      : <details key={g.key} className="ob-block ob-block--study"><summary>{g.title} · {g.items.length} sittings · {g.minutes} min</summary><ul className="fine-print">{g.items.map(t => <li key={t.id}>{t.title} · {t.duration_minutes} min</li>)}</ul></details>)}
                  </li>
                ))}
              </ol>
              {proposal.paper?.kind === 'none' && <p className="fine-print">No paper is placed this week. {proposal.paper.reason === 'insufficient_bank' || proposal.paper.reason === 'below_minimum_paper' ? <>{PAPER_UNAVAILABLE_BANK} <Link className="prose-link" href={ASSESSMENT_AVAILABILITY_HREF}>View assessment availability</Link></> : 'The week closes with a checkpoint instead.'}</p>}
              <div className="ob-actions">
                {!pending && <Button variant="text" onClick={() => setOpen(false)} disabled={busy}>Close preview</Button>}
                <Button variant="text" onClick={() => void keepEmpty()} disabled={busy || needsRebuild || !!recoveryUrl || pending === 'accept'}>{pending === 'dismiss' ? 'Retry keeping the week empty' : 'Keep the week empty'}</Button>
                <Button onClick={() => void accept()} loading={busy} disabled={busy || needsRebuild || !!recoveryUrl || pending === 'dismiss'}>{pending === 'accept' ? 'Retry the same save' : 'Add this plan to my week'}</Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
