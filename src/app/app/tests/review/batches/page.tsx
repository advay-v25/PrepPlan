import Link from 'next/link'
import { requireReviewerPage } from '../../../../../lib/diagnostic/reviewAccess'
import { createAdminClient } from '../../../../../lib/supabase/admin'
import { loadBatchReport } from '../../../../../lib/diagnostic/reviewService'
import { ReviewNav } from '../../../../../components/reviewer/ReviewNav'

export const metadata = { title: 'Authoring batches' }

export const dynamic = 'force-dynamic'
type Sp = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
const STATUS: Record<string, string> = { queued: 'Waiting to start', running: 'Running', complete: 'Finished', failed: 'Finished with no candidates', cancelled: 'Cancelled' }

export default async function BatchesPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  await requireReviewerPage('/app/tests/review/batches')
  const admin = createAdminClient()
  const selected = one(sp.batch)
  const report = selected ? await loadBatchReport(selected) : null
  const { data: batches } = await admin.from('item_batches').select('id, label, status, rights_status, requested_count, created_at, started_at, finished_at').order('created_at', { ascending: false }).limit(30)
  const counts = new Map<string, Record<string, number>>()
  for (const b of batches ?? []) {
    const { data } = await admin.from('item_batch_cells').select('status').eq('batch_id', b.id)
    const m: Record<string, number> = {}; (data ?? []).forEach(c => { m[c.status as string] = (m[c.status as string] ?? 0) + 1 }); counts.set(b.id as string, m)
  }

  return (
    <div className="page-content tests-page">
      <header className="page-header"><div><p className="eyebrow">Reviewer workspace</p><h1>Candidate batches</h1>
        <p>Each batch is a durable request with its curriculum version, source and model record. A restart continues unfinished work and never duplicates a candidate. Nothing here is approved.</p></div><ReviewNav current="batches" /></header>

      {(batches ?? []).length === 0 ? <p className="notice notice--info">No batches yet. Create one with <code>npm run items:batch -- create</code>.</p> : (
        <div className="rv-table">
          {(batches ?? []).map(b => {
            const c = counts.get(b.id as string) ?? {}, total = (b.requested_count as number) || 1, done = (c.drafted ?? 0) + (c.failed ?? 0)
            return (
              <Link key={b.id as string} href={`/app/tests/review/batches?batch=${b.id}`} className="rv-row" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,2fr) minmax(0,1.4fr)' }}>
                <span><strong>{b.label as string}</strong><small>{STATUS[b.status as string]} · {new Date(b.created_at as string).toLocaleDateString('en-GB')}</small></span>
                <span><div className="rv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Cells processed"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></div><small>{done} of {total} cells processed · {c.drafted ?? 0} drafted · {c.failed ?? 0} failed</small></span>
                <span><small className={b.rights_status === 'cleared' ? 'is-pass' : 'is-warn'}>Source rights {b.rights_status === 'cleared' ? 'cleared' : 'not confirmed — cannot be published'}</small></span>
              </Link>
            )
          })}
        </div>
      )}

      {report && (
        <section className="rv-panel" style={{ marginTop: 24 }} aria-labelledby="rep-h">
          <h2 id="rep-h">{report.batch.label}</h2>
          <ul className="rv-list">
            <li><strong>Status:</strong> {STATUS[report.batch.status]} · requested {report.batch.requested_count} · drafted {report.drafted} · failed {report.failed} · still open {report.open} · retried {report.retried}</li>
            <li><strong>Waiting for a person:</strong> {report.awaitingReview} automatically checked · {report.itemsByState.draft ?? 0} draft (failed or undecided checks) · {report.itemsByState.reviewed ?? 0} human reviewed</li>
            <li><strong>Curriculum:</strong> {report.batch.curriculum_version} · <strong>prompts:</strong> {report.batch.prompt_version}</li>
            <li><strong>Models:</strong> author {report.batch.model_versions?.reasoning?.[0]} · checker {report.batch.model_versions?.verifier?.[0]}</li>
            <li><strong>Inputs:</strong> {report.batch.source_provenance?.inputs} {report.batch.source_provenance?.notSupplied}</li>
            <li className={report.batch.rights_status === 'cleared' ? 'is-pass' : 'is-warn'}><strong>Source rights:</strong> {report.batch.rights_status === 'cleared' ? 'cleared' : 'not confirmed. Candidates can be inspected and previewed but cannot be published.'}</li>
            <li><strong>Runtime:</strong> {Math.round(report.runtime.wallSeconds / 60)} min elapsed · {report.runtime.avgGenerateSeconds ?? '—'} s average per processed cell · {report.runtime.calls} model calls · {report.runtime.promptTokens + report.runtime.completionTokens} tokens (cost not billed per token on this account)</li>
            <li><strong>Coverage:</strong> {report.coverage.outcomesWithCandidates} outcomes have a candidate · {report.coverage.familiesCreated} separate families · {report.coverage.yieldPerCell}% of cells produced a candidate</li>
          </ul>
          <h3>By topic</h3>
          <div className="rv-table">
            {report.perTopic.map(t => <div key={t.id} className="rv-row" style={{ gridTemplateColumns: 'minmax(0,2fr) repeat(3, minmax(0,1fr))' }}><span><strong>{t.topic}</strong></span><span><small>{t.drafted} of {t.planned} drafted</small></span><span><small>{t.failed} failed · {t.open} open</small></span><span><small>{t.outcomesCovered} of {t.outcomesInTopic} outcomes covered</small></span></div>)}
          </div>
          {Object.keys(report.failuresByCode).length > 0 && <>
            <h3>Why cells failed</h3>
            <ul className="rv-list">{Object.entries(report.failuresByCode).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}>{v} × {k}</li>)}</ul>
            <p className="fine-print">By item type: {Object.entries(report.failuresByForm).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
          </>}
          <div className="rv-actions"><Link className="secondary-button" href={`/app/tests/review?batch=${report.batch.id}`}>Open this batch’s items</Link><Link className="secondary-button" href={`/app/tests/review/preview?batch=${report.batch.id}`}>Preview as a paper</Link></div>
        </section>
      )}
    </div>
  )
}
