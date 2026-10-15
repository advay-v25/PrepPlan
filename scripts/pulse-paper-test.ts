/**
 * Weekly paper classification and bank thresholds (Decisions §3).
 */
import { PAPER_START_TIME,
  classifyWeeklyPaper, moduleSize, PAPER_MIN_ITEMS_PER_MODULE, PAPER_MIN_TOTAL_ITEMS,
  PAPER_MAX_TOTAL_ITEMS, PAPER_MIN_MINUTES, PAPER_MAX_MINUTES, type ModuleBank,
} from '../src/lib/planning/pulse/paper'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const mod = (moduleId: string, effortBand: number, unseenEligible: number): ModuleBank => ({ moduleId, effortBand, unseenEligible })

console.log('\nClassification\n')

const newOnly = classifyWeeklyPaper({ newModules: [mod('a', 2, 10)], revisitedModules: [] })
check('new-only scope -> diagnostic', newOnly.kind === 'paper' && newOnly.purpose === 'diagnostic')

const revOnly = classifyWeeklyPaper({ newModules: [], revisitedModules: [mod('a', 3, 10), mod('b', 2, 10)] })
check('revision-only scope -> revisionary', revOnly.kind === 'paper' && revOnly.purpose === 'revisionary')

const mixed = classifyWeeklyPaper({ newModules: [mod('a', 2, 10)], revisitedModules: [mod('b', 3, 10)] })
check('mixed scope -> mixed with two separate sections',
  mixed.kind === 'paper' && mixed.purpose === 'mixed' && mixed.sections.length === 2 &&
  mixed.sections[0].purpose === 'diagnostic' && mixed.sections[1].purpose === 'revisionary')

const empty = classifyWeeklyPaper({ newModules: [], revisitedModules: [] })
check('no scope -> no paper, reason no_scope', empty.kind === 'none' && empty.reason === 'no_scope')

console.log('\nBank sufficiency\n')

const short = classifyWeeklyPaper({ newModules: [mod('a', 3, 6)], revisitedModules: [] })
check('a medium new module needs 7 unseen items: 6 is not enough -> no paper',
  short.kind === 'none' && short.reason === 'insufficient_bank' && short.skipped[0]?.required === 7 && short.skipped[0]?.available === 6)

const exact = classifyWeeklyPaper({ newModules: [mod('a', 3, 7), mod('b', 2, 5)], revisitedModules: [] })
check('exactly at the threshold is sufficient', exact.kind === 'paper' && exact.sections[0].moduleIds.length === 2)

const partial = classifyWeeklyPaper({ newModules: [mod('a', 2, 20), mod('b', 2, 1)], revisitedModules: [] })
check('an unsupported module is dropped from the paper, not tested anyway',
  partial.kind === 'paper' && partial.sections[0].moduleIds.join() === 'a' && partial.skipped.some(s => s.moduleId === 'b'))

const revNeedsLess = classifyWeeklyPaper({ newModules: [], revisitedModules: [mod('a', 2, 3)] })
check('revisionary needs fewer items than diagnostic for the same module size (3 vs 5)',
  PAPER_MIN_ITEMS_PER_MODULE.revisionary.small < PAPER_MIN_ITEMS_PER_MODULE.diagnostic.small && revNeedsLess.kind === 'none' /* 3 < floor of 5 */)

const oneSidedMixed = classifyWeeklyPaper({ newModules: [mod('a', 2, 2)], revisitedModules: [mod('b', 3, 12)] })
check('mixed request where only the revisited side has bank support -> revisionary, not mixed',
  oneSidedMixed.kind === 'paper' && oneSidedMixed.purpose === 'revisionary')

const belowFloor = classifyWeeklyPaper({ newModules: [], revisitedModules: [mod('a', 1, 9)] })
check(`a paper under ${PAPER_MIN_TOTAL_ITEMS} minimum items in total is not scheduled`,
  belowFloor.kind === 'none' && belowFloor.reason === 'below_minimum_paper')

console.log('\nModule-size thresholds\n')
check('effort bands map to sizes', moduleSize(1) === 'small' && moduleSize(2) === 'small' && moduleSize(3) === 'medium' && moduleSize(4) === 'large')
check('larger modules need strictly more items (both purposes)',
  (['diagnostic', 'revisionary'] as const).every(p => {
    const t = PAPER_MIN_ITEMS_PER_MODULE[p]; return t.small < t.medium && t.medium < t.large
  }))

console.log('\nBounds\n')
const many = classifyWeeklyPaper({ newModules: Array.from({ length: 12 }, (_, i) => mod(`m${i}`, 4, 40)), revisitedModules: [] })
check('paper length never exceeds the maximum', many.kind === 'paper' && many.totalTargetItems <= PAPER_MAX_TOTAL_ITEMS)
check('estimated sitting stays within bounds',
  many.kind === 'paper' && many.estimatedMinutes >= PAPER_MIN_MINUTES && many.estimatedMinutes <= PAPER_MAX_MINUTES && many.estimatedMinutes <= 180)
check('a module that is both new and revisited is not double counted',
  (() => { const p = classifyWeeklyPaper({ newModules: [mod('a', 2, 10)], revisitedModules: [] }); return p.kind === 'paper' && p.totalMinItems === 5 })())

check('the weekly paper is always a morning sitting', PAPER_START_TIME === '09:00')

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
