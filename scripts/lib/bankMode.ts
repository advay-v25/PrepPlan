/**
 * Explicit question-bank mode for the scored suites. Pass nothing for the ACTUAL track, or `--bank=<record from scripts/fixture-bank.cjs create>` for a FIXTURE track.
 *   - A supplied record is validated up front (file parses, lists items, those items exist, not held-out unless the suite asks for held-out) or the suite is rejected.
 *   - The track, target and eligibility per reading are printed before anything runs.
 *   - Actual track: genuine insufficient coverage is reported as UNAVAILABLE (exit 0, never counted as passed) so it cannot masquerade as an assertion failure.
 *   - Fixture track: missing coverage is a FAILURE (exit 1): the scenario that should have run could not.
 * The record is owned by whoever created it; a suite never creates or destroys a record it was given. Selection is the server's: this only checks and reports.
 */
import fs from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'

export type BankMode = { track: 'actual' | 'fixture'; file: string | null; routineByReading: Record<string, number> }

const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=')

const BATCH = 100
const fail = (msg: string): never => { console.error(msg); process.exit(1) }

/** Every listed item, read in bounded batches. A read error is a failure (never "fewer items"); a missing id is a failure. */
async function readRecord(admin: SupabaseClient, ids: string[]) {
  const rows: { id: string; lm_id: string; held_out: boolean; review_status: string; family_id: string | null; provenance: string; item_version: number }[] = []
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await admin.from('assessment_items').select('id, lm_id, held_out, review_status, family_id, provenance, item_version').in('id', ids.slice(i, i + BATCH))
    if (error) fail(`FIXTURE SETUP FAILED: could not read the record's items (${error.message}). Nothing was assumed.`)
    rows.push(...(data ?? []) as typeof rows)
  }
  return rows
}

export type BankPool = 'routine' | 'heldout'

/**
 * `pool` says which inventory the suite needs: 'routine' (papers, re-checks) or 'heldout' (rehearsals). A fixture record must supply it:
 * counts come from the RECORD's own items (all of them, reviewed, in that pool), never from the whole database, so unrelated inventory cannot
 * make a wrong-pool, partial or unrelated record look sufficient.
 */
export async function declareBank(admin: SupabaseClient, suite: string, readings: string[], minRoutine = 5, pool: BankPool = 'routine'): Promise<BankMode> {
  const file = arg('bank') || null
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https:\/\/|\.supabase\.co.*$/g, '')
  const target = arg('confirm-target')
  if (target && target !== ref) fail(`--confirm-target=${target} is not this project (${ref}).`)

  if (file) {
    let rec: { items?: unknown[] }
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return fail(`REJECTED: --bank=${file} cannot be read as a fixture record (${(e as Error).message}).`) }
    const ids = [...new Set((rec.items ?? []).map(i => (typeof i === 'string' ? i : (i as { id: string }).id)).filter(Boolean))]
    if (!ids.length) fail(`REJECTED: --bank=${file} lists no items.`)
    const rows = await readRecord(admin, ids)
    const missing = ids.length - rows.length
    if (missing > 0) fail(`FIXTURE SETUP FAILED: ${missing} of ${ids.length} recorded items no longer exist (record stale or already destroyed).`)
    const notFixture = rows.filter(r => r.provenance !== 'fixture-bank').length
    if (notFixture > 0) fail(`REJECTED: ${notFixture} items in the record are not fixture-bank items; the record must be fixture-only.`)
    const notReviewed = rows.filter(r => r.review_status !== 'reviewed').length
    if (notReviewed > 0) fail(`FIXTURE SETUP FAILED: ${notReviewed} recorded items are not in 'reviewed' status, so the server would not serve them.`)
    // Usable means approved for the item's CURRENT version (what the server's eligibility rule requires), not status 'reviewed' alone.
    const approved = new Set<string>()
    for (let i = 0; i < ids.length; i += BATCH) {
      const { data, error } = await admin.from('item_review_decisions').select('item_id, item_version').eq('decision', 'approve').in('item_id', ids.slice(i, i + BATCH))
      if (error) fail(`FIXTURE SETUP FAILED: could not read approval decisions (${error.message}).`)
      for (const d of data ?? []) approved.add(`${d.item_id}:${d.item_version}`)
    }
    const unapproved = rows.filter(r => !approved.has(`${r.id}:${r.item_version}`)).length
    if (unapproved > 0) fail(`FIXTURE SETUP FAILED: ${unapproved} recorded items have no approval for their current version, so the server would not serve them.`)
    const held = rows.filter(r => r.held_out), routine = rows.filter(r => !r.held_out)
    const wanted = pool === 'routine' ? routine : held
    const byReading: Record<string, number> = {}
    for (const r of readings) byReading[r] = wanted.filter(x => x.lm_id === r).length
    console.log(`[${suite}] Track: FIXTURE (${pool} pool). Target ${ref}. Record ${file}: ${ids.length} items, all present, all reviewed: ${routine.length} routine, ${held.length} held-out, ${new Set(rows.map(r => r.family_id).filter(Boolean)).size} families.`)
    if (pool === 'routine') {
      console.log(`[${suite}] Record's routine items per required reading: ${JSON.stringify(byReading)}`)
      if (routine.length === 0) fail(`[${suite}] FAILED: this suite needs a ROUTINE record, but "${file}" holds only held-out items (wrong pool).`)
      const short = readings.filter(r => byReading[r] < minRoutine)
      if (short.length) fail(`[${suite}] FAILED: the record has fewer than ${minRoutine} routine items for ${short.join(', ')}. Create one with --readings=${readings.join(',')}.`)
    } else {
      if (held.length === 0) fail(`[${suite}] FAILED: this suite needs a HELD-OUT record, but "${file}" holds only routine items (wrong pool).`)
      console.log(`[${suite}] Held-out families in the record: ${new Set(held.map(h => h.family_id).filter(Boolean)).size}`)
    }
    return { track: 'fixture', file, routineByReading: byReading }
  }

  // Actual track: the real bank only. Fixture-bank items are excluded so a leftover fixture cannot make the actual bank look stocked.
  const routineByReading: Record<string, number> = {}
  // Count what the SERVER can actually serve: reviewed AND approved for the item's CURRENT version (the student_eligible_items view is routine-only; held-out is
  // checked against the same approval rule). Every read is paginated (PostgREST caps a page at 1000 rows), and a failed page is a setup failure, never "fewer items".
  const page = async <T,>(label: string, read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await read(from, from + 999)
      if (error) return fail(`[${suite}] SETUP FAILED: could not read ${label} (${error.message}).`)
      out.push(...(data ?? [])); if ((data ?? []).length < 1000) return out
    }
  }
  type Row = { id: string; lm_id: string; held_out: boolean; provenance: string; item_version?: number }
  const rows: Row[] = pool === 'routine'
    ? await page<Row>('eligible inventory', (f, t) => admin.from('student_eligible_items').select('id, lm_id, held_out, provenance').order('id').range(f, t))
    : await page<Row>('held-out inventory', (f, t) => admin.from('assessment_items').select('id, lm_id, held_out, provenance, item_version').eq('review_status', 'reviewed').eq('held_out', true).order('id').range(f, t))
  const approved = new Set<string>()
  if (pool === 'heldout') for (const d of await page<{ item_id: string; item_version: number }>('approval decisions', (f, t) => admin.from('item_review_decisions').select('item_id, item_version').eq('decision', 'approve').order('item_id').order('item_version').range(f, t))) approved.add(`${d.item_id}:${d.item_version}`)
  const byId = new Map(rows.filter(r => pool === 'routine' || approved.has(`${r.id}:${r.item_version}`)).map(r => [r.id, r]))
  for (const r of readings) routineByReading[r] = [...byId.values()].filter(x => x.lm_id === r && x.held_out === (pool === 'heldout') && x.provenance !== 'fixture-bank').length
  console.log(`[${suite}] Track: ACTUAL bank (${pool} pool, fixtures excluded). Target ${ref}. Eligible-by-status items per reading: ${JSON.stringify(routineByReading)}`)
  const short = readings.filter(r => routineByReading[r] < minRoutine)
  if (short.length) {
    console.log(`[${suite}] UNAVAILABLE (actual bank): ${short.join(', ')} have fewer than ${minRoutine} ${pool} items, so scored paths cannot run. This is missing inventory, not a pass. Run the fixture track with --bank=<${pool} record>.`)
    process.exit(0)
  }
  return { track: 'actual', file: null, routineByReading }
}
