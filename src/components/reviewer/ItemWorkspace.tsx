'use client'

import { WhenReady } from '../ui/WhenReady'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { ITEM_STATE_HELP, itemStateLabel, type ItemState } from '../../lib/diagnostic/itemState'
import { SEMANTIC_LIMIT_NOTICE } from '../../lib/diagnostic/authoringPackage'

type Validation = { id: string; reviewer_role: string; status: string; defect_codes: string[]; detail: any; item_version: number | null; created_at: string }
type Props = {
  ws: {
    item: { id: string; item_version: number; review_status: ItemState; stem: string; options: string[]; key_index: number | null; per_option_feedback: Record<string, string>; item_card: any
      concept_id: string | null; outcome_id: string | null; lm_id: string; held_out: boolean; family_id: string | null; semantic_fingerprint: string | null
      cognition: string | null; item_form: string | null; intended_difficulty: string | null; generator_model: string | null; verifier_model: string | null; provenance: string; supersedes_item_id: string | null; reviewed_at: string | null }
    concept: { id: string; name: string; topic: string; scope_notes: string | null; excluded_or_superseded: string | null; verification_status: string } | null
    reading: { id: string; reading_no: number; title: string } | null
    outcome: { id: string; code: string; title: string } | null
    validations: Validation[]
    decisions: { id: string; item_version: number; decision: string; note: string; created_at: string; acknowledged_disagreement: boolean }[]
    revisions: { id: string; item_version: number; kind: string; summary: string; created_at: string }[]
    family: { family: { id: string; family_key: string; held_out: boolean; held_out_reason: string | null; construction_status?: string } | null; members: { id: string; review_status: string; stem: string; options: string[]; key_index: number | null; item_version: number }[] } | null
    batch: { id: string; label: string; rights_status: string; rights_ref?: string | null; curriculum_version: string; prompt_version: string; source_provenance: any; model_versions: any } | null
    blockers: string[]
    challenges: { id: string; status: string; reason_code: string | null; comment: string; created_at: string }[]
    chain: { id: string; version: number; state: string }[]
    duplicates: { id: string; review_status: string; stem: string }[]
    near: { id: string; review_status: string; stem: string; similarity: number; sameFamily: boolean }[]
    difficulty: { proposed: string | null; confirmed: { level: string; rationale: string; reviewer_id: string; created_at: string } | null; history: { id: string; item_version: number; level: string; rationale: string; reviewer_id: string; created_at: string }[]; empirical: null }
    answeredCount: number
  }
  readingOutcomes: { id: string; label: string; conceptId: string | null; conceptVerified: boolean }[]
  blockersIfAcknowledged: string[]
}

const when = (s: string) => new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })   // fixed zone: the server and the browser render the same text (no hydration mismatch)

export function ItemWorkspace({ ws, readingOutcomes, blockersIfAcknowledged }: Props) {
  const router = useRouter()
  const { item } = ws
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string; list?: string[]; reload?: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [groupWith, setGroupWith] = useState('')

  const current = ws.validations.filter(v => (v.item_version ?? 1) === item.item_version && v.reviewer_role !== 'human_reviewer')
  const olderChecks = ws.validations.filter(v => (v.item_version ?? 1) !== item.item_version && v.reviewer_role !== 'human_reviewer')
  const older = olderChecks.length
  const disagreement = current.some(v => v.status === 'HUMAN_REVIEW')
  const verdict = current.find(v => v.detail?.gate === 'verdict')
  const approvedHere = ws.decisions.some(d => d.decision === 'approve')
  const legacy = item.review_status === 'reviewed' && !approvedHere
  const blockers = disagreement && ack ? blockersIfAcknowledged : ws.blockers
  const confirmedLevel = ws.difficulty.confirmed
  const canApprove = blockers.length === 0 && (item.review_status === 'verified' || legacy) && Boolean(confirmedLevel)
  const unpublished = item.review_status === 'draft' || item.review_status === 'verified'
  const successor = ws.chain.find(c => c.version > item.item_version && c.state !== 'deprecated')

  async function call(label: string, url: string, body: object, after?: (d: any) => void) {
    setBusy(label); setMsg(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok !== false) {
        setNote(''); setAck(false)
        if (label === 'approve' && d.repeated) setMsg({ tone: 'ok', text: 'Already recorded; nothing changed.', reload: true })
        else {
          setMsg({ tone: 'ok', text: d.repeated ? 'Already recorded; nothing changed.' : 'Done.' })
          after ? after(d) : router.refresh()
        }
      }
      else setMsg({ tone: 'err', text: d.error ?? d.message ?? 'That did not work. Nothing was changed.', list: d.blockers, reload: label === 'approve' && res.status === 409 })
    } catch { setMsg({ tone: 'err', text: 'Network error. Nothing was changed.' }) }
    setBusy(null)
  }
  const [level, setLevel] = useState<string>(confirmedLevel?.level ?? ws.difficulty.proposed ?? 'standard')
  const [why, setWhy] = useState(confirmedLevel?.rationale ?? '')
  const confirmLevel = () => call('difficulty', `/api/diagnostic/items/${encodeURIComponent(item.id)}/difficulty`, { level, rationale: why, expectedVersion: item.item_version })
  const decide = (decision: string) => call(decision, `/api/diagnostic/items/${encodeURIComponent(item.id)}/review`, { decision, note, expectedVersion: item.item_version, acknowledgeDisagreement: ack })

  return (
    <WhenReady>
    <div className="rv-grid">
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {successor && <p className="notice notice--info"><span>A newer version exists: <Link href={`/app/tests/review/${encodeURIComponent(successor.id)}`}>{successor.id}</Link> ({itemStateLabel(successor.state)}). This one stays as it was for the attempts that used it.</span></p>}
        {ws.answeredCount > 0 && <p className="notice notice--info"><span>{ws.answeredCount} student answer{ws.answeredCount === 1 ? '' : 's'} used this exact version. Editing it creates a new version; these results keep their meaning.</span></p>}

        <section className="rv-panel" aria-labelledby="q-h">
          <h2 id="q-h">Question</h2>
          <div className="review-queue__tags">
            <span className={`tag tag--state-${item.review_status}`} title={ITEM_STATE_HELP[item.review_status]}>{legacy ? 'Reviewed, no decision on record' : itemStateLabel(item.review_status)}</span>
            {item.held_out && <span className="tag tag--dim">Held out of routine papers</span>}
            {item.cognition && <span className="tag tag--dim">{item.cognition}</span>}
            {item.item_form && <span className="tag tag--dim">{item.item_form}</span>}
            {item.intended_difficulty && <span className="tag tag--dim">{item.intended_difficulty}</span>}
          </div>
          {editing
            ? <Editor item={item} readingOutcomes={readingOutcomes} newVersion={item.review_status === 'reviewed' || ws.answeredCount > 0} busy={busy === 'edit'} onCancel={() => setEditing(false)}
                onSave={(patch, why) => call('edit', `/api/diagnostic/items/${encodeURIComponent(item.id)}/edit`, { patch, note: why, expectedVersion: item.item_version }, d => { setEditing(false); d.mode === 'new_version' ? router.push(`/app/tests/review/${encodeURIComponent(d.itemId)}`) : router.refresh() })} />
            : <>
              <p style={{ fontSize: 15, lineHeight: 1.55, margin: 0 }}>{item.stem}</p>
              <ol className="review-options">
                {item.options.map((o, i) => {
                  const dx = (item.item_card?.distractorDiagnoses ?? []).find((d: any) => d.optionIndex === i)
                  return (
                    <li key={i} className={`review-option ${item.key_index === i ? 'is-key' : ''}`}>
                      <span className="review-option__letter">{String.fromCharCode(65 + i)}</span>
                      <span className="review-option__text"><strong>{o}</strong>
                        {item.per_option_feedback?.[String(i)] && <span className="review-option__feedback">{item.per_option_feedback[String(i)]}</span>}
                        {dx && <span className="review-option__feedback"><em>{dx.errorCode}</em> — {dx.description}</span>}
                      </span>
                      <span className="review-option__tags">{item.key_index === i && <em className="tag tag--key">Key</em>}</span>
                    </li>
                  )
                })}
              </ol>
              {item.item_card?.solution && <div className="review-solution"><h4>Worked solution</h4><p>{item.item_card.solution}</p></div>}
            </>}
        </section>

        <section className="rv-panel" aria-labelledby="map-h">
          <h2 id="map-h">Curriculum mapping</h2>
          <ul className="rv-list">
            <li><strong>Reading:</strong> {ws.reading ? `Reading ${ws.reading.reading_no}: ${ws.reading.title}` : item.lm_id}</li>
            <li><strong>Outcome:</strong> {ws.outcome ? `${ws.outcome.code}. ${ws.outcome.title}` : <span className="is-fail">None</span>}</li>
            <li><strong>Concept:</strong> {ws.concept ? ws.concept.name : <span className="is-fail">None</span>} {ws.concept && (ws.concept.verification_status === 'verified' ? <span className="is-pass">· signed off</span> : <span className="is-warn">· <Link href="/app/tests/manifest">not signed off yet</Link></span>)}</li>
            {ws.concept?.scope_notes && <li><strong>Scope given to the author:</strong> {ws.concept.scope_notes}{ws.concept.excluded_or_superseded ? ` Excluded: ${ws.concept.excluded_or_superseded}` : ''}</li>}
          </ul>
        </section>

        <section className="rv-panel" aria-labelledby="chk-h">
          <h2 id="chk-h">Automatic checks for version {item.item_version}</h2>
          {current.length === 0 ? <p className="rv-list is-fail">No automatic check result for this version{older ? ` (${older} older result${older === 1 ? '' : 's'} belong to earlier versions and do not count)` : ''}.</p> : (
            <ul className="rv-list">
              {current.map(v => (
                <li key={v.id} className={v.status === 'PASS' ? 'is-pass' : v.status === 'HUMAN_REVIEW' ? 'is-warn' : 'is-fail'}>
                  <strong>{v.detail?.gate === 'verdict' ? 'Overall' : v.detail?.gate ?? v.reviewer_role}:</strong> {v.status === 'HUMAN_REVIEW' ? 'checkers disagree — your judgement is needed' : v.status}{v.detail?.detail ? ` — ${v.detail.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
          {verdict?.detail?.independentAnswerIndex != null && <p className="fine-print">The independent checker chose option {String.fromCharCode(65 + Number(verdict.detail.independentAnswerIndex))}; the key is option {item.key_index === null ? '?' : String.fromCharCode(65 + item.key_index)}.</p>}
          <p className="fine-print"><strong>Limits of these checks.</strong> {SEMANTIC_LIMIT_NOTICE}{item.item_card?.isNumeric ? ' This is a numerical item: the arithmetic was executed by a restricted calculator, and the inputs it used are listed in its derivation above.' : ''}</p>
          {olderChecks.length > 0 && <details suppressHydrationWarning><summary>Earlier checks and repairs ({olderChecks.length}, from previous versions)</summary>
            <ul className="rv-list">{olderChecks.map(v => <li key={v.id} className="fine-print">v{v.item_version ?? 1} · {when(v.created_at)} · <strong>{v.detail?.gate === 'verdict' ? 'Overall' : v.detail?.gate ?? v.reviewer_role}:</strong> {v.status}{v.detail?.detail ? ` — ${v.detail.detail}` : ''}</li>)}</ul>
            <p className="fine-print">These belong to superseded versions and do not count toward this version's approval.</p></details>}
        </section>

        <section className="rv-panel" aria-labelledby="fam-h">
          <h2 id="fam-h">Family and similar questions</h2>
          {ws.family?.family
            ? <p className="fine-print">Family <code>{ws.family.family.family_key}</code> · <strong>{ws.family.family.construction_status === 'provisional' ? 'provisional: no reviewer has confirmed this construction, so it is not counted as independent' : 'confirmed'}</strong>{ws.family.family.held_out ? ` · held out (${ws.family.family.held_out_reason})` : ''}. Rewording, new figures and close scenario siblings of one construction belong in the same family.</p>
            : <p className="fine-print">Family <strong>unknown</strong>. This item is not counted as an independent family until a reviewer places it in one.</p>}
          {ws.family && ws.family.members.length > 0 && (
            <div className="rv-diff">
              {[{ id: item.id, review_status: item.review_status, stem: item.stem, options: item.options, key_index: item.key_index, item_version: item.item_version }, ...ws.family.members].map(m => (
                <div key={m.id}><small><Link href={`/app/tests/review/${encodeURIComponent(m.id)}`}>{m.id}</Link> · v{m.item_version} · {itemStateLabel(m.review_status)}</small>{m.stem}<ol style={{ margin: '6px 0 0 18px', padding: 0 }}>{m.options.map((o, i) => <li key={i}><span style={{ fontWeight: m.key_index === i ? 700 : 400 }}>{o}</span></li>)}</ol></div>
              ))}
            </div>
          )}
          {ws.near.length > 0 && <p className="fine-print"><strong>Close in wording, same concept</strong> (an automatic hint; you decide construction): {ws.near.map(d => <span key={d.id}><Link href={`/app/tests/review/${encodeURIComponent(d.id)}`}>{d.id}</Link> {d.similarity}%{d.sameFamily ? ' (already in this family)' : ''}{' · '}</span>)}</p>}
          {ws.duplicates.length > 0 && <p className="fine-print"><strong>Same wording pattern</strong> (a text match, not proof of one family): {ws.duplicates.map(d => <span key={d.id}><Link href={`/app/tests/review/${encodeURIComponent(d.id)}`}>{d.id}</Link>{' '}</span>)}</p>}
          <div className="rv-form">
            <label>Group with these item IDs (comma separated) — same underlying construction
              <input type="text" value={groupWith} onChange={e => setGroupWith(e.target.value)} placeholder="bq-1a2b3c4d-7, bq-1a2b3c4d-9" />
            </label>
            <div className="rv-actions">
              <button type="button" className="secondary-button" disabled={!groupWith.trim() || busy !== null} onClick={() => call('group', `/api/diagnostic/items/${encodeURIComponent(item.id)}/family`, { action: 'group', withItemIds: groupWith.split(',').map(s => s.trim()).filter(Boolean), familyId: ws.family?.family?.id }, () => { setGroupWith(''); router.refresh() })}>Place in a family</button>
              {ws.family?.family?.construction_status === 'provisional' && (
                <button type="button" className="secondary-button" disabled={busy !== null || note.trim().length < 3} title={note.trim().length < 3 ? 'Say in the note box why this is its own construction' : undefined}
                  onClick={() => call('confirm', `/api/diagnostic/items/${encodeURIComponent(item.id)}/family`, { action: 'confirm', expectedVersion: item.item_version, note }, () => router.refresh())}>Confirm this is its own construction</button>
              )}
              <button type="button" className="secondary-button" disabled={busy !== null || (!item.held_out && note.trim().length < 3)} title={item.held_out ? undefined : 'Write a reason in the note box first'}
                onClick={() => call('holdout', `/api/diagnostic/items/${encodeURIComponent(item.id)}/family`, { action: 'holdout', held: !item.held_out, reason: note })}>
                {item.held_out ? 'Release hold-out' : 'Hold out for future mocks'}</button>
            </div>
          </div>
        </section>

        <section className="rv-panel" aria-labelledby="hist-h">
          <h2 id="hist-h">Versions and history</h2>
          <ul className="rv-list">
            {ws.chain.map(c => <li key={c.id}>{c.id === item.id ? <strong>{c.id}</strong> : <Link href={`/app/tests/review/${encodeURIComponent(c.id)}`}>{c.id}</Link>} · v{c.version} · {itemStateLabel(c.state)}</li>)}
          </ul>
          <ul className="rv-list">
            {[...ws.revisions.map(r => ({ t: r.created_at, text: `v${r.item_version} ${r.kind.replace('_', ' ')}${r.summary ? ` — ${r.summary}` : ''}` })),
              ...ws.decisions.map(d => ({ t: d.created_at, text: `v${d.item_version} decision: ${d.decision}${d.note ? ` — ${d.note}` : ''}${d.acknowledged_disagreement ? ' (disagreement acknowledged)' : ''}` }))]
              .sort((a, b) => a.t.localeCompare(b.t)).map((e, i) => <li key={i}><small>{when(e.t)}</small> {e.text}</li>)}
          </ul>
        </section>
      </div>

      <aside className="rv-side" aria-label="Decision">
        <section className="rv-panel" aria-labelledby="dec-h">
          <h2 id="dec-h">Decision</h2>
          {item.review_status === 'deprecated'
            ? <p className="fine-print">This item is retired. It is kept so earlier attempts stay reproducible.</p>
            : (<>
              {(unpublished || legacy) && (
                blockers.length > 0
                  ? <div className="notice notice--warn" role="status"><span><strong>Publication is blocked</strong><ul className="rv-list">{blockers.map(b => <li key={b}>{b}</li>)}</ul></span></div>
                  : <p className="notice notice--info" role="status"><span>Everything required to publish is in place.</span></p>
              )}
              <div className="rv-form" role="group" aria-labelledby="diff-h">
                <h3 id="diff-h" style={{ margin: 0, fontSize: 'var(--text-sm, 0.95rem)' }}>Difficulty level</h3>
                <p className="fine-print">Proposed: <strong>{ws.difficulty.proposed ?? 'none'}</strong> (a proposal, not a decision). {confirmedLevel ? <>Confirmed for this version: <strong>{confirmedLevel.level}</strong> — {confirmedLevel.rationale}</> : <>No level is confirmed for this version. {unpublished || legacy ? 'Approval needs one.' : 'It is used under the existing non-adaptive policy and cannot satisfy a reviewed-difficulty quota.'}</>}</p>
                <label>Level
                  <select value={level} onChange={e => setLevel(e.target.value)}>
                    <option value="foundation">Foundation — direct recognition, a relationship, or a short calculation with clear assumptions</option>
                    <option value="standard">Standard — ordinary Level I application/interpretation, or a modest sequence of justified steps</option>
                    <option value="difficult">Difficult — more demanding but fair integration or discrimination within the same Level I scope</option>
                    <option value="stretch">Stretch — optional challenge framing; never off-syllabus, missing assumptions or trick English</option>
                  </select>
                </label>
                <label>Cognitive demand (why this level)
                  <textarea rows={2} value={why} onChange={e => setWhy(e.target.value)} placeholder="The distinction or reasoning the student must make; not stem length or arithmetic count." />
                </label>
                <div className="rv-actions"><button type="button" className="secondary-button" disabled={busy !== null || why.trim().length < 10 } onClick={confirmLevel}>{busy === 'difficulty' && <Loader2 size={15} className="animate-spin" aria-hidden />}{confirmedLevel ? 'Revise confirmed level' : 'Confirm level'}</button></div>
                {ws.difficulty.history.length > 0 && <details suppressHydrationWarning><summary>Level history ({ws.difficulty.history.length})</summary><ul className="rv-list">{ws.difficulty.history.map(h => <li key={h.id}>v{h.item_version} · {h.level} · {when(h.created_at)} · reviewer {h.reviewer_id.slice(0, 8)} — {h.rationale}</li>)}</ul></details>}
              </div>
              {disagreement && <label className="field"><span><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I have read the checkers’ disagreement and judged it myself.</span></label>}
              <div className="rv-form">
                <label>Note {unpublished || item.review_status === 'reviewed' ? '(required to reject, return or retire)' : ''}
                  <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What is wrong, or what you checked." />
                </label>
              </div>
              <div className="rv-actions">
                {(unpublished || legacy) && <button type="button" className="primary-button" disabled={busy !== null || !canApprove || msg?.reload} onClick={() => decide('approve')}>{busy === 'approve' && <Loader2 size={15} className="animate-spin" aria-hidden />}{legacy ? 'Record my review' : 'Approve and publish'}</button>}
                {unpublished && <button type="button" className="secondary-button" disabled={busy !== null || note.trim().length < 3} onClick={() => decide('return')}>Return for correction</button>}
                {unpublished && <button type="button" className="secondary-button is-danger" disabled={busy !== null || note.trim().length < 3} onClick={() => decide('reject')}>Reject</button>}
                {item.review_status === 'reviewed' && <button type="button" className="secondary-button is-danger" disabled={busy !== null || note.trim().length < 3} onClick={() => decide('retire')}>Retire</button>}
              </div>
              {(unpublished || legacy) && !canApprove && <p className="fine-print">{confirmedLevel ? 'Approve stays off until every blocker is cleared.' : 'Approve stays off until every blocker is cleared and a difficulty level is confirmed.'}</p>}
              <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
              <div className="rv-actions">
                <button type="button" className="secondary-button" disabled={busy !== null || editing} onClick={() => setEditing(true)}>Edit</button>
                {unpublished && <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => call('reverify', `/api/diagnostic/items/${encodeURIComponent(item.id)}/reverify`, {})}>{busy === 'reverify' ? 'Checking… (can take a few minutes)' : 'Re-check automatically'}</button>}
                <Link className="secondary-button" href={`/app/tests/review/${encodeURIComponent(item.id)}/preview`}>Preview as a student</Link>
              </div>
            </>)}
          {msg && <div role={msg.tone === 'err' ? 'alert' : 'status'} className={msg.tone === 'err' ? 'auth-error' : 'fine-print'}>
            {msg.text}
            {msg.list && <ul className="rv-list">{msg.list.map(b => <li key={b}>{b}</li>)}</ul>}
            {msg.reload && <> <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload this question</button></>}
          </div>}
        </section>

        <section className="rv-panel" aria-labelledby="src-h">
          <h2 id="src-h">Source and provenance</h2>
          <ul className="rv-list">
            <li><strong>Provenance:</strong> {item.provenance}</li>
            <li><strong>Author model:</strong> {item.generator_model ?? 'not recorded'}</li>
            <li><strong>Checker model:</strong> {item.verifier_model ?? 'not recorded'}</li>
            {ws.batch && <><li><strong>Batch:</strong> <Link href={`/app/tests/review/batches?batch=${ws.batch.id}`}>{ws.batch.label}</Link></li>
              <li><strong>Curriculum:</strong> {ws.batch.curriculum_version} · prompts {ws.batch.prompt_version}</li>
              <li className={ws.batch.rights_status === 'cleared' ? 'is-pass' : 'is-warn'}><strong>Source rights:</strong> {ws.batch.rights_status === 'cleared' ? `cleared${ws.batch.rights_ref ? ` · authority: ${ws.batch.rights_ref}` : ' · but no authority is recorded'}` : 'not confirmed — cannot be published'}</li>
              <li><strong>Grounding packet:</strong> {item.item_card?.packId ? <>pack <code>{item.item_card.packId}</code>{item.item_card.packVersion ? ` v${item.item_card.packVersion}` : ''}{item.item_card.packEdition ? ` · edition ${item.item_card.packEdition}` : ''} · hash <code>{String(item.item_card.packetHash ?? '').slice(0, 12)}</code></> : 'none recorded (written before packets, or without one)'}</li>
              {item.item_card?.packSource && <li><strong>Source reference:</strong> {String(item.item_card.packSource.name)} · {String(item.item_card.packSource.location)}{item.item_card.packSource.hash ? <> · file hash <code>{String(item.item_card.packSource.hash).slice(0, 12)}</code></> : ''} <span className="fine-print">(the reviewer opens the source from the authoring owner; its text is not stored in the application)</span></li>}
              {item.item_card?.package && <li><strong>Authoring package:</strong> {Object.entries(item.item_card.package as Record<string, string>).map(([k, v]) => `${k} ${v}`).join(' · ')}</li>}</>}
          </ul>
        </section>

        <section className="rv-panel" aria-labelledby="ch-h">
          <h2 id="ch-h">Student challenges</h2>
          {ws.challenges.length === 0 ? <p className="fine-print">None raised.</p> : <ul className="rv-list">{ws.challenges.map(c => <li key={c.id}>{c.status === 'pending' ? <strong>Pending</strong> : c.status.replace('resolved_', 'Resolved: ')} · {c.reason_code ?? 'other'} — {c.comment}</li>)}</ul>}
          <Link className="text-button" href={`/app/tests/review/challenges`}>Open the challenge queue →</Link>
        </section>
      </aside>
    </div>
    </WhenReady>
  )
}

function Editor({ item, readingOutcomes, newVersion, busy, onCancel, onSave }: {
  item: Props['ws']['item']; readingOutcomes: Props['readingOutcomes']; newVersion: boolean; busy: boolean; onCancel: () => void; onSave: (patch: Record<string, unknown>, note: string) => void
}) {
  const [stem, setStem] = useState(item.stem)
  const [options, setOptions] = useState([...item.options])
  const [key, setKey] = useState<number>(item.key_index ?? 0)
  const [fb, setFb] = useState<Record<string, string>>({ '0': '', '1': '', '2': '', ...item.per_option_feedback })
  const [solution, setSolution] = useState<string>(item.item_card?.solution ?? '')
  const [outcome, setOutcome] = useState<string>(item.outcome_id ?? '')
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')

  function save() {
    setErr('')
    if (options.some(o => !o.trim())) return setErr('Every option needs text.')
    if (new Set(options.map(o => o.trim().toLowerCase())).size !== 3) return setErr('The three options must be different.')
    if (stem.trim().length < 20) return setErr('The question text is too short.')
    const patch: Record<string, unknown> = { stem, options: options.map(o => o.trim()), key_index: key, per_option_feedback: fb, item_card: { ...item.item_card, solution } }
    if (outcome && outcome !== item.outcome_id) {
      const o = readingOutcomes.find(x => x.id === outcome)
      if (!o?.conceptId) return setErr('That outcome has no curriculum concept yet, so it cannot be used.')
      patch.outcome_id = outcome; patch.concept_id = o.conceptId
    }
    onSave(patch, why)
  }
  return (
    <div className="rv-form">
      {newVersion
        ? <p className="notice notice--warn"><span>This version is published or has been used by students. Saving creates a <strong>new candidate version</strong>; the published one is unchanged until the new one is approved.</span></p>
        : <p className="notice notice--info"><span>Saving changes this draft and clears its automatic check; re-check it before approving.</span></p>}
      <label>Question<textarea rows={5} value={stem} onChange={e => setStem(e.target.value)} /></label>
      {options.map((o, i) => (
        <label key={i}>Option {String.fromCharCode(65 + i)} {key === i && '(correct)'}
          <input type="text" value={o} onChange={e => setOptions(opts => opts.map((x, j) => j === i ? e.target.value : x))} />
          <textarea rows={2} value={fb[String(i)] ?? ''} onChange={e => setFb(f => ({ ...f, [String(i)]: e.target.value }))} aria-label={`Feedback for option ${String.fromCharCode(65 + i)}`} placeholder="Feedback shown after the paper" />
        </label>
      ))}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 12, fontWeight: 700 }}>Correct option</legend>
        {[0, 1, 2].map(i => <label key={i} style={{ display: 'inline-flex', gap: 6, marginRight: 14, fontWeight: 600 }}><input type="radio" name="key" checked={key === i} onChange={() => setKey(i)} /> {String.fromCharCode(65 + i)}</label>)}
      </fieldset>
      <label>Worked solution<textarea rows={4} value={solution} onChange={e => setSolution(e.target.value)} /></label>
      <label>Outcome (same reading)
        <select value={outcome} onChange={e => setOutcome(e.target.value)}>
          <option value="">No outcome</option>
          {readingOutcomes.map(o => <option key={o.id} value={o.id} disabled={!o.conceptId}>{o.label}{o.conceptId ? '' : ' (no concept yet)'}</option>)}
        </select>
      </label>
      <label>What did you change, and why?<input type="text" value={why} onChange={e => setWhy(e.target.value)} /></label>
      {err && <p role="alert" className="auth-error">{err}</p>}
      <div className="rv-actions">
        <button type="button" className="primary-button" onClick={save} disabled={busy}>{busy ? 'Saving…' : newVersion ? 'Save as a new version' : 'Save changes'}</button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  )
}
