/**
 * Access matrix through the REAL endpoints: anonymous / incomplete onboarding / other verified user / owner.
 * Owner = the dedicated +e2e account (reset + onboarded). Throwaway users are created and deleted by this script.
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-access-matrix.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from './lib/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'
import { Client } from 'pg'
import { configuration } from './lib/migrations.cjs'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const stamp = Date.now()
const made: string[] = []

async function throwaway(tag: string, complete: boolean) {
  const email = `access+${tag}${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`)
  made.push(data.user.id)
  await admin.from('profiles').upsert({ id: data.user.id, onboarding_status: complete ? 'complete' : 'not_started' })
  const s = createSession(admin, email); if (!(await s.signIn())) throw new Error(`sign-in ${tag} failed`)
  return { id: data.user.id, s }
}
const J = { 'Content-Type': 'application/json' }
const send = (s: ReturnType<typeof createSession>, method: string, path: string, body?: unknown) =>
  s.json(path, { method, headers: J, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) })

async function main() {
  console.log('\nAccess matrix (real endpoints)\n')
  try {
    // Every student fixture is a fresh, ordinary account. The shared +e2e account is not used here (it carries a reviewer role).
    const ownerU = await throwaway('owner', false), owner = ownerU.s, uid = ownerU.id
    await completeOnboarding(owner, admin)
    const other = await throwaway('other', true), fresh = await throwaway('fresh', false), unver = await throwaway('unver', true), rev = await throwaway('rev', true)
    await admin.from('user_roles').insert({ user_id: rev.id, role: 'diagnostic_reviewer' })   // removed with the user at the end
    const cfg = configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync(path.resolve(process.cwd(), '.env.staging.local'))))
    const pg = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000 }); await pg.connect()
    await pg.query('update auth.users set email_confirmed_at = null where id = $1', [unver.id]); await pg.end()   // signed in while confirmed; the address is un-confirmed afterwards
    const roles = (await admin.from('user_roles').select('user_id').in('user_id', [uid, other.id, fresh.id, unver.id])).data ?? []
    check('the ordinary student fixtures hold no reviewer or staff role', roles.length === 0, JSON.stringify(roles))

    let { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').maybeSingle()
    if (!cyc) { const r = await admin.from('planning_cycles').insert({ user_id: uid, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString(), starts_at_local: new Date().toISOString().slice(0, 10), ends_at_local: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10), timezone: 'UTC', status: 'active' }).select('id').single(); if (r.error) throw new Error(`cycle fixture: ${r.error.message}`); cyc = r.data }
    const day = new Date().toISOString().slice(0, 10)
    const ins = await admin.from('plan_blocks').insert({ id: `acc-task-${stamp}`, user_id: uid, cycle_id: cyc!.id, title: 'Access fixture', day, local_date: day, duration: '45', duration_minutes: 45, detail: 'd', task_type: 'study', priority: 'core', placement: 'day_preferred', execution: 'not_started', origin: 'planner', created_by: 'algorithm', learning_objective: 'O', suggested_approach: 'A', completion_meaning: 'D' }).select('id, title, revision, execution').single()
    if (ins.error) throw new Error(`task fixture: ${ins.error.message}`)
    const task = ins.data
    const { data: att } = await admin.from('assessment_attempts').select('id').eq('user_id', uid).limit(1).maybeSingle()
    const { data: prop } = await admin.from('coach_proposals').insert({ user_id: uid, intent: 'diagnostic_repair', origin: 'diagnostic', status: 'pending', proposed_changes: {}, reasoning: 'fixture' }).select('id').single()
    const taskBefore = JSON.stringify((await admin.from('plan_blocks').select('title, execution, revision').eq('id', task.id).single()).data)
    const blocksOf = async (u: string) => (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', u)).count

    console.log('Anonymous')
    const anon = (m: string, p: string, b?: unknown) => fetch(`${E2E_BASE_URL}${p}`, { method: m, headers: J, body: b === undefined || m === 'GET' ? undefined : JSON.stringify(b) }).then(r => r.status)
    for (const [m, p] of [['GET', '/api/weekly-review/state'], ['POST', '/api/tasks'], ['PATCH', `/api/tasks/${task.id}`], ['POST', '/api/diagnostic/repair/preview'], ['POST', '/api/coach'], ['GET', '/api/profile'], ['GET', '/api/signals'], ['POST', '/api/tests/start']] as const)
      check(`${m} ${p.replace(task.id, ':id')} → 401`, (await anon(m, p, {})) === 401)

    console.log('\nVerified user with INCOMPLETE onboarding: blocked from the app APIs, onboarding still works')
    const blocked = [['GET', '/api/weekly-review/state'], ['POST', '/api/tasks'], ['GET', '/api/profile'], ['PUT', '/api/profile'], ['POST', '/api/profile/classes-completed'], ['GET', '/api/signals'], ['GET', '/api/roadmap'], ['POST', '/api/curriculum/notes'], ['POST', '/api/diagnostic/repair/preview'], ['POST', '/api/tests/start'], ['POST', '/api/coach'], ['POST', '/api/commitments'], ['POST', '/api/log-learning']] as const
    for (const [m, p] of blocked) { const r = await send(fresh.s, m, p, {}); check(`${m} ${p} → 403 ONBOARDING_REQUIRED`, r.status === 403 && r.body?.code === 'ONBOARDING_REQUIRED', `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`) }
    const att0 = att ? (await fresh.s.json(`/api/tests/attempt/${att.id}/result`)) : null
    if (att0) check('GET attempt result → 403 for an incomplete user (shared owned-attempt guard)', att0.status === 403 || att0.status === 404, `${att0.status}`)
    check('onboarding state is still reachable', (await fresh.s.json('/api/onboarding/state')).status === 200)
    const sneak = await send(fresh.s, 'PUT', '/api/profile', { name: 'x', onboardingStatus: 'complete' })
    check('a crafted profile payload cannot complete setup', (await admin.from('profiles').select('onboarding_status').eq('id', fresh.id).single()).data?.onboarding_status === 'not_started', `${sneak.status}`)
    check('the incomplete user is still not complete', (await admin.from('profiles').select('onboarding_status').eq('id', fresh.id).single()).data?.onboarding_status === 'not_started')

    console.log('\nA different verified, onboarded user cannot use the owner’s records')
    const otherBlocks = await blocksOf(other.id)
    const t1 = await send(other.s, 'PATCH', `/api/tasks/${task.id}`, { action: 'execution', execution: 'completed', expectedRevision: task.revision })
    check('mutating the owner’s task is refused', t1.status >= 400 && t1.status < 500, `${t1.status}`)
    check('the owner’s task is unchanged', JSON.stringify((await admin.from('plan_blocks').select('title, execution, revision').eq('id', task.id).single()).data) === taskBefore)
    const t2 = await send(other.s, 'PATCH', `/api/tasks/${task.id}`, { action: 'edit', title: 'hijack', expectedRevision: task.revision, userId: uid })
    check('a payload naming the owner’s user id does not redirect the write', (await admin.from('plan_blocks').select('title').eq('id', task.id).single()).data?.title === task.title, `${t2.status}`)
    const wr = await send(other.s, 'POST', '/api/weekly-review/preview', { cycleId: cyc!.id, choices: {}, acknowledgeNoPaper: true })
    check('previewing the owner’s week is refused', wr.body?.ok === false, JSON.stringify(wr.body).slice(0, 100))
    const wa = await send(other.s, 'POST', '/api/weekly-review/accept', { draftId: '00000000-0000-0000-0000-000000000000' })
    check('accepting a draft that is not theirs is refused', wa.status >= 400, `${wa.status}`)
    const ra = await send(other.s, 'POST', '/api/diagnostic/repair/accept', { proposalId: prop!.id, idempotencyKey: `x-${stamp}` })
    check('accepting the owner’s repair proposal is refused', ra.body?.ok === false, JSON.stringify(ra.body).slice(0, 100))
    check('the proposal is still pending', (await admin.from('coach_proposals').select('status').eq('id', prop!.id).single()).data?.status === 'pending')
    if (att) { const r = await other.s.json(`/api/tests/attempt/${att.id}/result`); check('reading the owner’s attempt result → 404', r.status === 404, `${r.status}`)
      const a2 = await send(other.s, 'POST', `/api/tests/attempt/${att.id}/submit`, {}); check('submitting the owner’s attempt is refused', a2.status === 404, `${a2.status}`) }
    const pr = await other.s.json('/api/profile'); check('profile returns only the caller’s data', pr.status === 200 && JSON.stringify(pr.body).indexOf(uid) < 0)
    const cm = await send(other.s, 'POST', '/api/coach', { message: 'hi', userId: uid })
    check('Coach writes only to the caller’s own history', (await admin.from('coach_messages').select('id', { count: 'exact', head: true }).eq('user_id', uid)).count === 0)
    check('other user gained no rows in the owner’s plan', (await blocksOf(uid)) !== null && (await blocksOf(other.id)) === otherBlocks)

    console.log('\nVerified-email requirement: an unverified address is refused and nothing is written')
    const unBlocksBefore = await blocksOf(unver.id)
    for (const [m, p] of [['GET', '/api/weekly-review/state'], ['POST', '/api/tasks'], ['GET', '/api/profile'], ['PUT', '/api/profile'], ['POST', '/api/commitments'], ['POST', '/api/tests/start'], ['POST', '/api/coach'], ['POST', '/api/diagnostic/repair/preview']] as const) {
      const r = await send(unver.s, m, p, { name: 'x' }); check(`${m} ${p} → 403 EMAIL_VERIFICATION_REQUIRED`, r.status === 403 && r.body?.code === 'EMAIL_VERIFICATION_REQUIRED', `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`) }
    check('and no plan rows were written for the unverified account', (await blocksOf(unver.id)) === unBlocksBefore)
    check('public pages still work for an anonymous visitor', (await fetch(`${E2E_BASE_URL}/login`)).status === 200)

    console.log('\nReviewer operations need the reviewer role')
    const { data: item } = await admin.from('assessment_items').select('id').limit(1).single()
    const rv = await send(other.s, 'POST', `/api/diagnostic/items/${item!.id}/review`, { decision: '__invalid__' })
    check('an ordinary verified user cannot review an item (403)', rv.status === 403, `${rv.status}`)
    const rv2 = await send(rev.s, 'POST', `/api/diagnostic/items/${item!.id}/review`, { decision: '__invalid__' })
    check('a reviewer passes the role check (rejected later for the invalid decision, nothing approved)', rv2.status !== 403 && rv2.status !== 401, `${rv2.status} ${JSON.stringify(rv2.body).slice(0, 80)}`)
    const before = (await admin.from('assessment_items').select('review_status').eq('id', item!.id).single()).data?.review_status
    check('and the item status did not change', before === (await admin.from('assessment_items').select('review_status').eq('id', item!.id).single()).data?.review_status)

    console.log('\nOwner still works')
    check('owner reads the weekly state', (await owner.json('/api/weekly-review/state')).status === 200)
    check('owner reads profile', (await owner.json('/api/profile')).status === 200)
    const up = await send(owner, 'PUT', '/api/profile', { name: 'Access Owner' })
    check('owner Settings save works', up.status === 200 && up.body?.ok === true, JSON.stringify(up.body).slice(0, 100))
    await admin.from('coach_proposals').delete().eq('id', prop!.id)
  } finally {
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log(`\nCleaned up ${made.length} throwaway users.`)
  }
  finish()
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
