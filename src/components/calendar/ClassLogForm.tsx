'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string; outcomes: { id: string; code: string; title: string }[] }[] }[]
type Item = { extent: 'part' | 'full' | 'continued'; portionNote: string; studiedInClass: boolean }
type Preview = {
  ok: true; tasks: { date: string; title: string; detail: string | null; minutes: number; lane: string }[]
  carryover: { title: string; reason: string }[]; pressure: string; fingerprint: string; skippedStudiedInClass: number
}

const KINDS = [
  { v: 'covered', label: 'We covered new material' },
  { v: 'revision', label: 'A revision or doubt class' },
  { v: 'missed', label: 'I missed the class' },
  { v: 'cancelled', label: 'The class did not happen' },
  { v: 'none', label: 'Nothing to log' },
] as const

const PRESSURE: Record<string, string> = {
  comfortable: 'This fits comfortably in the days you have free.',
  tight: 'This week is tight — it fits, with little slack.',
  over: 'Not everything fits before your paper. What does not fit is listed below and carries over.',
}

export function ClassLogForm(props: {
  catalog: Catalog; classDates: string[]; defaultDate: string; initialReadingId: string | null
}) {
  const router = useRouter()
  const initial = props.initialReadingId
    ? props.catalog.flatMap(s => s.readings.map(r => ({ s, r }))).find(x => x.r.id === props.initialReadingId) ?? null : null

  const [classDate, setClassDate] = useState(props.defaultDate)
  const [kind, setKind] = useState<typeof KINDS[number]['v']>('covered')
  const [subjectId, setSubjectId] = useState(initial?.s.id ?? props.catalog[0]?.id ?? '')
  const [readingId, setReadingId] = useState(initial?.r.id ?? '')
  const [items, setItems] = useState<Record<string, Item>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [key] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`))

  const subject = props.catalog.find(s => s.id === subjectId)
  const reading = subject?.readings.find(r => r.id === readingId) ?? null
  const outcomeIndex = useMemo(() => {
    const m = new Map<string, { title: string; readingNo: number }>()
    for (const s of props.catalog) for (const r of s.readings) for (const o of r.outcomes) m.set(o.id, { title: o.title, readingNo: r.no })
    return m
  }, [props.catalog])

  const hasCoverage = kind === 'covered' || kind === 'revision'
  const payload = () => ({
    classDate, kind,
    items: hasCoverage ? Object.entries(items).map(([outcomeId, i]) => ({
      outcomeId, extent: i.extent, portionNote: i.portionNote || undefined, studiedInClass: i.studiedInClass,
    })) : [],
  })

  const edit = (fn: () => void) => { fn(); setPreview(null); setMessage(null) }
  const toggle = (id: string) => edit(() => setItems(s => {
    const n = { ...s }; if (n[id]) delete n[id]; else n[id] = { extent: 'part', portionNote: '', studiedInClass: false }; return n
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
    } finally { setBusy(false) }
  }

  async function confirm() {
    if (!preview) return
    setBusy(true); setMessage(null)
    try {
      const r = await post('/api/class-log/confirm', { ...payload(), idempotencyKey: key, fingerprint: preview.fingerprint })
      if (r.ok) { router.push(r.nextUrl ?? '/app/calendar'); router.refresh(); return }
      setMessage(r.message ?? r.error ?? 'Could not save.')
      if (r.code === 'preview_changed' && r.preview?.ok) setPreview(r.preview)
    } finally { setBusy(false) }
  }

  const byDate = preview ? preview.tasks.reduce<Record<string, Preview['tasks']>>((m, t) => { (m[t.date] ??= []).push(t); return m }, {}) : {}
  const canPreview = !hasCoverage || Object.keys(items).length > 0

  return (
    <div className="class-log">
      <fieldset>
        <legend>Which class?</legend>
        <label>Class day
          <select value={classDate} onChange={e => edit(() => setClassDate(e.target.value))}>
            {props.classDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <div role="radiogroup" aria-label="What happened in class" className="class-log__kinds">
          {KINDS.map(k => (
            <label key={k.v}><input type="radio" name="kind" checked={kind === k.v} onChange={() => edit(() => setKind(k.v))} /> {k.label}</label>
          ))}
        </div>
      </fieldset>

      {hasCoverage && (
        <fieldset>
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
                    {' '}<button type="button" className="text-button" onClick={() => toggle(id)}>Remove</button></li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>
      )}

      <button type="button" className="secondary-button" onClick={runPreview} disabled={busy || !canPreview}>
        {busy && !preview ? 'Working…' : 'Preview the plan update'}
      </button>
      {!canPreview && <p className="review-hint">Choose at least one outcome, or pick a different class type.</p>}
      {message && <p role="alert" className="review-error">{message}</p>}

      {preview && (
        <section aria-labelledby="preview-h" className="class-log__preview">
          <h2 id="preview-h">What will be added to your week</h2>
          <p>{PRESSURE[preview.pressure]}</p>
          {preview.skippedStudiedInClass > 0 && <p>{preview.skippedStudiedInClass} item(s) marked as studied in class need no extra work.</p>}
          {preview.tasks.length === 0 ? <p>Nothing new needs placing.</p> : (
            <ol>{Object.entries(byDate).map(([d, ts]) => (
              <li key={d}><strong>{d}</strong><ul>{ts.map((t, n) => <li key={n}>{t.title} <small>· {t.minutes} min</small>{t.detail && <em> — {t.detail}</em>}</li>)}</ul></li>
            ))}</ol>
          )}
          {preview.carryover.length > 0 && (
            <div><strong>Does not fit before your paper</strong>
              <ul>{preview.carryover.map((c, n) => <li key={n}>{c.title}</li>)}</ul>
              <p className="review-hint">Raise these with your Coach, or mark anything you already did earlier.</p></div>
          )}
          <button type="button" className="primary-button" onClick={confirm} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm and update my week'}
          </button>
        </section>
      )}
    </div>
  )
}
