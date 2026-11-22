/**
 * Capacity through the CANONICAL readers (getCapacityReport, loadEligibleItemPool, paper_item_defects) on a registered, synthetic fixture bank in
 * the disposable development project. The real bank is never touched; fixtures are removed by recorded id. Nothing here is real inventory.
 *   npm run capacity:fixture:test -- --confirm-target=<ref>
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
const req = createRequire(import.meta.url)
const { Client } = req('pg'), { parse } = req('dotenv'), { configuration } = req('./lib/migrations.cjs')
import { getCapacityReport } from '../src/lib/tests/capacityReport'
import { loadEligibleItemPool, countFreshByReading } from '../src/lib/tests/itemPool'
import { createAdminClient } from '../src/lib/supabase/admin'
import { MIN_FAMILIES_PER_OUTCOME } from '../src/lib/tests/capacityReport'

const readFixtureCapacity = () => getCapacityReport({ includeFixtures: true })
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const confirm = process.argv.find(a => a.startsWith('--confirm-target='))
const cfg = configuration(['--env=staging', '--dry-run'], parse(readFileSync('.env.staging.local')))
if (confirm !== `--confirm-target=${cfg.identity}`) { console.error(`Pass --confirm-target=${cfg.identity}.`); process.exit(1) }

async function main() {
  const db = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true }); await db.connect()
  const q = async (s: string, p?: unknown[]) => (await db.query(s, p)).rows
  const dir = mkdtempSync(join(tmpdir(), 'capfx-')), files: string[] = [], tag = Date.now().toString(36)
  const created = { students: [] as string[], bulk: false, tagBulk: `fxcap-${tag}` }
  const admin = createAdminClient()
  const fx = (args: string[]) => execFileSync('node', ['scripts/fixture-bank.cjs', ...args, confirm!], { encoding: 'utf8', timeout: 280_000 })
  const asReviewer = async (rev: string, sql: string, p: unknown[]) => {
    await db.query('BEGIN'); await db.query('SET LOCAL ROLE authenticated')
    await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [rev, JSON.stringify({ sub: rev, role: 'authenticated' })])
    try { const r = await db.query(sql, p); await db.query('COMMIT'); return Object.values(r.rows[0] ?? {})[0] as any } catch (e) { await db.query('ROLLBACK'); throw e }
  }
  try {
    // two readings with NO items at all, so every count below is attributable to the fixtures alone
    const empty = await q(`select r.id, (select count(*) from public.reading_los l where l.reading_id=r.id)::int outcomes from public.curriculum_readings r where r.is_active and not exists (select 1 from public.assessment_items i where i.lm_id=r.id) order by outcomes desc, r.id`)
    const rA = empty.find((r: any) => r.outcomes >= 2)?.id as string, rB = empty.find((r: any) => r.id !== rA && r.outcomes >= 1)?.id as string
    if (!rA || !rB) throw new Error('need two readings with no items in the disposable project')
    const losA: string[] = (await q('select id from public.reading_los where reading_id=$1 order by id', [rA])).map((r: any) => r.id)
    const baseline = await readFixtureCapacity()
    const row = (rep: typeof baseline, id: string) => rep.readings.find(r => r.id === id)!
    const out = (rep: typeof baseline, id: string) => rep.outcomes.find(o => o.id === id)!
    ok('baseline: the two readings are empty before the fixtures', row(baseline, rA).raw + row(baseline, rA).approvedRoutine === 0 && row(baseline, rB).raw + row(baseline, rB).approvedRoutine === 0)

    console.log('\nA deep reading and a shallow one (each outcome: 3 independent families, one with a reworded variant inside its family)')
    const fa = join(dir, 'a.json'), fb = join(dir, 'b.json'); files.push(fa, fb)
    fx(['create', `--out=${fa}`, `--readings=${rA}`, '--per-outcome=3', '--variants=1'])
    fx(['create', `--out=${fb}`, `--readings=${rB}`, '--per-outcome=1', '--variants=0'])
    const recA = JSON.parse(readFileSync(fa, 'utf8')), rev: string = recA.users[0]
    let rep = await readFixtureCapacity()
    const nO = losA.length
    ok('approved routine items are counted per reading, separately from raw candidates', row(rep, rA).approvedRoutine === nO * 4 && row(rep, rA).raw === 0, row(rep, rA))
    ok('a reworded variant inside a family adds an item but NOT a family (3 families, 4 items per outcome)', losA.every(o => out(rep, o).approvedRoutine === 4 && out(rep, o).familiesRoutine === 3), losA.map(o => [out(rep, o).approvedRoutine, out(rep, o).familiesRoutine]))
    ok('three families meet the per-outcome minimum', losA.every(o => out(rep, o).familiesRoutine >= MIN_FAMILIES_PER_OUTCOME) && !rep.outcomesBelowDepth.some(b => losA.includes(b.outcomeId)))
    ok('the deep reading can supply a paper; the one-family reading is below depth outcome by outcome', row(rep, rA).servable === true && row(rep, rB).outcomesBelowDepth === row(rep, rB).outcomes && row(rep, rB).outcomes >= 1, [row(rep, rA), row(rep, rB)])
    ok('fixture approvals are not quarantined and not counted as candidates', row(rep, rA).quarantined === 0)
    ok('the concept summary agrees: a concept is re-check-ready only with enough independent families', rep.concepts.filter(c => c.readingId === rA).every(c => c.recheckReady === (c.familiesRoutine >= 4)) && rep.concepts.filter(c => c.readingId === rB).every(c => !c.recheckReady))

    console.log('\nSkew cannot hide a hollow outcome')
    const hollow = losA[0]
    const hollowItems: string[] = (await q('select id from public.assessment_items where outcome_id=$1 and id like $2', [hollow, 'fxb-%'])).map((r: any) => r.id)
    for (const id of hollowItems) await asReviewer(rev, 'select public.decide_item_review($1,1,$2,$3,false)', [id, 'retire', 'fixture: hollow this outcome'])
    rep = await readFixtureCapacity()
    ok('with one outcome retired the reading still has plenty of items…', row(rep, rA).approvedRoutine === (nO - 1) * 4 && row(rep, rA).servable === true, row(rep, rA))
    ok('…but that outcome reports ZERO families and is listed below depth (aggregate depth does not stand in for it)', out(rep, hollow).familiesRoutine === 0 && rep.outcomesBelowDepth.some(b => b.outcomeId === hollow && b.families === 0))
    ok('retired items are counted as retired, not as approved or raw', out(rep, hollow).rejectedOrRetired === hollowItems.length && out(rep, hollow).approvedRoutine === 0 && out(rep, hollow).raw === 0)

    console.log('\nHeld-out isolation and families')
    const heldOut = losA[1], famRows = await q("select family_id from public.assessment_items where outcome_id=$1 and id like 'fxb-%' group by family_id order by count(*) desc limit 1", [heldOut])
    const beforeHeld = out(rep, heldOut)
    await asReviewer(rev, 'select public.set_item_holdout($1,null,true,$2)', [famRows[0].family_id, 'fixture: held out for rehearsal'])
    rep = await readFixtureCapacity(); const afterHeld = out(rep, heldOut)
    const famMembers = Number((await q("select count(*) from public.assessment_items where family_id=$1", [famRows[0].family_id]))[0].count)
    ok('holding out a family moves ALL its members out of routine and into held-out', afterHeld.approvedRoutine === beforeHeld.approvedRoutine - famMembers && afterHeld.approvedHeldOut === famMembers, [beforeHeld, afterHeld, famMembers])
    ok('families are counted on the right side: routine −1, held-out +1', afterHeld.familiesRoutine === beforeHeld.familiesRoutine - 1 && afterHeld.familiesHeldOut === 1)
    const stu = await admin.auth.admin.createUser({ email: `capfx+${tag}@example.com`, email_confirm: true }); const uid = stu.data.user!.id; created.students.push(uid)
    delete process.env.ROADMAP_FIXTURE_BANK
    const actual = await getCapacityReport()
    ok('default capacity ignores every synthetic item and concept', row(actual, rA).approvedRoutine === 0 && row(actual, rA).approvedHeldOut === 0
      && !actual.concepts.some(c => c.name.startsWith('Fixture ')))
    const [routineControl, heldOutControl] = await Promise.all([
      loadEligibleItemPool(uid, [rA]), loadEligibleItemPool(uid, [rA], undefined, 'heldout'),
    ])
    ok('a default app cannot select synthetic routine or held-out items', routineControl.length === 0 && heldOutControl.length === 0)
    process.env.ROADMAP_FIXTURE_BANK = '1'
    const poolIds = new Set((await loadEligibleItemPool(uid, [rA])).map(i => i.id))
    ok('a routine paper pool never contains a held-out item', !(await q('select id from public.assessment_items where family_id=$1', [famRows[0].family_id])).some((r: any) => poolIds.has(r.id)))
    const held = new Set((await loadEligibleItemPool(uid, [rA], undefined, 'heldout')).map(i => i.id))
    ok('the held-out pool contains exactly the held-out family and nothing routine', held.size === famMembers && [...held].every(id => !poolIds.has(id)), [...held])

    console.log('\nFresh versus exposed students (user-specific, labelled)')
    const freshNow = (await countFreshByReading(uid, [rA])).get(rA)!
    ok('a new student can see every routine item (none seen yet)', freshNow === row(rep, rA).approvedRoutine, { freshNow, approved: row(rep, rA).approvedRoutine })
    const s2 = (await admin.auth.admin.createUser({ email: `capfx2+${tag}@example.com`, email_confirm: true })).data.user!.id; created.students.push(s2)
    const sample = (await q("select id, family_id from public.assessment_items where outcome_id=$1 and id like 'fxb-%' and held_out=false order by id", [losA[2]])) as { id: string; family_id: string }[]
    const dupFam = sample.filter(s => sample.filter(t => t.family_id === s.family_id).length > 1)   // a family with a reworded variant
    const first = dupFam[0] ?? sample[0], famSize = sample.filter(s => s.family_id === first.family_id).length
    const bp = (await q("insert into public.assessment_blueprints (manifest_id,purpose,requested_scope,constraints) values ((select id from public.curriculum_manifests where is_active limit 1),'weekly_cumulative','{}','{}') returning id"))[0].id
    const form = (await q("insert into public.assessment_forms (blueprint_id,delivery_mode) values ($1,'fixed') returning id", [bp]))[0].id
    await q('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, first.id])
    const att = (await q("insert into public.assessment_attempts (user_id,form_id,delivery_mode,status,attempt_kind) values ($1,$2,'fixed','ready','weekly') returning id", [s2, form]))[0].id
    ok('a RESERVED paper (not yet opened) does not consume fresh questions', (await countFreshByReading(s2, [rA])).get(rA) === freshNow)
    await q("update public.assessment_attempts set status='in_progress' where id=$1", [att])
    const exposed = (await countFreshByReading(s2, [rA])).get(rA)!
    ok('an OPENED paper, even unanswered, removes the shown question AND every other question in its family', exposed === freshNow - famSize, { freshNow, exposed, famSize })
    ok('the other student is unaffected by it', (await countFreshByReading(uid, [rA])).get(rA) === freshNow)

    console.log('\nEligibility changes after a preview')
    const target = sample.find(s => s.id !== first.id && s.family_id !== first.family_id)!
    const previewIds = (await loadEligibleItemPool(uid, [rA])).map(i => i.id)
    ok('the previewed item is eligible', previewIds.includes(target.id))
    await asReviewer(rev, 'select public.decide_item_review($1,1,$2,$3,false)', [target.id, 'retire', 'fixture: retired after the preview'])
    const defects = (await admin.rpc('paper_item_defects', { p_user: uid, p_item_ids: [target.id] })).data as { itemId: string; code: string }[]
    ok('the reservation guard refuses the item retired after the preview', defects.some(d => d.itemId === target.id), defects)
    ok('and the pool no longer offers it', !(await loadEligibleItemPool(uid, [rA])).some(i => i.id === target.id))
    const editTarget = sample.find(s => s.id !== first.id && s.id !== target.id && s.family_id !== first.family_id && s.family_id !== target.family_id)!
    const before = out(await readFixtureCapacity(), losA[2])
    await asReviewer(rev, 'select public.edit_item($1,1,$2::jsonb,$3)', [editTarget.id, JSON.stringify({ stem: 'Fixture material edit: a different stem that is long enough to count as a rewrite of the question.' }), 'fixture edit'])
    const after = out(await readFixtureCapacity(), losA[2])
    ok('a material edit creates a CANDIDATE successor that is not counted as approved; the approved version stays live until the new one is approved', after.approvedRoutine === before.approvedRoutine && after.raw === before.raw + 1 && after.quarantined === before.quarantined + 1, [before, after])

    console.log('\nSign-off withdrawal or scope edit: the CURRENT policy, stated and proved (owner decision still to confirm)')
    // Policy: withdrawing a sign-off (or editing a signed-off scope) blocks NEW approvals and is audited with the live-item count; item versions ALREADY approved
    // stay eligible for new papers until a reviewer retires them explicitly; frozen papers, answers and evidence are never rewritten.
    const cW = (await q('select concept_id from public.assessment_items where id=$1', [first.id]))[0].concept_id as string
    const liveOf = async (c: string) => (await q("select id from public.assessment_items where concept_id=$1 and review_status='reviewed' and held_out=false order by id", [c])).map((r: any) => r.id as string)
    const liveBefore = await liveOf(cW), formItemsBefore = Number((await q('select count(*) from public.form_items where form_id=$1', [form]))[0].count)
    const poolHas = async (c: string) => (await loadEligibleItemPool(uid, [rA])).filter(i => i.concept_id === c).length
    const eligBefore = await poolHas(cW), capBefore = out(await readFixtureCapacity(), losA[2]).approvedRoutine
    ok('before: the concept is signed off and its approved items are eligible', (await q('select verification_status from public.curriculum_concepts where id=$1', [cW]))[0].verification_status === 'verified' && eligBefore > 0 && liveBefore.length > 0)
    const hW = (await q('select public.concept_scope_hash(name, scope_notes, excluded_or_superseded, manifest_id) h from public.curriculum_concepts where id=$1', [cW]))[0].h
    const w = await asReviewer(rev, 'select public.decide_concept_signoff($1,$2,$3,$4,$5)', [cW, 'withdraw', hW, 'fixture: policy proof of withdrawal', `wd-${tag}-12345`])
    ok('the withdrawal is recorded and REPORTS how many approved items stay live (it does not claim they are blocked)', w?.ok === true && w.approvedItemsStillLive === liveBefore.length && /still/i.test(JSON.stringify(Object.keys(w).join(' ')) + 'still'), w)
    ok('future eligibility is unchanged: the approved items are still served to new papers and still counted', await poolHas(cW) === eligBefore && out(await readFixtureCapacity(), losA[2]).approvedRoutine === capBefore)
    const succ = (await q("select id, item_version v from public.assessment_items where concept_id=$1 and review_status in ('draft','automatically_checked') order by id limit 1", [cW]))[0] as { id: string; v: number } | undefined
    if (succ) { const bl = (await q('select public.item_publish_blockers($1, false) b', [succ.id]))[0].b; ok('but NO new approval is possible for that concept until it is signed off again (the publish gate names it)', /signed off/.test(JSON.stringify(bl)), bl) }
    ok('history is untouched: the frozen paper still holds its question and the opened attempt is unchanged', Number((await q('select count(*) from public.form_items where form_id=$1', [form]))[0].count) === formItemsBefore && (await q('select status from public.assessment_attempts where id=$1', [att]))[0].status === 'in_progress')
    const ret: any[] = []; for (const id of await liveOf(cW)) ret.push(await asReviewer(rev, 'select public.decide_item_review($1,$2,$3,$4,false)', [id, (await q('select item_version v from public.assessment_items where id=$1', [id]))[0].v, 'retire', 'fixture: explicit retirement after withdrawal']))
    ok('explicit retirement is what stops delivery: the pool and the counts drop, the frozen paper and its evidence stay', ret.every(r => r?.ok !== false) && await poolHas(cW) === 0 && out(await readFixtureCapacity(), losA[2]).approvedRoutine < capBefore && Number((await q('select count(*) from public.form_items where form_id=$1', [form]))[0].count) === formItemsBefore)
    // the same policy for an EDIT of a signed-off scope: revoked by the system, audited with the count, nothing already approved is withdrawn
    const cE = (await q("select concept_id from public.assessment_items where outcome_id=$1 and review_status='reviewed' and held_out=false and concept_id <> $2 limit 1", [losA[1], cW]))[0]?.concept_id as string | undefined
    if (cE) {
      const liveE = Number((await q("select count(*) from public.assessment_items where concept_id=$1 and review_status='reviewed'", [cE]))[0].count)   // the audit counts every approved version, held-out included
      const elig = await poolHas(cE)
      await q("update public.curriculum_concepts set scope_notes = coalesce(scope_notes,'') || ' (revised)' where id=$1", [cE])
      const rv = (await q("select decision, reviewer_id, approved_items_affected from public.concept_signoffs where concept_id=$1 and decision='revoked_by_edit'", [cE]))[0]
      ok('editing a signed-off scope revokes it (system actor, with the live count) and withdraws nothing already approved', (await q('select verification_status from public.curriculum_concepts where id=$1', [cE]))[0].verification_status === 'drafted' && rv?.reviewer_id === null && rv.approved_items_affected === liveE && await poolHas(cE) === elig && elig > 0, { rv, liveE, elig })
    }

    console.log('\nMore than 1,000 rows through the real aggregation')
    const t0 = Date.now(), c0 = out(await readFixtureCapacity(), losA[2])
    await q(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, outcome_id, key_index, item_card, item_version, cognition, item_form, intended_difficulty)
      select $1 || '-' || g, $2, 'fx','fx',1, 'Fixture bulk candidate ' || g || ' of a deliberately large raw pile: no approval, no family.', '["a","b","c"]'::jsonb, '{}'::jsonb, 'fixture-bank', 'draft', $3, 0, '{}'::jsonb, 1, 'recall','direct','standard' from generate_series(1,1200) g`, [created.tagBulk, rA, losA[2]]); created.bulk = true
    const t1 = Date.now(); const big = await readFixtureCapacity(), c1 = out(big, losA[2])
    ok('1,200 more raw candidates (three or more pages) are all counted…', c1.raw === c0.raw + 1200, [c0.raw, c1.raw])
    ok('…as raw and quarantined only: approved items, families and servability are unchanged by volume', c1.approvedRoutine === c0.approvedRoutine && c1.familiesRoutine === c0.familiesRoutine && c1.quarantined === c0.quarantined + 1200 && out(big, losA[2]).autoPass === c0.autoPass)
    console.log(`  (aggregation over ${big.total.raw + big.total.approvedRoutine + big.total.approvedHeldOut}+ rows took ${((Date.now() - t1) / 1000).toFixed(1)} s; baseline ${((t1 - t0) / 1000).toFixed(1)} s)`)

    console.log('\nA failed read is unavailable, never zero')
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
    let e1 = '', e2 = ''
    try { await readFixtureCapacity() } catch (e: any) { e1 = e.message }
    try { await countFreshByReading(uid, [rA]) } catch (e: any) { e2 = e.message }
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved
    ok('the capacity report throws instead of reporting an empty bank', e1.length > 0 && !/zero/.test(e1), e1)
    ok('the per-student fresh count throws instead of returning 0', e2.length > 0, e2)
  } finally {
    await db.query("delete from public.assessment_items where id like $1", [`${created.tagBulk}-%`]).catch(() => {})
    for (const f of files.filter(f => existsSync(f))) { try { fx(['destroy', `--file=${f}`]) } catch (e: any) { console.error('destroy failed for', f, e.message) } }
    for (const u of created.students) await createAdminClient().auth.admin.deleteUser(u).catch(() => {})
    await db.end().catch(() => {})
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
