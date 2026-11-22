/** The Curriculum workspace read model against the REAL aggregation (disposable project, owned fixture student, removed afterwards):
 *  full-text note search beyond the preview, distinct notes with identical openings, exact card totals/badges for 1,200 cards across actual quotas (300 per reading),
 *  a failed later page and a failed revision read as honest states. npm run workspace:index:test -- --confirm-target=<ref> */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
const req = createRequire(import.meta.url), { parse } = req('dotenv'), { configuration } = req('./lib/migrations.cjs')
import { createAdminClient } from '../src/lib/supabase/admin'
import { filterRows, getCardTotals, getWorkspaceRows, snippetFor } from '../src/lib/curriculum/workspaceIndex'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const cfg = configuration(['--env=staging', '--dry-run'], parse(readFileSync('.env.staging.local')))
if (process.argv.find(a => a.startsWith('--confirm-target=')) !== `--confirm-target=${cfg.identity}`) { console.error(`Pass --confirm-target=${cfg.identity}.`); process.exit(1) }
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function main() {
  const admin = createAdminClient(), tag = Date.now().toString(36)
  const uid = (await admin.auth.admin.createUser({ email: `wsidx+${tag}@example.com`, email_confirm: true })).data.user!.id
  // The read model is called with a client scoped to this student (what RLS gives the signed-in student), optionally failing one page.
  const scoped = (failAt?: number) => ({ from: (t: string) => ({ select: (...a: any[]) => {
    const b: any = (admin.from(t) as any).select(...a), own = t === 'curriculum_notes' || t === 'flashcards' ? b.eq('user_id', uid) : b
    return failAt !== undefined && t === 'flashcards' ? new Proxy(own, { get: (tg, p, recv) => p === 'range' ? (from: number, to: number) => from >= failAt ? Promise.resolve({ data: null, error: { message: 'injected failure on a later page' } }) : tg.range(from, to) : typeof tg[p] === 'function' ? (...x: any[]) => { const r = tg[p](...x); return r === tg ? recv : r } : tg[p] }) : own
  } }) }) as any
  try {
    const rs = (await admin.from('curriculum_readings').select('id, topic_id, title').eq('is_active', true).order('sequence').limit(6)).data!
    const [r1, r2, r3, r4] = rs
    const opening = 'Revenue recognition notes. '.repeat(10).slice(0, 200)          // identical first 200 characters in two notes
    await admin.from('curriculum_notes').insert([
      { user_id: uid, scope_type: 'reading', scope_id: r1.id, doc: doc(`${opening} ${'filler words '.repeat(60)} the quartzite-lemma appears only here`), revision: 1 },
      { user_id: uid, scope_type: 'reading', scope_id: r2.id, doc: doc(`${opening} ${'other filler '.repeat(60)} nothing special at the end`), revision: 1 },
    ])
    console.log('\nNote search covers the whole note, not the preview')
    const w = await getWorkspaceRows(uid, scoped())
    const n1 = w.rows.find(r => r.readingId === r1.id)!.note!, n2 = w.rows.find(r => r.readingId === r2.id)!.note!
    ok('the display preview is bounded (≤160 characters) and identical for both notes', n1.preview.length <= 160 && n1.preview === n2.preview && !n1.preview.includes('quartzite'), [n1.preview.length])
    ok('a term far beyond the first 160 characters is FOUND (it was unsearchable before)', filterRows(w.rows, { q: 'quartzite-lemma', inNotes: true }).map(r => r.readingId).join() === r1.id)
    ok('two notes with identical openings: the term opens only the note that has it, never the other', !filterRows(w.rows, { q: 'quartzite-lemma', inNotes: true }).some(r => r.readingId === r2.id))
    ok('without the notes option the same word does not match titles', filterRows(w.rows, { q: 'quartzite-lemma' }).length === 0)
    ok('the result snippet is a bounded window around the match, taken from the full text', (() => { const sn = snippetFor(n1.text, 'quartzite-lemma'); return sn.includes('quartzite-lemma') && sn.length <= 200 && n1.text.length > 600 })())

    console.log('\nCard totals and badges are complete (1,200 cards inside the real quotas)')
    const scopes = [r1, r2, r3, r4], past = new Date(Date.now() - 3600_000).toISOString(), future = new Date(Date.now() + 5 * 86400_000).toISOString()
    const rows: any[] = []; scopes.forEach((r, si) => { for (let i = 0; i < 300; i++) rows.push({ user_id: uid, scope_type: 'reading', scope_id: r.id, front: `c${si}-${i}`, back: 'a', due_at: i < 17 + si * 5 ? past : future }) })
    for (let i = 0; i < rows.length; i += 400) { const e = (await admin.from('flashcards').insert(rows.slice(i, i + 400))).error; if (e) throw e }
    const dueTruth = rows.filter(r => r.due_at === past).length
    const w2 = await getWorkspaceRows(uid, scoped()), totals = await getCardTotals(scoped())
    ok('each reading badge shows its true 300 cards and its own due count (a 1,000-row response cap would have cut this)', scopes.every((r, si) => { const x = w2.rows.find(y => y.readingId === r.id)!; return x.cards === 300 && x.due === 17 + si * 5 }), scopes.map(r => w2.rows.find(y => y.readingId === r.id)))
    ok('the workspace badges sum to 1,200 cards and the due total, exactly equal to the exact database counts Home and the Cards page use', w2.rows.reduce((n, r) => n + r.cards, 0) === 1200 && w2.rows.reduce((n, r) => n + r.due, 0) === dueTruth && totals.total === 1200 && totals.due === dueTruth, { totals, dueTruth })
    const failed = await getWorkspaceRows(uid, scoped(500)).then(() => 'resolved', e => e.message)
    ok('a failed later page of the REAL aggregation makes the whole read fail, with no truncated totals and no zeros', /could not be loaded/.test(failed) && failed !== 'resolved', failed)
    const noCount = await getCardTotals({ from: () => ({ select: () => { const q: any = { eq: () => q, lte: () => q, then: (res: any) => res({ data: null, count: null, error: { message: 'down' } }) }; return q } }) } as any).then(() => 'resolved', e => e.message)
    ok('a failed count is an error, never a zero', /could not be counted/.test(noCount), noCount)

    console.log('\nRevision failure is a labelled state, not "no queued work"')
    const wf = await getWorkspaceRows(uid, scoped(), { revision: async () => { throw new Error('revision read failed') } })
    ok('a failing revision read sets revisionUnavailable and leaves labels empty (the page shows a notice instead of an empty filter)', wf.revisionUnavailable === true && wf.rows.every(r => r.revision === null))
    const wn = await getWorkspaceRows(uid, scoped(), { revision: async () => null })
    ok('no active roadmap is NOT a failure', wn.revisionUnavailable === false)
  } finally {
    await admin.from('flashcards').delete().eq('user_id', uid); await admin.from('curriculum_notes').delete().eq('user_id', uid); await admin.auth.admin.deleteUser(uid).catch(() => {})
    console.log('cleanup: fixture student, notes and cards removed')
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
