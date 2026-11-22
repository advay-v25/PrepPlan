/**
 * Exact Coach objects, over HTTP, with ordinary throwaway students (deleted by recorded id).
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/coach-selection-test.ts
 * Proposals are inserted with the receipt shape accept_repair_proposal writes (accept_receipt.taskIds), so the card must read that receipt.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { createStudent, makeCheck } from './lib/e2eSession'
const nodeRequire = createRequire(`${process.cwd()}/package.json`)

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const today = new Date().toISOString().slice(0, 10)
const made: string[] = []
const strip = (h: string) => h.replace(/<!-- -->/g, '')
const text = (h: string) => strip(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

async function main() {
  console.log('\nCoach selection: exact proposals (fixture)\n')
  try {
    const a = await createStudent(admin, 'csa', { onboard: true }); made.push(a.id)
    const b = await createStudent(admin, 'csb', { onboard: true }); made.push(b.id)
    const cyc = (await admin.from('planning_cycles').select('id').eq('user_id', a.id).eq('status', 'active').single()).data!.id as string
    const blk = (id: string, title: string, o: any = {}) => ({ id, user_id: a.id, cycle_id: cyc, title, detail: 'd', task_type: 'repair', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o })
    const taskIds = ['cs-a1', 'cs-a2', 'cs-succ', 'cs-b1']
    // A continuation can only be created by the weekly-review command (a forged link is stripped), so this fixture opens the command's own setting.
    const nextCycle = (await admin.from('planning_cycles').insert({ user_id: a.id, starts_at_local: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10), ends_at_local: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), timezone: 'UTC', status: 'closed', starts_at: new Date(Date.now() + 8 * 86400000).toISOString(), ends_at: new Date(Date.now() + 14 * 86400000).toISOString() }).select('id').single()).data!.id as string
    const ins = await admin.from('plan_blocks').insert([blk('cs-a1', 'Repair task A1'), blk('cs-a2', 'Repair task A2'), blk('cs-b1', 'Repair task B1')])
    if (ins.error) throw new Error('task fixture failed: ' + ins.error.message)
    {
      const { Client } = nodeRequire('pg'); const { parse } = nodeRequire('dotenv'); const { configuration } = nodeRequire('./scripts/lib/migrations.cjs')
      const cfg = configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync('.env.staging.local'))); const pg = new Client({ ...cfg.connection }); await pg.connect()
      try {
        await pg.query('begin'); await pg.query("select set_config('roadmap.continuation_command','on',true)")
        await pg.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,continued_from_task_id,carry_intent)
          values ('cs-succ',$1,$2,'Continued A2','d','repair','planner','core','day_preferred','not_started',$3::date,$3::text,30,'30','algorithm','cs-a2','continue')`, [a.id, nextCycle, new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)])
        await pg.query('commit')
      } finally { await pg.end() }
    }
    const prop = async (title: string, status: string, o: any = {}) => (await admin.from('coach_proposals').insert({ user_id: a.id, intent: 'repair', proposed_changes: {}, reasoning: 'Because of a weak area', status, origin: 'diagnostic', kind: 'repair', title, ...o }).select('id').single()).data!.id as string
    const p1 = await prop('Repair: Diluted EPS', 'executed', { accept_receipt: { ok: true, taskIds: ['cs-a1', 'cs-a2', 'cs-gone'] } })
    const p2 = await prop('Repair: Diluted EPS', 'executed', { accept_receipt: { ok: true, taskIds: ['cs-b1'] } })
    const p3 = await prop('Repair: nothing', 'executed', { accept_receipt: { ok: true, taskIds: [] } })
    const p4 = await prop('Repair: old', 'pending', { expires_at: new Date(Date.now() - 86400000).toISOString(), accept_receipt: { taskIds: ['cs-a1'] } })
    const p5 = await prop('Repair: dismissed', 'rejected'), p6 = await prop('Repair: stale', 'stale'), p7 = await prop('Repair: pending', 'pending')
    const view = async (st: typeof a, id: string) => strip(await (await st.s.req(`/app/coach?proposal=${id}`)).text())
    const link = (id: string) => `task=${id}`
    const counts = async () => JSON.stringify([(await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', a.id)).count, (await admin.from('coach_proposals').select('status').eq('user_id', a.id).order('id')).data])
    const before = await counts()

    let h = await view(a, p1)
    check('an executed proposal links exactly the tasks in ITS receipt', h.includes(link('cs-a1')) && h.includes(link('cs-a2')) && !h.includes(link('cs-b1')))
    if (process.env.DEBUG_CS) console.log(text(h).slice(0, 900))
    check('a continued task keeps its record and shows its continuation', h.includes(link('cs-succ')) && /continued as/.test(text(h)) && /Continued A2/.test(text(h)))
    check('a task that no longer exists is said to be unavailable, not linked', /no longer available/.test(text(h)) && !h.includes(link('cs-gone')))
    h = await view(a, p2)
    check('a second proposal with the same title shows only its own task', h.includes(link('cs-b1')) && !h.includes(link('cs-a1')) && !h.includes(link('cs-a2')))
    check('an executed proposal that added nothing says so', /added no tasks/.test(text(await view(a, p3))))
    h = await view(a, p4)
    check('an expired proposal says so, offers no Confirm and links no task even though a receipt-shaped value exists', /expired/i.test(text(h)) && !/>Confirm</.test(h) && !h.includes(link('cs-a1')))
    check('dismissed, stale and pending are distinguishable', /dismissed/i.test(text(await view(a, p5))) && /plan changed/i.test(text(await view(a, p6))) && />Confirm</.test(await view(a, p7)))
    const foreign = await view(b, p1)
    check('another student sees only "not available": no title, task or link', /not available/.test(text(foreign)) && !/Diluted EPS|Repair task/.test(text(foreign)) && !foreign.includes(link('cs-a1')))
    check('a missing id is the same "not available"', /not available/.test(text(await view(a, '00000000-0000-4000-8000-000000000000'))))
    const rd = (await admin.from('curriculum_readings').select('id, reading_no').eq('is_active', true).order('sequence').limit(1).single()).data!
    const readPage = text((await a.s.req(`/app/coach?reading=${rd.id}`).then(r => r.text())))
    check('a selected reading shows its card, and says notes are not evidence', /Reading you are asking about/.test(readPage) && /not test evidence/.test(readPage))
    check('an unknown reading is "not available", not a fallback to another one', /not available/.test(text(await a.s.req('/app/coach?reading=no-such-reading').then(r => r.text()))))
    check('opening any of them changed nothing (no task, no status)', (await counts()) === before)
    await admin.from('plan_blocks').delete().in('id', ['cs-a1', 'cs-b1']).eq('user_id', a.id)
    h = await view(a, p1)
    check('after those tasks are deleted the card tells the truth instead of linking', !h.includes(link('cs-a1')) && (text(h).match(/no longer available/g) ?? []).length >= 2)
  } finally {
    for (const id of made.splice(0)) await admin.auth.admin.deleteUser(id)
  }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
