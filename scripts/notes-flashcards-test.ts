/** Pure tests: note document validation and flashcard scheduling. */
import { validateNoteDoc, starterDoc, noteText, MAX_DOC_BYTES } from '../src/lib/curriculum/notes/doc'
import { scheduleReview, isDue, type CardState } from '../src/lib/curriculum/flashcards'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const doc = (...content: any[]) => ({ type: 'doc', content })
const para = (text: string, marks?: any[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })

console.log('\nNote documents\n')
check('the starter documents are valid', validateNoteDoc(starterDoc('reading')).ok && validateNoteDoc(starterDoc('subject')).ok)
check('the reading starter has structured sections', /Key ideas/.test(noteText(starterDoc('reading'))) && /Common mistakes/.test(noteText(starterDoc('reading'))) && /Formulas/.test(noteText(starterDoc('reading'))))
check('headings, lists, checklists, tables, quotes and code are accepted', validateNoteDoc(doc(
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [para('a')] }] },
  { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('todo')] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [para('h')] }, { type: 'tableCell', content: [para('c')] }] }] },
  { type: 'blockquote', content: [para('q')] }, { type: 'codeBlock', content: [{ type: 'text', text: 'x=1' }] }, { type: 'horizontalRule' },
)).ok)
check('https, http and mailto links are accepted', ['https://example.com', 'http://example.com/a', 'mailto:a@b.co'].every(h => validateNoteDoc(doc(para('l', [{ type: 'link', attrs: { href: h } }]))).ok))
check('javascript: and data: links are refused', ['javascript:alert(1)', 'data:text/html,x', 'JaVaScRiPt:1', ' javascript:1'].every(h => !validateNoteDoc(doc(para('l', [{ type: 'link', attrs: { href: h } }]))).ok))
check('a link without an href is refused', !validateNoteDoc(doc(para('l', [{ type: 'link', attrs: {} }]))).ok)
check('unknown node types (script, iframe, image) are refused', ['script', 'iframe', 'image', 'html'].every(t => !validateNoteDoc(doc({ type: t })).ok))
check('unknown marks are refused', !validateNoteDoc(doc(para('x', [{ type: 'style' }]))).ok)
check('a heading level outside 1-3 is refused', !validateNoteDoc(doc({ type: 'heading', attrs: { level: 9 }, content: [] })).ok)
check('a non-document is refused', !validateNoteDoc(null).ok && !validateNoteDoc({ type: 'paragraph' }).ok && !validateNoteDoc('x').ok)
check('an oversized note is refused', !validateNoteDoc(doc(para('x'.repeat(MAX_DOC_BYTES)))).ok)
check('a deeply nested note is refused', (() => { let n: any = para('x'); for (let i = 0; i < 40; i++) n = { type: 'blockquote', content: [n] }; return !validateNoteDoc(doc(n)).ok })())
check('malformed content is refused', !validateNoteDoc(doc({ type: 'paragraph', content: 'nope' })).ok)

console.log('\nFlashcard scheduling\n')
const now = new Date('2026-09-20T09:00:00Z')
const fresh: CardState = { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 }
const days = (r: { dueAt: string }) => (new Date(r.dueAt).getTime() - now.getTime()) / 86_400_000
check('good on a new card: due tomorrow', days(scheduleReview(fresh, 'good', now)) === 1)
check('good again: 3 days, then it grows by ease', (() => { const a = scheduleReview(fresh, 'good', now); const b = scheduleReview(a, 'good', now); const c = scheduleReview(b, 'good', now); return b.intervalDays === 3 && c.intervalDays === Math.round(3 * 2.5) })())
check('easy on a new card: 3 days and ease rises', (() => { const r = scheduleReview(fresh, 'easy', now); return days(r) === 3 && r.ease === 2.65 })())
check('hard on a new card: 1 day and ease falls', (() => { const r = scheduleReview(fresh, 'hard', now); return days(r) === 1 && r.ease === 2.35 })())
check('again: back in 10 minutes, a lapse, reps reset, ease falls', (() => {
  const seen = scheduleReview(scheduleReview(fresh, 'good', now), 'good', now)
  const r = scheduleReview(seen, 'again', now)
  return new Date(r.dueAt).getTime() - now.getTime() === 10 * 60_000 && r.lapses === 1 && r.reps === 0 && r.intervalDays === 0 && r.ease < seen.ease
})())
check('ease never leaves 1.3 to 3.5', (() => { let c: CardState = fresh; for (let i = 0; i < 30; i++) c = scheduleReview(c, 'again', now); let e: CardState = fresh; for (let i = 0; i < 40; i++) e = scheduleReview(e, 'easy', now); return c.ease === 1.3 && e.ease === 3.5 })())
check('a mature card reviewed hard grows slowly', (() => { const c = { intervalDays: 20, ease: 2.5, reps: 5, lapses: 0 }; const r = scheduleReview(c, 'hard', now); return r.intervalDays === 24 })())
check('intervals are capped at a year', (() => { let e: CardState = fresh; for (let i = 0; i < 60; i++) e = scheduleReview(e, 'easy', now); return e.intervalDays === 365 })())
check('a card is due when its date has passed', isDue('2026-09-20T08:00:00Z', now) && !isDue('2026-09-21T08:00:00Z', now))
check('intervals are always at least a day after a pass', ['hard', 'good', 'easy'].every(r => scheduleReview(fresh, r as any, now).intervalDays >= 1))

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
