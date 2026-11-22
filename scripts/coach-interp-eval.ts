/**
 * Interpretation hold-out evaluation (OFFLINE, deterministic path only: no provider, simulated or live). Metrics are reported SEPARATELY,
 * because a refusal is not planning help and a high routing score says nothing about groundedness.
 *   routing        primary intent equals the label (among cases the deterministic path resolves)
 *   resolved       share the deterministic path resolves at all (the rest go to the bounded model / a clarification)
 *   wrongRoute     resolved to a DIFFERENT non-free intent than labelled (the dangerous error)
 *   forbidden      an action intent the message negated or hypothesised was still produced
 *   boundary       the teaching flag equals the label (curriculum teaching is declined, method help is not)
 *   dates          the day the student asked for, for labelled move requests
 *   grounded       the verified plan for the resolved intent offers only server-built proposals and /app links
 *   planningKept   a mixed request still yields its planning intent (a refusal alone does not count)
 *   npm run coach:interp:eval
 */
import fs from 'node:fs'
import path from 'node:path'
import { interpret } from '../src/lib/coach/interpret'
import { deterministicReply, planLinks, planProposals, type CoachSituation } from '../src/lib/coach/actions'
import { INTERPRETER_VERSION } from '../src/lib/coach/interpret'

const spec = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'coach-eval', 'holdout.json'), 'utf8'))
const base: CoachSituation = { intent: 'free', today: '2026-11-12', todayOpen: [{ id: 'a', title: 'A', revision: 1, durationMinutes: 30, execution: 'not_started', date: '2026-11-12' }], repairs: [], cycle: { start: '2026-11-09', end: '2026-11-15' }, load: {}, paper: 'none', closing: false }
type C = { message: string; intent: string; teaching?: boolean; when?: string | null; forbid?: string[]; unresolved?: boolean }
const rate = (n: number, d: number) => d ? `${n}/${d} (${Math.round(100 * n / d)}%)` : 'n/a'
const m = { resolved: [0, 0], routing: [0, 0], wrongRoute: [0, 0], forbidden: [0, 0], boundary: [0, 0], dates: [0, 0], grounded: [0, 0], planningKept: [0, 0] }
const bump = (k: keyof typeof m, hit: boolean) => { m[k][1]++; if (hit) m[k][0]++ }
const miss: string[] = []
for (const c of spec.cases as C[]) {
  const i = interpret(c.message), s: CoachSituation = { ...base, intent: i.primary, when: i.when }
  bump('resolved', i.primary !== 'free' || !c.unresolved && c.intent === 'free')   // "free" is a correct resolution only when free was the label
  if (!c.unresolved) {
    if (i.primary === c.intent) bump('routing', true); else { bump('routing', false); miss.push(`routing: "${c.message}" → ${i.primary}, wanted ${c.intent}`) }
    bump('wrongRoute', !(i.primary !== 'free' && i.primary !== c.intent))
  }
  for (const f of c.forbid ?? []) bump('forbidden', !i.intents.includes(f as any) && i.primary !== f)
  bump('boundary', i.teaching === Boolean(c.teaching) || (c.intent === 'teach' && i.primary === 'teach'))
  if (c.when !== undefined && c.intent === 'move_block' && !c.unresolved) bump('dates', i.when === c.when)
  const { proposals, notes } = planProposals(s), links = planLinks(s)
  deterministicReply(s, 'Insufficient evidence', notes, proposals)
  bump('grounded', proposals.every(p => ['defer_today', 'move_task'].includes(p.kind)) && links.every(l => /^\/(app|onboarding)\b/.test(l.href)))
  if (c.teaching && c.intent !== 'teach') bump('planningKept', i.primary === c.intent && i.teaching)
}
console.log(`Interpreter ${INTERPRETER_VERSION}; hold-out v${spec.version}, ${spec.cases.length} cases (deterministic path only; nothing here exercises a provider)\n`)
for (const [k, [n, d]] of Object.entries(m)) console.log(`  ${k.padEnd(13)} ${rate(n, d)}`)
for (const x of miss) console.log(`  · ${x}`)
fs.mkdirSync(path.join(process.cwd(), 'scripts', 'coach-eval', 'results'), { recursive: true })
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'coach-eval', 'results', `holdout-${INTERPRETER_VERSION}.json`), JSON.stringify({ version: INTERPRETER_VERSION, cases: spec.cases.length, metrics: Object.fromEntries(Object.entries(m).map(([k, [n, d]]) => [k, { hit: n, of: d }])), misses: miss }, null, 1))
// Safety floors, not a quality claim: a wrong action route, a forbidden action or a lost planning part must never occur.
const floors = m.forbidden[0] === m.forbidden[1] && m.planningKept[0] === m.planningKept[1] && m.grounded[0] === m.grounded[1]
if (!floors) { console.log('\nA safety floor was breached.'); process.exit(1) }
