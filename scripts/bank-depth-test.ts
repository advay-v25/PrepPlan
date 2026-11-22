import { readAll } from '../src/lib/supabase/readAll'
import { shallowOutcomes } from '../src/lib/tests/bankCoverage'
import { expectedSeconds } from '../src/lib/tests/attemptTiming'
import { REFERENCE_SECONDS_PER_QUESTION } from '../src/lib/tests/limits'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const fam = (o: Record<string, string[]>) => new Map(Object.entries(o).map(([k, v]) => [k, new Set(v)]))
// Plenty of total volume but a skewed bank: one outcome deep, the others at one family.
ok('a skewed bank does not pass: every outcome needs its own three families', JSON.stringify(shallowOutcomes(['a', 'b', 'c'], fam({ a: ['1', '2', '3', '4', '5', '6'], b: ['7'], c: ['8'] }))) === '["b","c"]')
ok('three variants of one family are one family', shallowOutcomes(['a'], fam({ a: ['f1'] })).length === 1)
ok('an outcome with three families passes; one with none is shallow', shallowOutcomes(['a', 'z'], fam({ a: ['1', '2', '3'] })).join() === 'z')
ok('canonical cognition values are mapped explicitly (calculate is 1.5×, recall 0.6×, not the default)', expectedSeconds('calculate') === Math.round(REFERENCE_SECONDS_PER_QUESTION * 1.5) && expectedSeconds('recall') === Math.round(REFERENCE_SECONDS_PER_QUESTION * 0.6) && expectedSeconds('interpret') === Math.round(REFERENCE_SECONDS_PER_QUESTION * 1.1))
ok('apply keeps the reference pace; an unknown value uses the default', expectedSeconds('apply') === REFERENCE_SECONDS_PER_QUESTION && expectedSeconds('mystery') === REFERENCE_SECONDS_PER_QUESTION)

// SYNTHETIC large-bank read measurement (in-memory pager, no database): proves paging cost and fail-closed behaviour; says nothing about real content readiness.
const pager = (n: number, failAt = -1) => { const calls = { n: 0 }; return { calls, page: async (a: number, z: number) => { calls.n++; if (calls.n === failAt) return { data: null, error: { message: 'boom' } }; return { data: Array.from({ length: Math.max(0, Math.min(z + 1, n) - a) }, (_, i) => ({ id: a + i })), error: null } } } }
void (async () => {
  const big = pager(20_000), rows = await readAll(big.page)
  ok('synthetic 20,000-row read returns every row in ceil(n/500)+1 ordered pages (here 41), never one unbounded query', rows.length === 20_000 && big.calls.n === 41 && new Set(rows.map((r: any) => r.id)).size === 20_000, big.calls.n)
  const exact = pager(1_000); await readAll(exact.page); ok('an exact page-boundary size costs one extra empty page, not a missed row', exact.calls.n === 3)
  const bad = pager(20_000, 17); const threw = await readAll(bad.page).then(() => false, e => /could not be loaded/.test(String(e.message))); ok('a failed page mid-read throws "could not be loaded" (unavailable), it is never returned as a short or zero result', threw && bad.calls.n === 17)
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
