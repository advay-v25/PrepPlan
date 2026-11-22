/**
 * Note API safety (fixture student, own dev server):  E2E_BASE_URL=http://localhost:3141 npx tsx scripts/notes-safety-test.ts
 * Malformed documents are a 400 (never a 500); a retry after a committed save is recognised, not refused; a real conflict returns the server copy.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { validateNoteDoc, canonicalJson } from '../src/lib/curriculum/notes/doc'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function main() {
  console.log('\n1. Validator (unit)')
  const bad: [string, unknown][] = [
    ['marks as an object', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: { type: 'bold' } }] }] }],
    ['marks entry not an object', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: ['bold'] }] }] }],
    ['attrs as an array', { type: 'doc', content: [{ type: 'paragraph', attrs: [1] }] }],
    ['mark attrs null', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: null }] }] }] }],
    ['text on a non-text node', { type: 'doc', content: [{ type: 'paragraph', text: 'x' }] }],
  ]
  for (const [n, d] of bad) check(`${n}: refused by the validator without throwing`, (() => { try { return validateNoteDoc(d).ok === false } catch { return false } })())
  check('a normal document with marks is accepted', validateNoteDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] }] }).ok === true)
  check('canonical comparison ignores key order', canonicalJson({ a: 1, b: { c: 2, d: 3 } }) === canonicalJson({ b: { d: 3, c: 2 }, a: 1 }))

  const st = await createStudent(admin, 'nt', { onboard: true })
  try {
    const post = (body: unknown) => st.s.post('/api/curriculum/notes', body)
    const scope = { scopeType: 'reading', scopeId: 'r028' }
    console.log('\n2. Over HTTP')
    const m = await post({ ...scope, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: { type: 'bold' } }] }] }, expectedRevision: 0 })
    check('malformed marks: structured 400, not a blank 500', m.status === 400 && m.body?.ok === false && typeof m.body?.error === 'string', JSON.stringify(m.body).slice(0, 120))
    const first = await post({ ...scope, doc: doc('first'), expectedRevision: 0 })
    check('first save commits revision 1', first.body?.ok === true && first.body.revision === 1)
    const replay = await post({ ...scope, doc: doc('first'), expectedRevision: 0 })
    check('a retry after a committed save (lost response) is recognised as saved, not a conflict', replay.status === 200 && replay.body?.ok === true && replay.body.revision === 1 && replay.body.replayed === true, JSON.stringify(replay.body).slice(0, 140))
    const second = await post({ ...scope, doc: doc('second'), expectedRevision: 1 })
    const staleRetry = await post({ ...scope, doc: doc('second'), expectedRevision: 1 })
    check('the same retry of an update is also recognised', second.body?.ok === true && staleRetry.body?.ok === true && staleRetry.body.replayed === true && staleRetry.body.revision === 2)
    const conflict = await post({ ...scope, doc: doc('different'), expectedRevision: 1 })
    check('a genuinely different stale save is a 409 carrying the server copy', conflict.status === 409 && conflict.body?.code === 'stale_revision' && canonicalJson(conflict.body.doc) === canonicalJson(doc('second')) && conflict.body.revision === 2)
    const stored = (await st.s.json('/api/curriculum/notes?scopeType=reading&scopeId=r028')).body
    check('the stored note is unchanged by the refusals', canonicalJson(stored.doc) === canonicalJson(doc('second')) && stored.revision === 2)
    check('unknown reading: 404', (await st.s.json('/api/curriculum/notes?scopeType=reading&scopeId=nope')).status === 404)
  } finally { await admin.auth.admin.deleteUser(st.id).catch(() => {}) }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
