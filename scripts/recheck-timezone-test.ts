/**
 * Re-check due date and eligibility must be a function of (stored date, the student's zone, an instant) and NOTHING about the server.
 *   Part A (pure, no database): fixed instants, injected clocks, run in child processes whose process TZ is UTC / Asia/Kolkata / Europe/London / America/Los_Angeles;
 *           every child must print the identical answers and they must equal the hand-computed expectations (local midnight, one zone west of UTC, London DST).
 *   Part B (real service, disposable project, registered fixture students): planRepairCheck with an injected clock for Kolkata, London and Los Angeles students:
 *           waiting before the first eligible instant writes no attempt; the due date it states is the student's own calendar date.
 * The SQL side (write/read of the stored date under any session zone) is proved in scripts/repair-loop-db-test.cjs.
 *   npm run recheck:timezone:test -- --confirm-target=<ref>
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

type Case = { name: string; tz: string; planned: string | null; storedDue: string[]; completedAt: string; now: string; expect: { availableDate: string; eligible: boolean } }
const CASES: Case[] = [
  // Kolkata: completed 01:30 IST on 18 Nov (still 17 Nov in UTC and London). +3 days = 21 Nov, available from LOCAL midnight (18:30Z), not from 00:00Z and not 5.5 h later.
  { name: 'Kolkata: one minute before local midnight', tz: 'Asia/Kolkata', planned: null, storedDue: [], completedAt: '2026-11-17T20:00:00Z', now: '2026-11-20T18:29:00Z', expect: { availableDate: '2026-11-21', eligible: false } },
  { name: 'Kolkata: exactly local midnight', tz: 'Asia/Kolkata', planned: null, storedDue: [], completedAt: '2026-11-17T20:00:00Z', now: '2026-11-20T18:30:00Z', expect: { availableDate: '2026-11-21', eligible: true } },
  // London, SAME instants: the student is on the 17th, so the check is available on the 20th.
  { name: 'London: the same completion instant is the 17th, available the 20th (23:59:59Z the day before: no)', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2026-11-17T20:00:00Z', now: '2026-11-19T23:59:59Z', expect: { availableDate: '2026-11-20', eligible: false } },
  { name: 'London: at 00:00 on the 20th: yes', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2026-11-17T20:00:00Z', now: '2026-11-20T00:00:00Z', expect: { availableDate: '2026-11-20', eligible: true } },
  // Los Angeles (one zone west): completed 22:00 PST on the 17th (06:00Z on the 18th). A stored due date of 2026-11-20 is the 20th for the student, not 16:00 on the 19th.
  { name: 'Los Angeles: 23:59 PST on the 19th with a stored due date of the 20th: not yet', tz: 'America/Los_Angeles', planned: null, storedDue: ['2026-11-20T00:00:00+00:00'], completedAt: '2026-11-18T06:00:00Z', now: '2026-11-20T07:59:00Z', expect: { availableDate: '2026-11-20', eligible: false } },
  { name: 'Los Angeles: 00:00 PST on the 20th: yes', tz: 'America/Los_Angeles', planned: null, storedDue: ['2026-11-20T00:00:00+00:00'], completedAt: '2026-11-18T06:00:00Z', now: '2026-11-20T08:00:00Z', expect: { availableDate: '2026-11-20', eligible: true } },
  // A stored value rendered with an offset (as a database session in another zone would) is still the same calendar date.
  { name: 'a stored due date serialised with an offset is the same calendar date', tz: 'Europe/London', planned: null, storedDue: ['2026-11-25T05:30:00+05:30'], completedAt: '2026-11-17T10:00:00Z', now: '2026-11-24T23:59:00Z', expect: { availableDate: '2026-11-25', eligible: false } },
  // London DST starts 2027-03-28 01:00Z. Local midnight of the 30th is 23:00Z on the 29th (BST).
  { name: 'London DST (spring): 22:59Z on the 29th is still the 29th locally', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2027-03-27T23:30:00Z', now: '2027-03-29T22:59:00Z', expect: { availableDate: '2027-03-30', eligible: false } },
  { name: 'London DST (spring): 23:00Z on the 29th is local midnight of the 30th', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2027-03-27T23:30:00Z', now: '2027-03-29T23:00:00Z', expect: { availableDate: '2027-03-30', eligible: true } },
  // London DST ends 2026-10-25 01:00Z: completed 00:30 BST on the 25th (23:30Z on the 24th).
  { name: 'London DST (autumn): the 28th starts at 00:00Z, not 23:00Z the day before', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2026-10-24T23:30:00Z', now: '2026-10-27T23:59:00Z', expect: { availableDate: '2026-10-28', eligible: false } },
  { name: 'London DST (autumn): 00:00Z on the 28th', tz: 'Europe/London', planned: null, storedDue: [], completedAt: '2026-10-24T23:30:00Z', now: '2026-10-28T00:00:00Z', expect: { availableDate: '2026-10-28', eligible: true } },
  // A planned day later than the spacing wins; moving a check earlier never skips the spacing.
  { name: 'the planned day can be later than the spacing and then wins', tz: 'Asia/Kolkata', planned: '2026-11-27', storedDue: [], completedAt: '2026-11-17T20:00:00Z', now: '2026-11-26T18:30:00Z', expect: { availableDate: '2026-11-27', eligible: true } },
]
const TRACKER = [
  // Los Angeles at 17:00 on the 19th: the stored due date is the 20th. The old instant rule (new Date(stored) <= now) said "re-test due" 8 hours early.
  { name: 'tracker, Los Angeles 17:00 on the 19th: not due', tz: 'America/Los_Angeles', now: '2026-11-20T01:00:00Z', stored: '2026-11-21T00:00:00+00:00', expect: 'in_progress', legacy: 'in_progress' },
  { name: 'tracker, Los Angeles: due date 20th, 17:00 on the 19th, the old rule said due', tz: 'America/Los_Angeles', now: '2026-11-20T01:00:00Z', stored: '2026-11-20T00:00:00+00:00', expect: 'in_progress', legacy: 'retest_due' },
  // Kolkata at 00:10 on the 21st with a due date of the 21st: due since local midnight; the old rule said not yet for another 5.5 hours.
  { name: 'tracker, Kolkata 00:10 on the 21st, due date the 21st: due; the old rule said not yet', tz: 'Asia/Kolkata', now: '2026-11-20T18:40:00Z', stored: '2026-11-21T00:00:00+00:00', expect: 'retest_due', legacy: 'in_progress' },
]

async function child() {
  const { recheckEligibility } = await import('../src/lib/repairs/recheckDate')
  const { deriveProgress } = await import('../src/lib/curriculum/losTracker')
  const out = CASES.map(c => ({ name: c.name, ...(({ availableDate, eligible }) => ({ availableDate, eligible }))(recheckEligibility({ planned: c.planned, storedDue: c.storedDue, completedAt: c.completedAt, timezone: c.tz, now: new Date(c.now) })) }))
  const base = { band: 'repair' as const, hasOpenRepair: true, hasScheduledWork: false, workCompleted: true }
  const tr = TRACKER.map(t => ({ name: t.name, got: deriveProgress({ ...base, nextRecheckDueAt: t.stored }, new Date(t.now), t.tz), legacy: new Date(t.stored).getTime() <= new Date(t.now).getTime() ? 'retest_due' : 'in_progress' }))
  console.log(JSON.stringify({ processTz: process.env.TZ, offsetMin: new Date('2026-11-20T12:00:00Z').getTimezoneOffset(),   // proves the zone really applied (the resolved name can be an alias)
     out, tr }))
}

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }

async function partA() {
  console.log('Part A: same instants, same student zone, different SERVER zones')
  const runs = ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/Los_Angeles'].map(tz => {
    const r = spawnSync('npx', ['tsx', 'scripts/recheck-timezone-test.ts', '--child'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`child ${tz} failed: ${r.stderr}`)
    return JSON.parse(r.stdout.trim().split('\n').at(-1)!)
  })
  ok('every child really ran in its own server zone', runs.map(r => r.offsetMin).join() === '0,-330,0,480', runs.map(r => [r.processTz, r.offsetMin]))
  const ref = JSON.stringify(runs[0].out), refT = JSON.stringify(runs[0].tr.map((t: any) => t.got))
  ok('due date and eligibility are IDENTICAL under server TZ UTC, Asia/Kolkata, Europe/London and America/Los_Angeles', runs.every(r => JSON.stringify(r.out) === ref), runs.map(r => r.out.map((o: any) => o.availableDate + (o.eligible ? 'Y' : 'N')).join(' ')))
  ok('the progress shown in Curriculum is identical in every server zone', runs.every(r => JSON.stringify(r.tr.map((t: any) => t.got)) === refT))
  CASES.forEach((c, i) => ok(c.name, runs[0].out[i].availableDate === c.expect.availableDate && runs[0].out[i].eligible === c.expect.eligible, { got: runs[0].out[i], expect: c.expect }))
  TRACKER.forEach((t, i) => {
    ok(t.name, runs[0].tr[i].got === t.expect, runs[0].tr[i])
    ok(`  (documented) the previous instant rule gave "${t.legacy}"`, runs[0].tr[i].legacy === t.legacy, runs[0].tr[i])
  })
}

async function partB() {
  const req = createRequire(import.meta.url), { parse } = req('dotenv'), { configuration } = req('./lib/migrations.cjs')
  const confirm = process.argv.find(a => a.startsWith('--confirm-target='))
  const cfg = configuration(['--env=staging', '--dry-run'], parse(readFileSync('.env.staging.local')))
  if (confirm !== `--confirm-target=${cfg.identity}`) { console.error(`Pass --confirm-target=${cfg.identity}.`); process.exit(1) }
  const { createAdminClient } = await import('../src/lib/supabase/admin')
  const { planRepairCheck, startRepairCheck } = await import('../src/lib/tests/repairCheck')
  const admin = createAdminClient(), tag = Date.now().toString(36), users: string[] = []
  console.log('\nPart B: the real service with an injected clock (registered fixture students)')
  try {
    const manifest = (await admin.from('curriculum_manifests').select('id').eq('is_active', true).single().throwOnError()).data!.id as string
    const concept = (await admin.from('curriculum_concepts').select('id').eq('manifest_id', manifest).limit(1).single().throwOnError()).data!.id as string
    for (const [tz, completedAt, planned, before, at, expected] of [
      ['Asia/Kolkata', '2026-11-17T20:00:00Z', '2026-11-18', '2026-11-20T18:29:00Z', '2026-11-20T18:30:00Z', '2026-11-21'],
      ['Europe/London', '2026-11-17T20:00:00Z', '2026-11-18', '2026-11-19T23:59:00Z', '2026-11-20T00:00:00Z', '2026-11-20'],
      ['America/Los_Angeles', '2026-11-18T06:00:00Z', '2026-11-18', '2026-11-20T07:59:00Z', '2026-11-20T08:00:00Z', '2026-11-20'],
    ] as const) {
      const u = (await admin.auth.admin.createUser({ email: `rctz+${tag}+${tz.split('/')[1].toLowerCase()}@example.com`, email_confirm: true })).data.user!.id; users.push(u)
      await admin.from('profiles').upsert({ id: u, timezone: tz, onboarding_status: 'complete' }).throwOnError()
      const thread = (await admin.from('repair_threads').insert({ user_id: u, concept_id: concept, manifest_id: manifest, status: 'awaiting_recheck', latest_evidence_at: completedAt }).select('id').single().throwOnError()).data!.id as string
      const rep = `rctz-rep-${tag}-${u.slice(0, 6)}`, chk = `rctz-chk-${tag}-${u.slice(0, 6)}`
      await admin.from('plan_blocks').insert([
        { id: rep, user_id: u, day: planned, title: 'Repair', duration: '30', detail: '', task_type: 'repair', execution: 'completed', repair_thread_id: thread, local_date: planned, duration_minutes: 30 },
        { id: chk, user_id: u, day: planned, title: 'Re-check', duration: '15', detail: '', task_type: 'recheck', execution: 'not_started', local_date: planned, duration_minutes: 15 },
      ]).throwOnError()
      await admin.from('task_events').insert({ user_id: u, task_id: rep, event_type: 'completed', created_at: completedAt }).throwOnError()
      await admin.from('repair_check_threads').insert({ check_task_id: chk, thread_id: thread, user_id: u }).throwOnError()
      const attempts = async () => (await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', u)).count ?? 0
      const early = await planRepairCheck(u, chk, new Date(before)), eligible = await planRepairCheck(u, chk, new Date(at))
      ok(`${tz}: one minute before the student's local midnight the check is waiting and names the student's calendar date`, early.state === 'waiting' && /can start from \d{4}-\d{2}-\d{2}/.test((early as any).message), early)
      ok(`${tz}: at the student's local midnight it is no longer waiting (it moves on to the bank)`, eligible.state !== 'waiting' && eligible.state !== 'unavailable', eligible)
      const refused = await startRepairCheck(u, chk, new Date(before))
      ok(`${tz}: Start before eligibility is refused and writes no attempt, task link or paper`, !refused.ok && refused.code === 'waiting' && await attempts() === 0 && (await admin.from('plan_blocks').select('attempt_id').eq('id', chk).single().throwOnError()).data!.attempt_id === null)
      const stated = /can start from (\d{4}-\d{2}-\d{2})/.exec((early as any).message)?.[1]
      ok(`${tz}: the date it states is the student's own calendar date (${stated}, expected ${expected})`, stated === expected, { stated })
      // Simulate a due-date edit AFTER preflight. Even a direct server command must repeat the date check before reserving anything.
      await admin.from('repair_threads').update({ next_recheck_due_at: '2035-01-01T00:00:00Z' }).eq('id', thread).throwOnError()
      const beforeAtomic = await attempts()
      const atomic = await admin.rpc('start_repair_check', { p_user: u, p_check_task_id: chk, p_item_ids: [], p_manifest: manifest,
        p_blueprint: {}, p_constraints: {}, p_requested: {}, p_coverage: {}, p_scope: {}, p_min_questions: 5 })
      ok(`${tz}: the deployed command independently refuses a due date changed after preflight; no reservation`, !atomic.error && atomic.data?.code === 'RECHECK_NOT_DUE'
        && atomic.data.earliestDate === '2035-01-01' && await attempts() === beforeAtomic && (await admin.from('plan_blocks').select('attempt_id').eq('id', chk).single().throwOnError()).data!.attempt_id === null, atomic.data)
    }
  } finally {
    for (const u of users) { await admin.from('repair_check_threads').delete().eq('user_id', u); await admin.from('task_events').delete().eq('user_id', u); await admin.from('plan_blocks').delete().eq('user_id', u); await admin.from('repair_threads').delete().eq('user_id', u); await admin.auth.admin.deleteUser(u).catch(() => {}) }
    console.log(`  cleanup: ${users.length} fixture student(s) removed`)
  }
}

async function main() {
  if (process.argv.includes('--child')) return child()
  await partA()
  await partB()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
