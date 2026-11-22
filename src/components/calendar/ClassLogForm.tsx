'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string; outcomes: { id: string; code: string; title: string }[] }[] }[]
type Extent = 'part' | 'full' | 'continued'
type Item = { extent: Extent; portionNote: string; studiedInClass: boolean }
type Saved = { id: string; kind: string; version: number; completed: boolean; items: { outcomeId: string; extent: Extent; portionNote: string | null; studiedInClass: boolean }[] }
const EXTENT_LABEL: Record<Extent, string> = { part: 'Part of it', full: 'All of it', continued: 'Continued from before' }
type Preview = {
  ok: true; tasks: { date: string; title: string; detail: string | null; minutes: number; lane: string; objective?: string }[]
  carryover: { title: string; reason: string; remainingMinutes?: number; placedMinutes?: number; classLabel?: string | null; classDate?: string }[]; pressure: string; fingerprint: string; skippedStudiedInClass: number
  summary?: { maxSittingMinutes: number; placedMinutes: number; remainingMinutes: number; usableMinutes: number }
  update?: { sessionId: string; version: number; completed: boolean; changedItems: number } | null
}

const KINDS = [
  { v: 'covered', label: 'We covered new material' },
  { v: 'revision', label: 'A revision or doubt class' },
  { v: 'missed', label: 'I missed the class' },
  { v: 'cancelled', label: 'The class did not happen' },
  { v: 'none', label: 'Nothing to log' },
] as const

const PRESSURE: Record<string, string> = {
  comfortable: 'This fits in the study time you have left.',
  tight: 'This week is tight — it fits, with little slack.',
  over: 'Not everything fits before your paper. What does not fit is listed below and carries over.',
}

type Occ = { key: string; label: string; date: string; originalDate: string; moved: boolean; status: 'pending' | 'logged' | 'legacy'; sessionId: string | null; completed: boolean | null; version: number | null; inProgress: boolean }

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`
const statusNote = (o: Occ) => o.status === 'logged' ? (o.completed ? ' (already logged and finished: you can add or correct)' : ' (saved, in progress: continue logging)')
  : o.status === 'legacy' ? ' (that day has an older entry that does not say which class it was)' : o.inProgress ? ' (in progress)' : ''
const dayText = (o: Occ) => `${o.date}${o.moved ? ` (moved from ${o.originalDate})` : ''}`

export function ClassLogForm(props: {
  catalog: Catalog; occurrences: Occ[]; sessions: Saved[]; cycleStart: string; today: string; initialReadingId: string | null
  selectedKey?: string; fixedSession?: boolean; returnHref?: string
}) {
  const router = useRouter()
  const initial = props.initialReadingId
    ? props.catalog.flatMap(s => s.readings.map(r => ({ s, r }))).find(x => x.r.id === props.initialReadingId) ?? null : null

  // A class is chosen by its own identity, never by date alone: two classes on one day are two entries. A manual session is a separate entry.
  const pending = props.occurrences.filter(o => o.status === 'pending')
  const initialKey = props.selectedKey ?? props.occurrences.find(o => o.status === 'logged' && o.completed === false)?.key ?? pending.at(-1)?.key ?? 'manual'
  const [occKey, setOccKey] = useState(initialKey)
  const [manualKey] = useState(() => `manual:${newKey()}`)
  const [manualDate, setManualDate] = useState(props.today)
  const chosen = props.occurrences.find(o => o.key === occKey) ?? null
  const classDate = chosen ? chosen.date : manualDate
  // A saved class is CONTINUED, not re-created: its session, day and kind are fixed and its saved coverage is what the form starts from.
  const savedOf = (o: Occ | null) => (o?.sessionId ? props.sessions.find(x => x.id === o.sessionId) ?? null : null)
  const initialSession = savedOf(props.occurrences.find(o => o.key === initialKey) ?? null)
  const [ver, setVer] = useState<Record<string, number>>({})
  const [kind, setKind] = useState<typeof KINDS[number]['v']>(() => (initialSession?.kind as typeof KINDS[number]['v']) ?? 'covered')
  const [subjectId, setSubjectId] = useState(initial?.s.id ?? props.catalog[0]?.id ?? '')
  const [readingId, setReadingId] = useState(initial?.r.id ?? '')
  const [items, setItems] = useState<Record<string, Item>>(() => Object.fromEntries((initialSession?.items ?? []).map(i => [
    i.outcomeId, { extent: i.extent, portionNote: i.portionNote ?? '', studiedInClass: i.studiedInClass },
  ])))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState(newKey)
  // After a reply that never arrived, the exact request and key are kept: Retry resends that, and nothing in the form can change until it is known.
  const [unsure, setUnsure] = useState<{ body: Record<string, unknown>; key: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const session = savedOf(chosen), updating = Boolean(chosen && session)
  const version = session ? ver[session.id] ?? session.version : 0
  const savedKeys = new Set((session?.items ?? []).map(i => i.outcomeId))

  const subject = props.catalog.find(s => s.id === subjectId)
  const reading = subject?.readings.find(r => r.id === readingId) ?? null
  const outcomeIndex = useMemo(() => {
    const m = new Map<string, { title: string; readingNo: number }>()
    for (const s of props.catalog) for (const r of s.readings) for (const o of r.outcomes) m.set(o.id, { title: o.title, readingNo: r.no })
    return m
  }, [props.catalog])

  const hasCoverage = (session ? session.kind : kind) === 'covered' || (session ? session.kind : kind) === 'revision'
  const payload = () => ({
    classDate, kind: session ? session.kind : kind, ...(session ? { sessionId: session.id } : { occurrenceKey: chosen?.key ?? manualKey }),
    items: hasCoverage ? Object.entries(items).map(([outcomeId, i]) => ({
      outcomeId, extent: i.extent, portionNote: i.portionNote || undefined, studiedInClass: i.studiedInClass,
    })) : [],
  })

  const edit = (fn: () => void) => { if (unsure) return; fn(); setPreview(null); setMessage(null); setDone(null) }
  const choose = (k: string) => edit(() => {
    const o = props.occurrences.find(x => x.key === k) ?? null, sv = savedOf(o)
    setOccKey(k); setKey(newKey())
    setItems(Object.fromEntries((sv?.items ?? []).map(i => [i.outcomeId, { extent: i.extent, portionNote: i.portionNote ?? '', studiedInClass: i.studiedInClass }])))
    if (sv) setKind(sv.kind as typeof KINDS[number]['v'])
  })
  // typed-in coverage that has not been saved is never dropped silently by closing or reloading the tab
  const dirty = !done && (unsure !== null || (!updating && Object.keys(items).length > 0) || (updating && JSON.stringify(Object.entries(items).sort()) !== JSON.stringify((session?.items ?? []).map(i => [i.outcomeId, { extent: i.extent, portionNote: i.portionNote ?? '', studiedInClass: i.studiedInClass }]).sort())))
  useEffect(() => { if (!dirty) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault() }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [dirty])
  const toggle = (id: string) => edit(() => setItems(s => {
    const n = { ...s }; if (n[id]) { if (savedKeys.has(id)) return s; delete n[id] } else n[id] = { extent: 'part', portionNote: '', studiedInClass: false }; return n
  }))
  const patch = (id: string, p: Partial<Item>) => edit(() => setItems(s => ({ ...s, [id]: { ...s[id], ...p } })))

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return res.json()
  }

  async function runPreview() {
    setBusy(true); setMessage(null)
    try {
      const r = await post('/api/class-log/preview', payload())
      if (r.ok) setPreview(r); else { setPreview(null); setMessage(r.message ?? r.error ?? 'Could not build the preview.') }
    } catch { setPreview(null); setMessage('Could not reach PrepPlan. Nothing was changed; your choices are kept. Try the preview again.') }
    finally { setBusy(false) }
  }

  /** `finalise`: Finish class log. Otherwise the coverage so far is saved and the class stays open to continue. */
  async function confirm(finalise: boolean, retry?: { body: Record<string, unknown>; key: string }) {
    if (!preview && !retry) return
    setBusy(true); setMessage(null)
    const body = retry?.body ?? { ...payload(), idempotencyKey: key, fingerprint: preview!.fingerprint, finalise, ...(session ? { expectedVersion: version } : {}) }
    try {
      const r = await post('/api/class-log/confirm', body)
      if (r.ok) {
        setUnsure(null)
        if (body.finalise === true) { router.push(props.returnHref ?? r.nextUrl ?? '/app/calendar'); return }
        setPreview(null); setKey(newKey()); if (r.sessionId && typeof r.version === 'number') setVer(v => ({ ...v, [r.sessionId]: r.version }))
        setDone(r.alreadyApplied ? 'That was already saved earlier; nothing new was added.' : `Coverage so far is saved${r.tasks ? ` and ${r.tasks} follow-up sitting${r.tasks === 1 ? ' was' : 's were'} added` : ''}. The class is not finished: open it again to continue.`)
        router.refresh(); return
      }
      if (r.code === 'unknown') { setUnsure({ body, key: String(body.idempotencyKey) }); setMessage(r.message); return }
      setUnsure(null)
      setMessage(r.message ?? r.error ?? 'Could not save.')
      if (r.code === 'preview_changed' && r.preview?.ok) setPreview(r.preview)
    } catch {
      setUnsure({ body, key: String(body.idempotencyKey) })
      setMessage('We could not confirm whether this was saved. Press Retry to send exactly the same request: if it was saved you get that result back, never a second copy. Check your Calendar first if you would rather not retry.')
    }
    finally { setBusy(false) }
  }

  const byDate = preview ? preview.tasks.reduce<Record<string, Preview['tasks']>>((m, t) => { (m[t.date] ??= []).push(t); return m }, {}) : {}
  const canPreview = updating || !hasCoverage || Object.keys(items).length > 0

  return (
    <div className="class-log">
      <fieldset disabled={Boolean(unsure) || busy}>
        <legend>Which class?</legend>
        {props.fixedSession && chosen ? <p>{chosen.label}, {dayText(chosen)}</p> : <label>Class
          <select aria-label="Class" value={occKey} onChange={e => choose(e.target.value)}>
            {props.occurrences.map(o => <option key={o.key} value={o.key} disabled={o.status === 'legacy'}>{o.label}, {dayText(o)}{statusNote(o)}</option>)}
            <option value="manual">Another session that is not on my timetable</option>
          </select>
        </label>}
        {!chosen && (
          <label>Day it happened
            <input type="date" value={manualDate} min={props.cycleStart} max={props.today} required onChange={e => { if (e.target.value) edit(() => { setManualDate(e.target.value); setKey(newKey()) }) }} />
          </label>
        )}
        <div role="radiogroup" aria-label="What happened in class" className="class-log__kinds">
          {KINDS.map(k => (
            <label key={k.v}><input type="radio" name="kind" disabled={updating} checked={(session ? session.kind : kind) === k.v} onChange={() => edit(() => setKind(k.v))} /> {k.label}</label>
          ))}
        </div>
      </fieldset>

      {updating && (
        <section aria-label="Saved so far" data-testid="class-log-saved" className="class-log__saved">
          <strong>{session!.completed ? 'This class log is finished.' : 'This class log is saved and still open.'}</strong>
          <ul>{session!.items.length === 0 ? <li>No coverage reported yet.</li> : session!.items.map(i => <li key={i.outcomeId}>Reading {outcomeIndex.get(i.outcomeId)?.readingNo}: {outcomeIndex.get(i.outcomeId)?.title} · {EXTENT_LABEL[i.extent]}{i.studiedInClass ? ' · studied in class' : ''}</li>)}</ul>
          <p className="review-hint">{session!.completed ? 'You can still add or correct coverage; finishing it again changes nothing.' : 'Anything the class covered that is not listed above is not reported yet. Saving does not finish the class, and the end time does not either.'}</p>
        </section>
      )}

      {hasCoverage && (
        <fieldset disabled={Boolean(unsure) || busy}>
          <legend>What did you cover?</legend>
          <label>Subject
            <select value={subjectId} onChange={e => edit(() => { setSubjectId(e.target.value); setReadingId('') })}>
              {props.catalog.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Reading
            <select value={readingId} onChange={e => edit(() => setReadingId(e.target.value))}>
              <option value="">Choose a reading…</option>
              {subject?.readings.map(r => <option key={r.id} value={r.id}>{r.no}. {r.title}</option>)}
            </select>
          </label>
          {reading && (
            <ul className="class-log__outcomes">
              {reading.outcomes.map(o => {
                const it = items[o.id]
                return (
                  <li key={o.id}>
                    <label><input type="checkbox" checked={Boolean(it)} onChange={() => toggle(o.id)} /> <strong>{o.code}.</strong> {o.title}</label>
                    {it && (
                      <div className="class-log__detail">
                        <span role="radiogroup" aria-label={`How much of ${o.title}`}>
                          <label><input type="radio" name={`x-${o.id}`} checked={it.extent === 'part'} onChange={() => patch(o.id, { extent: 'part' })} /> Part of it</label>
                          <label><input type="radio" name={`x-${o.id}`} checked={it.extent === 'full'} onChange={() => patch(o.id, { extent: 'full' })} /> All of it</label>
                          <label><input type="radio" name={`x-${o.id}`} checked={it.extent === 'continued'} onChange={() => patch(o.id, { extent: 'continued' })} /> Continued from before</label>
                        </span>
                        <input type="text" placeholder="Which part? (optional)" value={it.portionNote} maxLength={300}
                          onChange={e => patch(o.id, { portionNote: e.target.value })} aria-label={`Which part of ${o.title}`} />
                        {it.extent === 'part' && <small className="muted" data-testid="part-note">Part of an outcome plans the work for that part, but no questions are asked about it until the whole outcome is confirmed. A note is not used to choose questions.</small>}
                        {it.extent === 'continued' && <small className="muted" data-testid="continued-note">Continuing is recorded and its study is planned, but it does not confirm the whole outcome. Choose “All of it” (now or in a later class) when you have covered all of it.</small>}
                        <label><input type="checkbox" checked={it.studiedInClass} onChange={e => patch(o.id, { studiedInClass: e.target.checked })} /> We already studied this in class</label>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {Object.keys(items).length > 0 && (
            <div className="class-log__selected">
              <strong>Logged so far</strong>
              <ul>
                {Object.keys(items).map(id => (
                  <li key={id}>Reading {outcomeIndex.get(id)?.readingNo}: {outcomeIndex.get(id)?.title}
                    {' '}<select aria-label={`How much of ${outcomeIndex.get(id)?.title} (summary)`} value={items[id].extent} onChange={e => patch(id, { extent: e.target.value as Extent })}>{(Object.keys(EXTENT_LABEL) as Extent[]).map(x => <option key={x} value={x}>{EXTENT_LABEL[x]}</option>)}</select>
                    {savedKeys.has(id) ? <small className="muted"> saved</small> : <> <button type="button" className="text-button" onClick={() => toggle(id)}>Remove</button></>}</li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>
      )}

      <button type="button" className="secondary-button" onClick={runPreview} disabled={busy || !canPreview || Boolean(unsure)}>
        {busy && !preview ? 'Working…' : 'Preview the plan update'}
      </button>
      {!canPreview && <p className="review-hint">Choose at least one outcome, or pick a different class type.</p>}
      {message && <p role="alert" className="review-error">{message}</p>}
      {done && <p role="status" data-testid="class-log-done" className="review-hint">{done}</p>}
      {unsure && (
        <div data-testid="class-log-unsure">
          <p className="review-hint">The request below is kept exactly as it was sent. Nothing in the form can change until this is known.</p>
          <button type="button" className="primary-button" onClick={() => void confirm(unsure.body.finalise === true, unsure)} disabled={busy}>{busy ? 'Retrying…' : 'Retry'}</button>{' '}
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { setUnsure(null); setKey(newKey()); setMessage(null); setPreview(null) }}>Start a different entry</button>
        </div>
      )}

      {preview && (
        <section aria-labelledby="preview-h" className="class-log__preview">
          <h2 id="preview-h">What will be added to your week</h2>
          <p>{PRESSURE[preview.pressure]}</p>
          {preview.summary && <p data-testid="class-log-summary" className="review-hint">Each sitting is at most {preview.summary.maxSittingMinutes} min (your sitting limit). {preview.summary.placedMinutes} min placed in time you still have{preview.summary.remainingMinutes > 0 ? `; ${preview.summary.remainingMinutes} min could not be placed yet` : ''}.</p>}
          {preview.skippedStudiedInClass > 0 && <p>{preview.skippedStudiedInClass} item(s) marked as studied in class need no extra work.</p>}
          {preview.tasks.length === 0 ? <p>Nothing new needs placing.</p> : (
            <ol>{Object.entries(byDate).map(([d, ts]) => (
              <li key={d}><strong>{d}</strong><ul>{ts.map((t, n) => <li key={n}>{t.title} <small>· {t.minutes} min</small>{t.detail && <em> — {t.detail}</em>}</li>)}</ul></li>
            ))}</ol>
          )}
          {preview.carryover.length > 0 && (
            <div><strong>Not placed yet</strong>
              <ul>{preview.carryover.map((c, n) => <li key={n}>{c.title}{c.classLabel ? `, ${c.classLabel} on ${c.classDate}` : ''}{c.remainingMinutes ? ` — ${c.remainingMinutes} min still to place${c.placedMinutes ? ` (${c.placedMinutes} min placed above)` : ''}` : ''}{c.reason === 'no_open_day' ? ' (no study day left before your paper)' : ' (no room left in your study time)'}</li>)}</ul>
              <p className="review-hint">This is not lost: it stays owed and is offered again, and your weekly review can carry it forward. You can also raise it with your Coach, or mark anything you already did earlier.</p></div>
          )}
          {updating && preview.update && <p className="review-hint" data-testid="class-log-update-summary">{preview.update.changedItems === 0 ? 'No outcome changed from what is saved.' : `${preview.update.changedItems} outcome${preview.update.changedItems === 1 ? '' : 's'} added or corrected.`} Only the work they affect is shown.</p>}
          <button type="button" className="secondary-button" onClick={() => void confirm(false)} disabled={busy || Boolean(unsure)}>
            {busy ? 'Saving…' : 'Save coverage so far'}
          </button>{' '}
          {!(session?.completed) && <button type="button" className="primary-button" onClick={() => void confirm(true)} disabled={busy || Boolean(unsure)}>
            {busy ? 'Saving…' : 'Finish class log'}
          </button>}
        </section>
      )}
    </div>
  )
}
