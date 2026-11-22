/** Pure: the final stretch links accepted work where it exists and the existing proposal flow where new work is needed. */
import { finalStretch, examPhase } from '../src/lib/exam/finalStretch'
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const base = { phase: 'final_preparation' as const, daysToExam: 30, weeklyBudgetMinutes: 600, openRepairs: 0, revisionNext: [], rehearsal: null, debriefHref: null, externalMockSoon: null, psm: 'unknown' as const }
const withRepair = { ...base, openRepairs: 3 }
console.log('\nFinal stretch → Calendar work\n')
let p = finalStretch({ ...withRepair, repair: { task: { href: '/app/calendar?task=t1', date: '2026-11-06', title: 'Repair: X' }, proposalHref: null } })!
check('an accepted repair task is linked, not duplicated', p.items.find(i => i.kind === 'fix')?.status === 'on_calendar' && p.items.find(i => i.kind === 'fix')?.href === '/app/calendar?task=t1')
p = finalStretch({ ...withRepair, repair: { task: null, proposalHref: '/app/tests/abc/result#proposal-h' } })!
check('open repairs with no accepted task go through the existing follow-up proposal (nothing is added silently)', p.items.find(i => i.kind === 'fix')?.status === 'proposal' && /proposal-h/.test(p.items.find(i => i.kind === 'fix')!.href))
p = finalStretch({ ...base, revisionNext: [{ name: 'Reading A', href: '/app/curriculum/x/a', why: 'stale', task: { href: '/app/calendar?task=r1', date: '2026-11-07' } }, { name: 'Reading B', href: '/app/curriculum/x/b', why: 'stale', task: null }] , phase: 'final_week', daysToExam: 5 })!
const m = p.items.filter(i => i.kind === 'maintenance')
check('revision already accepted is linked; revision not yet planned goes to the next weekly review proposal', m[0].status === 'on_calendar' && m[0].href.includes('task=r1') && m[1].status === 'proposal' && m[1].href === '/app/review-week')
check('with no repair and no revision the stretch is still actionable (a selected check, logistics)', (() => { const x = finalStretch({ ...base, phase: 'final_week', daysToExam: 4 })!; return x.items.some(i => i.kind === 'check') && x.items.some(i => i.kind === 'logistics') })())
check('after the exam date it asks; it never assumes the exam was sat', examPhase({ today: '2026-11-10', examDate: '2026-11-09', satOn: null }).phase === 'awaiting_status' && examPhase({ today: '2026-11-10', examDate: '2026-11-09', satOn: '2026-11-09' }).phase === 'sat')
console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0)
