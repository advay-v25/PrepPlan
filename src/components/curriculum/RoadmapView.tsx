'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { PHASE_LABEL, PHASE_PURPOSE, type Roadmap } from '../../lib/curriculum/roadmap'
import type { Progress } from '../../lib/curriculum/roadmapService'

type TopicInfo = { id: string; name: string; weightMin: number; weightMax: number; summary: string }
type ModuleInfo = { id: string; topic: string; name: string; summary: string; effortBand: number; difficulty: number }

const COVERAGE_LABEL: Record<string, string> = {
  not_started: 'Not started', taught: 'Covered in class', studied: 'Studied',
  verified: 'Verified by a diagnostic', decaying: 'Going stale',
}
const SELF_REPORTABLE = ['not_started', 'taught', 'studied', 'decaying']

function shortDate(d: string) {
  const [y, m, dd] = d.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, dd)))
}

/**
 * The roadmap, shown as the model produced it.
 *
 * The phase bar carries the shape of the whole run — including the reserved
 * final weeks, which is the part students most need to see is protected. Under
 * it, the feasibility verdict and the gap between planned and actual, because
 * a plan that cannot say whether it is working is decoration.
 */
export function RoadmapView({
  roadmap, status, progress, topics, modules, coverage, examLabel, changeExamHref,
}: {
  roadmap: Roadmap
  status: string
  progress: Progress
  topics: TopicInfo[]
  modules: ModuleInfo[]
  coverage: Record<string, string>
  examLabel: string | null
  changeExamHref: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(
    progress.currentMilestone ? `${progress.currentMilestone.topicId}-${progress.currentMilestone.sequence}` : null
  )
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  const topicById = useMemo(() => new Map(topics.map(t => [t.id, t])), [topics])
  const moduleById = useMemo(() => new Map(modules.map(m => [m.id, m])), [modules])

  const totalWeeks = roadmap.totalWeeks || 1

  // Every action reports what happened: pending, saved (and what it does and does not change), or a recoverable failure.
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fail = (text: string) => setNotice({ tone: 'error', text })

  async function send(url: string, body: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => null)
      return data && typeof data === 'object' && 'ok' in data ? data : { ok: false, error: 'The server sent an unexpected reply.' }
    } catch { return { ok: false, error: 'No connection.' } }
  }

  async function regenerate() {
    setBusy(true); setNotice(null)
    const data = await send('/api/roadmap', { activate: true })
    setBusy(false)
    if (!data.ok) return fail(`The roadmap was not rebuilt (${data.error ?? 'unknown problem'}). Nothing changed; try again.`)
    setNotice({ tone: 'ok', text: 'Roadmap rebuilt from where you are now. Your accepted week in Calendar is unchanged; the next weekly review plans from this roadmap.' })
    router.refresh()
  }

  async function setCoverage(lmId: string, state: string) {
    setSaving(lmId); setNotice(null)
    const data = await send('/api/curriculum/coverage', { lmId, state })
    setSaving(null)
    if (!data.ok) return fail(data.code === 'VERIFIED_COVERAGE_PROTECTED' ? String(data.error) : `Not saved (${data.error ?? 'unknown problem'}). Your previous answer is still in place.`)
    setNotice({ tone: 'ok', text: 'Saved as your own report, not test evidence. This week’s accepted tasks are unchanged; the roadmap and your next weekly review use it.' })
    router.refresh()
  }

  const feas = roadmap.feasibility
  const verdictTone =
    feas.verdict === 'comfortable' ? 'ok'
    : feas.verdict === 'tight' ? 'warn'
    : feas.verdict === 'not_enough_time' ? 'bad' : 'neutral'

  const progressTone =
    progress.verdict === 'ahead' ? 'ok'
    : progress.verdict === 'on_track' ? 'ok'
    : progress.verdict === 'slipping' ? 'warn'
    : progress.verdict === 'behind' ? 'bad' : 'neutral'

  return (
    <div className="roadmap">
      <section className="glass-hero glass-hero--compact">
        <div className="glass-hero__top">
          <div>
            <p className="glass-hero__eyebrow">{examLabel ? `Sitting ${examLabel}` : 'Your roadmap'}</p>
            <p className="glass-hero__date">{roadmap.totalWeeks} weeks to {roadmap.targetKind === 'sitting' ? 'the target sitting' : 'the exam'}</p>
            <p className="glass-hero__meta" style={{ marginTop: 6 }}>
              {shortDate(roadmap.startDate)} → {shortDate(roadmap.targetDate)}
              {status === 'draft' && ' · draft'}
              {' · '}Week {progress.weeksElapsed + 1} of {progress.totalWeeks}
            </p>
          </div>
          <div className="glass-hero__facts" aria-label="Coverage, as you reported it">
            <strong>{modules.filter(m => ['studied', 'verified'].includes(coverage[m.id] ?? '')).length} of {modules.length}</strong>
            <span>readings reported covered</span>
            <small>{modules.filter(m => coverage[m.id] === 'taught').length} partly covered · your own report, not test evidence</small>
          </div>
        </div>
        <div className="glass-panel__foot" style={{ marginTop: 'var(--space-5)' }}>
          <Link className="glass-pill-button" href={changeExamHref}>Change exam</Link>
          <button type="button" className="glass-pill-button" onClick={regenerate} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
            Rebuild from where I am now
          </button>
        </div>
      </section>
      <p role={notice?.tone === 'error' ? 'alert' : 'status'} className={notice ? `note${notice.tone === 'error' ? ' note--warn' : ''}` : 'sr-only'}>{notice?.text ?? (busy || saving ? 'Saving…' : '')}</p>

      {/* Phase bar — the shape of the whole run, including the reserved weeks. */}
      <div className="phase-bar" role="img" aria-label={`Plan phases: ${roadmap.phases.map(p => `${PHASE_LABEL[p.phase]} ${p.weeks} weeks`).join(', ')}`}>
        {roadmap.phases.map(p => (
          <div
            key={p.phase}
            className={`phase-segment phase-${p.phase}`}
            style={{ flexGrow: p.weeks }}
            title={`${PHASE_LABEL[p.phase]} — ${p.weeks} weeks`}
          >
            <strong>{PHASE_LABEL[p.phase]}</strong>
            <small>{p.weeks}w · from {shortDate(p.startDate)}</small>
          </div>
        ))}
      </div>
      <p className="fine-print phase-note">
        {PHASE_PURPOSE[roadmap.phases[roadmap.phases.length - 1].phase]}
      </p>

      <div className="roadmap-verdicts">
        <section className={`verdict verdict--${verdictTone}`}>
          <h3>
            {feas.verdict === 'comfortable' && <CheckCircle2 size={16} aria-hidden />}
            {(feas.verdict === 'tight' || feas.verdict === 'not_enough_time') && <AlertTriangle size={16} aria-hidden />}
            Does this fit?
          </h3>
          <p>{feas.message}</p>
          {feas.options.length > 0 && (
            <ul className="verdict-options">
              {feas.options.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          )}
        </section>

        <section className={`verdict verdict--${progressTone}`}>
          <h3>
            {progress.verdict === 'ahead' && <TrendingUp size={16} aria-hidden />}
            {(progress.verdict === 'slipping' || progress.verdict === 'behind') && <TrendingDown size={16} aria-hidden />}
            Planned against actual
          </h3>
          <div className="progress-compare">
            <div>
              <span>Plan expected</span>
              <div className="progress-track"><div className="progress-fill progress-fill--blue" style={{ width: `${progress.plannedPercent}%` }} /></div>
              <small>{progress.plannedPercent}%</small>
            </div>
            <div>
              <span>Covered so far</span>
              <div className="progress-track"><div className={`progress-fill ${progress.actualPercent >= progress.plannedPercent ? 'progress-fill--green' : 'progress-fill--amber'}`} style={{ width: `${progress.actualPercent}%` }} /></div>
              <small>{progress.actualPercent}%</small>
            </div>
          </div>
          <p>{progress.message}</p>
          <p className="fine-print">
            Week {progress.weeksElapsed + 1} of {progress.totalWeeks} · {progress.modulesDone} of {progress.modulesTotal} modules verified. Measured by effort; your setup coverage is an estimate, not test evidence.
          </p>
        </section>
      </div>

      {(roadmap.checkpoints.length > 0 || roadmap.warnings.length > 0 || roadmap.assumptions.length > 0) && (
        <details className="verdict verdict--neutral verdict--fold" aria-label="What this plan is based on">
          <summary>What this plan is based on</summary>
          <ul className="verdict-options">
            {roadmap.checkpoints.map(c => <li key={c.id ?? c.date} data-appointment={c.id}>{c.label?.trim() || 'Your mock'} on {shortDate(c.date)}{c.startTime ? ` at ${c.startTime}` : ''} (week {c.week}). It shapes preparation; it does not replace your exam date. <Link href={`/app/calendar?week=${c.date}${c.id ? `&appointment=${c.id}` : ''}#checkpoint`} className="prose-link">See it in Calendar</Link></li>)}
            {roadmap.warnings.map(w => <li key={w}>{w}</li>)}
            {roadmap.assumptions.map(a => <li key={a}>{a}</li>)}
          </ul>
          <p className="fine-print">These come from your own answers, not from measured pace or test results. Change the mock in Calendar and the rest in Settings.</p>
        </details>
      )}

      {progress.currentMilestone && (
        <div className="roadmap-now">
          <span className="eyebrow">Roadmap milestone</span>
          <strong>{progress.currentMilestone.topicName}</strong>
          <small>
            weeks {progress.currentMilestone.startWeek}–{progress.currentMilestone.endWeek} ·{' '}
            {shortDate(progress.currentMilestone.startDate)} to {shortDate(progress.currentMilestone.endDate)}
          </small>
          <Link href="/app/calendar" className="text-button">See this week &rarr;</Link>
        </div>
      )}

      <div className="section-heading" style={{ marginTop: 28 }}>
        <h2>The sequence</h2>
        <span className="text-muted" style={{ fontSize: 12 }}>{roadmap.milestones.length} milestones</span>
      </div>

      <ol className="milestone-list">
        {roadmap.milestones.map(m => {
          // Resolve from the milestone's own module list: a revision milestone
          // can span two topics, and reading modules off the first one would
          // under-report both the count and the weight.
          const mods = m.moduleIds.map(id => moduleById.get(id)).filter(Boolean) as ModuleInfo[]
          const spannedTopics = [...new Set(mods.map(x => x.topic))]
          const topic = spannedTopics.length === 1 ? topicById.get(spannedTopics[0]) : undefined
          const combinedWeight = spannedTopics
            .map(id => topicById.get(id))
            .filter(Boolean)
            .reduce((acc, t) => ({ min: acc.min + t!.weightMin, max: acc.max + t!.weightMax }), { min: 0, max: 0 })
          const done = mods.filter(x => coverage[x.id] === 'verified').length
          const started = mods.filter(x => coverage[x.id] && coverage[x.id] !== 'not_started').length
          const milestoneKey = `${m.topicId}-${m.sequence}`
          const isOpen = open === milestoneKey
          const isCurrent = progress.currentMilestone?.topicId === m.topicId &&
                            progress.currentMilestone?.sequence === m.sequence

          return (
            <li key={milestoneKey} className={`milestone ${isCurrent ? 'is-current' : ''}`}>
              <button type="button" className="milestone__head" onClick={() => setOpen(isOpen ? null : milestoneKey)} aria-expanded={isOpen}>
                <span className="milestone__weeks">
                  <strong>wk {m.startWeek}{m.endWeek !== m.startWeek && `–${m.endWeek}`}</strong>
                  <small>{shortDate(m.startDate)}</small>
                </span>
                <span className="milestone__body">
                  <strong>{m.topicName}</strong>
                  <small>
                    {`${combinedWeight.min}–${combinedWeight.max}% of the exam · `}
                    {mods.length} module{mods.length === 1 ? '' : 's'}
                    {done > 0 && ` · ${done} verified`}
                    {m.phase !== 'first_pass' && ` · ${PHASE_LABEL[m.phase].toLowerCase()}`}
                    {m.basis === 'reported_uncertainty' && ' · you marked this to revisit'}
                    {m.basis === 'mock_preparation' && ' · before your mock'}
                    {isCurrent && ' · current'}
                  </small>
                  <span className="progress-track" style={{ marginTop: 6 }}>
                    <span className="progress-fill progress-fill--green" style={{ width: `${mods.length ? (done / mods.length) * 100 : 0}%` }} />
                  </span>
                </span>
                <ChevronDown size={17} className={`review-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden />
              </button>

              {isOpen && (
                <div className="milestone__detail">
                  {topic?.summary && <p className="fine-print">{topic.summary}</p>}
                  <ul className="module-rows">
                    {mods.map(mod => {
                      const state = coverage[mod.id] ?? 'not_started'
                      const locked = state === 'verified'
                      return (
                        <li key={mod.id} className={`module-row ${locked ? 'is-verified' : ''}`}>
                          <span>
                            <strong>{mod.name}</strong>
                            <small>{mod.summary}</small>
                          </span>
                          <span className="module-row__state">
                            {locked ? (
                              <em className="tag tag--key">{COVERAGE_LABEL.verified}</em>
                            ) : (
                              <select
                                value={state}
                                disabled={saving === mod.id}
                                onChange={e => setCoverage(mod.id, e.target.value)}
                                aria-label={`Where you are on ${mod.name}`}
                              >
                                {SELF_REPORTABLE.map(s => (
                                  <option key={s} value={s}>{COVERAGE_LABEL[s]}</option>
                                ))}
                              </select>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="fine-print">
                    Only a diagnostic marks a module verified. What you set here is context for planning,
                    not evidence that it holds.
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
