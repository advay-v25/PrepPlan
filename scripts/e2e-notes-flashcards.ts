/**
 * Notes and flashcards live. Dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-notes-flashcards.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function main() {
  console.log('\nNotes and flashcards\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  await admin.from('curriculum_notes').delete().eq('user_id', uid)
  await admin.from('flashcards').delete().eq('user_id', uid)

  const post = (p: string, b: unknown) => fetch(`${E2E_BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  check('notes require authentication', (await fetch(`${E2E_BASE_URL}/api/curriculum/notes?scopeType=reading&scopeId=r028`)).status === 401 && (await post('/api/curriculum/notes', {})).status === 401)
  check('flashcards require authentication', (await fetch(`${E2E_BASE_URL}/api/curriculum/flashcards?due=1`)).status === 401 && (await post('/api/curriculum/flashcards', { action: 'draft' })).status === 401)

  console.log('Notes')
  const g0 = (await s.json('/api/curriculum/notes?scopeType=reading&scopeId=r028')).body
  check('no note yet: revision 0', g0.ok && g0.doc === null && g0.revision === 0)
  check('an unknown scope is a 404', (await s.json('/api/curriculum/notes?scopeType=reading&scopeId=nope')).status === 404 && (await s.json('/api/curriculum/notes?scopeType=galaxy&scopeId=x')).status === 404)
  const bad = await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 0, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } })
  check('a note with a javascript: link is refused', bad.status === 400 && /http/.test(bad.body?.error ?? ''), JSON.stringify(bad.body))
  check('a note with unsupported content is refused', (await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 0, doc: { type: 'doc', content: [{ type: 'iframe' }] } })).status === 400)
  check('nothing was stored by refused saves', ((await admin.from('curriculum_notes').select('*').eq('user_id', uid)).data ?? []).length === 0)

  const n1 = await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 0, doc: doc('First') })
  check('the first save creates revision 1', n1.body?.ok && n1.body.revision === 1)
  const dupFirst = await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 0, doc: doc('Racing first save') })
  check('a second "first" save is a stale conflict, not an overwrite', dupFirst.status === 409 && dupFirst.body?.code === 'stale_revision')
  const n2 = await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 1, doc: doc('Second') })
  check('a save at the right revision advances it', n2.body?.ok && n2.body.revision === 2)
  const stale = await s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 1, doc: doc('Stale') })
  check('a stale save is refused with the current note', stale.status === 409 && stale.body?.revision === 2 && JSON.stringify(stale.body?.doc).includes('Second'))
  const race = await Promise.all([1, 2, 3].map(i => s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: 'r028', expectedRevision: 2, doc: doc(`Race ${i}`) })))
  check('concurrent saves at one revision: exactly one wins', race.filter(r => r.body?.ok).length === 1 && race.filter(r => r.status === 409).length === 2, JSON.stringify(race.map(r => r.status)))
  const g1 = (await s.json('/api/curriculum/notes?scopeType=reading&scopeId=r028')).body
  check('the stored note is the winner and revision is 3', g1.revision === 3 && /Race/.test(JSON.stringify(g1.doc)))
  const sub = await s.post('/api/curriculum/notes', { scopeType: 'subject', scopeId: 'fsa', expectedRevision: 0, doc: doc('Subject note') })
  check('a subject note is separate from a reading note', sub.body?.ok && (await s.json('/api/curriculum/notes?scopeType=subject&scopeId=fsa')).body.revision === 1)
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  check('notes are not readable without a session (RLS)', ((await anon.from('curriculum_notes').select('*')).data ?? []).length === 0)
  const readingHtml = await (await s.req('/app/curriculum/fsa/r028')).text()
  check('the reading page has notes and flashcards sections', readingHtml.includes('Your notes') && readingHtml.includes('Flashcards'))
  const subjectHtml = await (await s.req('/app/curriculum/fsa')).text()
  check('the subject page has notes and flashcards sections', subjectHtml.includes('Your notes on') && subjectHtml.includes('Flashcards for'))

  console.log('Flashcards')
  const before = (await s.json('/api/curriculum/readiness')).body.tracker
  const c1 = await s.post('/api/curriculum/flashcards', { action: 'create', scopeType: 'reading', scopeId: 'r028', front: 'What is basic EPS?', back: 'Net income less preferred dividends, over weighted average shares.' })
  check('a card is created', c1.body?.ok && c1.body.card.reps === 0)
  check('a card needs both sides', (await s.post('/api/curriculum/flashcards', { action: 'create', scopeType: 'reading', scopeId: 'r028', front: 'Only a front', back: ' ' })).status === 400)
  check('a card for an unknown reading is a 404', (await s.post('/api/curriculum/flashcards', { action: 'create', scopeType: 'reading', scopeId: 'nope', front: 'a', back: 'b' })).status === 404)
  const c2 = await s.post('/api/curriculum/flashcards', { action: 'create', scopeType: 'subject', scopeId: 'fsa', front: 'Which ratios test solvency?', back: 'Debt-to-equity, interest coverage.' })
  check('a subject card is created', c2.body?.ok)
  const list = (await s.json('/api/curriculum/flashcards?scopeType=reading&scopeId=r028')).body
  check('the list is per scope', list.cards.length === 1 && list.cards[0].front === 'What is basic EPS?')
  const upd = await s.post('/api/curriculum/flashcards', { action: 'update', cardId: c1.body.card.id, front: 'Define basic EPS', back: 'Earnings available to common shares divided by weighted average shares.' })
  check('a card can be edited', upd.body?.ok && upd.body.card.front === 'Define basic EPS')
  check('editing an unknown card is a 404', (await s.post('/api/curriculum/flashcards', { action: 'update', cardId: '00000000-0000-0000-0000-000000000000', front: 'a', back: 'b' })).status === 404)

  const due = (await s.json('/api/curriculum/flashcards?due=1')).body
  check('new cards are due now', due.cards.length === 2)
  const good = await s.post('/api/curriculum/flashcards', { action: 'review', cardId: c1.body.card.id, rating: 'good' })
  check('good moves the card a day out', good.body?.ok && good.body.intervalDays === 1 && new Date(good.body.dueAt).getTime() > Date.now() + 20 * 3600_000)
  const again = await s.post('/api/curriculum/flashcards', { action: 'review', cardId: c2.body.card.id, rating: 'again' })
  check('again brings it back within minutes and counts a lapse', again.body?.ok && new Date(again.body.dueAt).getTime() < Date.now() + 15 * 60_000)
  const row = (await admin.from('flashcards').select('lapses, reps').eq('id', c2.body.card.id).single()).data
  check('the lapse was recorded', row?.lapses === 1 && row?.reps === 0)
  check('an invalid rating is refused', (await s.post('/api/curriculum/flashcards', { action: 'review', cardId: c1.body.card.id, rating: 'perfect' })).status === 400)
  check('the reviewed card is no longer due', ((await s.json('/api/curriculum/flashcards?due=1')).body.cards as any[]).every((c: any) => c.id !== c1.body.card.id))
  check('the due-cards page renders', (await s.req('/app/curriculum/flashcards')).status === 200)
  check('the overview links to it', (await (await s.req('/app/curriculum')).text()).includes('/app/curriculum/flashcards'))

  const dr = await s.post('/api/curriculum/flashcards', { action: 'draft', scopeType: 'reading', scopeId: 'r028' })
  check('suggested fronts come from the outcome list', dr.body?.ok && dr.body.drafts.length === 5 && dr.body.drafts.every((d: any) => d.front.startsWith('In your own words')))
  check('suggesting writes nothing', ((await admin.from('flashcards').select('id').eq('user_id', uid)).data ?? []).length === 2)
  check('subject suggestions cover its readings', (await s.post('/api/curriculum/flashcards', { action: 'draft', scopeType: 'subject', scopeId: 'fsa' })).body.drafts.length > 5)

  const after = (await s.json('/api/curriculum/readiness')).body.tracker
  check('flashcard ratings never move readiness', JSON.stringify(after.totals) === JSON.stringify(before.totals))
  check('flashcards are not readable without a session (RLS)', ((await anon.from('flashcards').select('*')).data ?? []).length === 0)
  check('a card can be deleted', (await s.post('/api/curriculum/flashcards', { action: 'delete', cardId: c2.body.card.id })).body?.ok && (await s.post('/api/curriculum/flashcards', { action: 'delete', cardId: c2.body.card.id })).status === 404)

  await admin.from('curriculum_notes').delete().eq('user_id', uid)
  await admin.from('flashcards').delete().eq('user_id', uid)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
