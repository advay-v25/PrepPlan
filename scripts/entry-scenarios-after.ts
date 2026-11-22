/** After-state of the three adaptive-entry scenarios (pure, no database), same inputs as entry-scenarios-baseline.ts plus the entry context.
 *  The baseline script is kept as the before-state: there, scenarios 2 and 3 produced the same first-pass plan as a fresh candidate. */
import { buildRoadmap, type ModuleInput } from '../src/lib/curriculum/roadmap'
import { EMPTY_ENTRY, entryToken, uncertaintyForModule, type EntryContext } from '../src/lib/curriculum/entryContext'
import { allocateDay } from '../src/lib/planning/pulse/generateWeek'
import { selectRevision } from '../src/lib/curriculum/revisionQueue'

const topics = ['Ethics', 'Quant', 'Econ', 'FSA', 'Equity', 'Fixed Income'].map((name, i) => ({ id: `t${i}`, name, weightMin: 10, weightMax: 15, sequence: i }))
const mods = (cov: (t: number) => ModuleInput['coverage'], ctx: EntryContext): ModuleInput[] => topics.flatMap((t, ti) => [0, 1, 2].map(k => {
  const m = { id: `m${ti}${k}`, topic: t.id, name: `${t.name} ${k + 1}`, effortBand: 3, difficulty: 3, sequence: ti * 3 + k, coverage: cov(ti) }
  return { ...m, uncertainty: uncertaintyForModule(ctx, m) }
}))
const run = (name: string, targetDate: string, cov: (t: number) => ModuleInput['coverage'], ctx: EntryContext, phase: 'first_pass' | 'consolidation' | 'revision' | 'final') => {
  const modules = mods(cov, ctx)
  const r = buildRoadmap({ topics, modules, prerequisites: [], route: 'self_study', weeklyCapacityMinutes: 600, startDate: '2026-11-02', targetDate,
    entry: { mockDate: ctx.mock?.date ?? null, mockKind: ctx.mock?.kind ?? null, token: entryToken(ctx) } })
  const ms = r.milestones.filter(m => m.phase === phase)
  const pending = modules.filter(m => ms.some(x => x.moduleIds.includes(m.id)) && m.coverage !== 'verified')
  // As buildWeekPlanWithPaper does: first-pass work from the phase, covered material from the shared revision queue.
  const queue = selectRevision({ now: new Date('2026-11-02T09:00:00Z'), weekStart: '2026-11-02', phase: phase === 'first_pass' ? 'first_pass' : 'consolidation', limit: phase === 'first_pass' ? 3 : 8,
    readings: modules.map(m => ({ id: m.id, name: m.name, topic: m.topic, topicName: m.topic, coverage: m.coverage, uncertainty: m.uncertainty ?? null, outcomeActivity: [null], reportedCurrent: false,
      evidence: { repair: 0, verify: 0, maintain: 0, untested: 1, latestAt: null }, scheduled: false, continuing: false, repairOverlap: false, history: { lastPlannedAt: null, lastDeclinedAt: null } })) })
  const targets = queue.selected.map(e => modules.find(m => m.id === e.readingId)!)
  const first = pending.filter(m => m.coverage === 'not_started' || m.coverage === 'taught')
  const day = allocateDay({ capacityMinutes: 480, minutesPerEffortUnit: 85, repairs: [], unstableConcepts: [], phase,
    pendingModules: first, revisionTargets: targets, maxRevisionTasks: phase === 'first_pass' ? 3 : 8, revisionShare: phase === 'first_pass' ? undefined : 1 })
  console.log(`\n${name}\n  phases: ${r.phases.map(p => `${p.phase}=${p.weeks}w`).join(', ')}  compressed=${r.compressed}  verdict=${r.feasibility.verdict}  first-pass topics: ${[...new Set(r.milestones.filter(m => m.phase === 'first_pass').map(m => m.topicName))].join(', ') || 'none'}`)
  console.log(`  checkpoints: ${r.checkpoints.map(c => `${c.kind} wk${c.week}`).join(', ') || 'none'}   assumptions: ${r.assumptions.length}   first week (${phase}) task mix: ${[...new Set(day.portions.map(p => p.taskType))].join(' + ') || 'none'}`)
  console.log(`  first week names: ${[...new Set(day.portions.map(p => p.title.replace(/ · sitting.*/, '')))].join('; ')}`)
}
const E = (o: Partial<EntryContext>): EntryContext => ({ ...EMPTY_ENTRY, ...o })
run('1. Fresh candidate, nine months', '2027-08-02', () => 'not_started', E({ stage: 'starting_fresh' }), 'first_pass')
run('2. Three subjects covered (uncertain: Ethics mostly, Quant a few), nine months', '2027-08-02', t => (t < 3 ? 'studied' : 'not_started'),
  E({ stage: 'first_pass_underway', uncertainty: { t0: { level: 'most', lmIds: [] }, t1: { level: 'few', lmIds: [] }, t2: { level: 'none', lmIds: [] } } }), 'first_pass')
run('3. First pass complete, mock in a month, exam ~16 weeks', '2027-02-22', () => 'studied',
  E({ stage: 'revising_or_mocks', mock: { date: '2026-12-02', kind: 'provider_mock' }, uncertainty: { t3: { level: 'several', lmIds: [] } } }), 'consolidation')
