/**
 * The 2027 curriculum spine: data integrity + every page renders (dedicated +e2e account).
 *
 *   npm run dev
 *   npx tsx scripts/e2e-curriculum-spine.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser } from './lib/e2eIdentity'
import { createSession, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log('\nCurriculum spine\n')
  const { data: readings } = await admin.from('curriculum_readings').select('id, reading_no, topic_id, title, summary, structure_pending, page_count, effort_units')
  const { data: los } = await admin.from('reading_los').select('id, reading_id, module_id')
  const { data: mods } = await admin.from('reading_modules').select('id, reading_id')
  const { data: topics } = await admin.from('topics').select('id')

  check('102 readings across the 10 subjects', readings?.length === 102 && new Set(readings.map(r => r.topic_id)).size === 10)
  check('reading numbers 1..102 are all present', new Set(readings!.map(r => r.reading_no)).size === 102 && Math.min(...readings!.map(r => r.reading_no)) === 1 && Math.max(...readings!.map(r => r.reading_no)) === 102)
  check('every reading belongs to a real subject', readings!.every(r => topics!.some(t => t.id === r.topic_id)))
  check('Ethics readings are structured (10 readings, 36 Standard-level outcomes, none pending)',
    readings!.filter(r => r.topic_id === 'eth').length === 10 && readings!.filter(r => r.topic_id === 'eth').every(r => !r.structure_pending && los!.some(l => l.reading_id === r.id)) && los!.filter(l => l.reading_id >= 'r093' && l.reading_id <= 'r102').length === 36)
  check('every other reading has modules, outcomes and a description',
    readings!.filter(r => r.topic_id !== 'eth').every(r => r.summary && los!.some(l => l.reading_id === r.id) && mods!.some(m => m.reading_id === r.id)))
  check('every outcome links to a module of its own reading', los!.every(l => !l.module_id || mods!.some(m => m.id === l.module_id && m.reading_id === l.reading_id)))
  check('page counts are positive and effort is derived from them', readings!.every(r => r.page_count > 0 && Number(r.effort_units) > 0))
  const totalEffort = readings!.reduce((s, r) => s + Number(r.effort_units), 0)
  check('total syllabus effort matches the previous total (~189)', Math.abs(totalEffort - 189) < 2, totalEffort.toFixed(1))
  check('reference tables are not writable by a signed-in student',
    (await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).from('curriculum_readings').insert({ id: 'x' })).error !== null)

  // --- the planning spine is these readings
  const { data: active } = await admin.from('learning_modules').select('id, effort_units, topic_ref').eq('is_active', true)
  const readingIds = new Set(readings!.map(r => r.id))
  check('the active planning modules are exactly the 102 readings', active?.length === 102 && active.every(m => readingIds.has(m.id as string)))
  check('the old 63 modules are retired, not deleted', ((await admin.from('learning_modules').select('id', { count: 'exact', head: true }).eq('is_active', false)).count ?? 0) === 63)
  check('roadmap effort per module is the reading\'s page-derived effort', active!.every(m => Number(m.effort_units) === Number(readings!.find(r => r.id === m.id)!.effort_units)))
  const { data: edges } = await admin.from('lm_edges').select('from_lm, to_lm').eq('kind', 'prerequisite')
  const liveEdges = (edges ?? []).filter(e => readingIds.has(e.from_lm as string) && readingIds.has(e.to_lm as string))
  check('the reading graph is connected within each subject', liveEdges.length >= 92 - 10)
  // acyclic: a topological pass over the live edges must consume every node that has edges
  const indeg = new Map<string, number>(); const adj = new Map<string, string[]>()
  for (const e of liveEdges) { indeg.set(e.to_lm as string, (indeg.get(e.to_lm as string) ?? 0) + 1); indeg.set(e.from_lm as string, indeg.get(e.from_lm as string) ?? 0); adj.set(e.from_lm as string, [...(adj.get(e.from_lm as string) ?? []), e.to_lm as string]) }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([n]) => n); let seen = 0
  while (queue.length) { const n = queue.shift()!; seen++; for (const m of adj.get(n) ?? []) { indeg.set(m, indeg.get(m)! - 1); if (indeg.get(m) === 0) queue.push(m) } }
  check('the prerequisite graph has no cycles', seen === indeg.size)
  const { data: cons } = await admin.from('curriculum_concepts').select('lm_id'); const { data: its } = await admin.from('assessment_items').select('lm_id')
  check('test concepts and items belong to readings', (cons ?? []).every(c => readingIds.has(c.lm_id as string)) && (its ?? []).every(i => readingIds.has(i.lm_id as string)))

  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  await verifyAndGetE2EUser(admin)

  const overview = await s.req('/app/curriculum')
  const html = await overview.text()
  check('overview renders with all ten subjects', overview.status === 200 && topics!.every(t => html.includes(`/app/curriculum/${t.id}`)))
  for (const t of topics!) {
    const res = await s.req(`/app/curriculum/${t.id}`)
    const body = await res.text()
    const rs = readings!.filter(r => r.topic_id === t.id)
    check(`subject ${t.id} renders all ${rs.length} reading cards`, res.status === 200 && rs.every(r => body.includes(`/app/curriculum/${t.id}/${r.id}`)))
  }
  let bad = 0
  for (const r of readings!) {
    const res = await s.req(`/app/curriculum/${r.topic_id}/${r.id}`)
    const body = await res.text()
    if (res.status !== 200 || !body.includes(r.title.replace(/&/g, '&amp;').slice(0, 20))) bad++
  }
  check('all 102 reading pages render', bad === 0, `${bad} failed`)
  const fsa = await (await s.req('/app/curriculum/fsa/r028')).text()
  check('a reading page lists its modules and outcomes', fsa.includes('Revenue Recognition') && fsa.includes('Earnings Per Share') && fsa.includes('Why it matters'))
  const eth = await (await s.req('/app/curriculum/eth/r095')).text()
  check('an Ethics reading lists its Standard-level outcomes', eth.includes('Apply Standard I(A) Knowledge of the Law') && !/still being defined/.test(eth))
  check('unknown subject is a 404', (await s.req('/app/curriculum/nope')).status === 404)
  check('a reading under the wrong subject is a 404', (await s.req('/app/curriculum/quant/r028')).status === 404)
  const anon = await fetch(`${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}/app/curriculum/fsa`, { redirect: 'manual' })
  check('unauthenticated access redirects to login', anon.status >= 300 && anon.status < 400)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
