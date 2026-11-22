/** Pure tests for the linked-rehearsal blueprint: per-session allocation, family independence across both sessions, session-specific shortfalls. */
import { planRehearsal, rehearsalAllocations, sessionAllocation, SESSION_TOPICS, SESSION_QUESTIONS, type RehearsalItem, type TopicWeight } from '../src/lib/rehearsal/blueprint'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const TOPICS: TopicWeight[] = [
  { id: 'alt', min: 6, max: 9 }, { id: 'ci', min: 6, max: 9 }, { id: 'deriv', min: 6, max: 9 }, { id: 'econ', min: 6, max: 9 }, { id: 'eq', min: 11, max: 14 },
  { id: 'eth', min: 10, max: 15 }, { id: 'fi', min: 11, max: 14 }, { id: 'fsa', min: 11, max: 14 }, { id: 'pm', min: 8, max: 12 }, { id: 'quant', min: 11, max: 14 },
]
let seq = 0
const mk = (topic: string, n: number, reading = (k: number) => `${topic}-r${k % 3}`): RehearsalItem[] =>
  Array.from({ length: n }, (_, k) => ({ id: `${topic}-${++seq}`, lm_id: reading(k), outcome_id: `o-${topic}-${k}`, concept_id: 'c', intended_difficulty: 'standard', cognition: 'apply', item_form: 'direct', key_index: k % 3, family_id: `${topic}-fam-${k}`, topic_id: topic }))
const [a1, a2] = rehearsalAllocations(TOPICS)
const alloc: Record<string, number> = { ...a1, ...a2 }
const full = TOPICS.flatMap(t => mk(t.id, alloc[t.id] + 2))

console.log('\nSession allocation (official 2027 grouping)\n')
check('each session is exactly 90 questions', Object.values(a1).reduce((n, v) => n + v, 0) === 90 && Object.values(a2).reduce((n, v) => n + v, 0) === 90)
check('session 1 holds only Ethics, Quant, Economics, FSA, Corporate Finance; session 2 only the other five', JSON.stringify(Object.keys(a1).sort()) === JSON.stringify([...SESSION_TOPICS[0]].sort()) && JSON.stringify(Object.keys(a2).sort()) === JSON.stringify([...SESSION_TOPICS[1]].sort()))
check('the two sessions do NOT share one allocation', JSON.stringify(a1) !== JSON.stringify(a2))
check('every topic count lies inside its official range as a share of all 180 questions', TOPICS.every(t => alloc[t.id] >= Math.ceil(t.min * 1.8 - 1e-9) && alloc[t.id] <= Math.floor(t.max * 1.8 + 1e-9)), JSON.stringify(alloc))
check('allocation is deterministic and follows weight (an 11–14% topic gets more than a 6–9% one)', alloc.eq > alloc.alt && JSON.stringify(rehearsalAllocations([...TOPICS].reverse())) === JSON.stringify([a1, a2]))
{
  let threw = false; try { sessionAllocation([{ id: 'x', min: 1, max: 2 }, { id: 'y', min: 1, max: 2 }]) } catch { threw = true }
  check('an infeasible range set is refused, not silently normalised', threw)
}

console.log('\nTwo independent sessions\n')
{
  const p = planRehearsal(full, TOPICS, () => 0.42)
  check('with enough depth in every topic, both sessions assemble to 90', p.ready && p.sessions[0].length === 90 && p.sessions[1].length === 90)
  const all = [...p.sessions[0], ...p.sessions[1]]
  check('no question is used twice across the two sessions', new Set(all).size === 180)
  const fam = new Map(full.map(i => [i.id, i.family_id]))
  check('no family appears twice anywhere in the rehearsal', new Set(all.map(i => fam.get(i))).size === 180)
  const topicOf = new Map(full.map(i => [i.id, i.topic_id]))
  const share = (s: string[]) => Object.fromEntries(TOPICS.map(t => [t.id, s.filter(i => topicOf.get(i) === t.id).length]))
  check('each session delivers exactly its own allocation and no other session\'s topics', JSON.stringify(Object.fromEntries(Object.entries(share(p.sessions[0])).filter(([, v]) => v))) === JSON.stringify(Object.fromEntries(Object.entries(a1).sort())) && TOPICS.filter(t => a2[t.id]).every(t => share(p.sessions[0])[t.id] === 0))
  check('session 2 delivers exactly its own allocation', TOPICS.filter(t => a2[t.id]).every(t => share(p.sessions[1])[t.id] === a2[t.id]) && TOPICS.filter(t => a1[t.id]).every(t => share(p.sessions[1])[t.id] === 0))
  const readingsOf = (s: string[]) => new Set(s.map(i => full.find(x => x.id === i)!.lm_id)).size
  check('a topic is spread across its readings before any reading repeats', readingsOf(p.sessions[0]) >= 12)
}

console.log('\nSession-specific shortfalls\n')
{
  // 'fi' (session 2) is three families short.
  const thin = TOPICS.flatMap(t => mk(t.id, t.id === 'fi' ? alloc.fi - 3 : alloc[t.id] + 2))
  const p = planRehearsal(thin, TOPICS)
  check('a topic three questions short leaves session 1 whole and session 2 short, naming the topic', !p.ready && p.shortfalls[0].length === 0 && p.shortfalls[1].length === 1 && p.shortfalls[1][0].topicId === 'fi' && p.shortfalls[1][0].deliverable === alloc.fi - 3, JSON.stringify(p.shortfalls))
  check('the short session reports how many it can serve, and the other session is unaffected', p.sessions[0].length === 90 && p.sessions[1].length === 87)
  // 200 questions "somewhere in the bank" but only in two topics.
  const lopsided = [...mk('eth', 100), ...mk('eq', 100)]
  const q = planRehearsal(lopsided, TOPICS)
  check('200 approved questions in two topics are not a rehearsal: every other topic is a named shortfall in both sessions', !q.ready && q.shortfalls[0].length === 4 && q.shortfalls[1].length === 4)
  check('an empty held-out bank gives two empty sessions, never a smaller paper', planRehearsal([], TOPICS).sessions.every(s => s.length === 0) && !planRehearsal([], TOPICS).ready)
  // Same family repeated many times inside one topic counts once.
  const sameFam = TOPICS.flatMap(t => mk(t.id, alloc[t.id] + 2).map(i => ({ ...i, family_id: `${t.id}-one` })))
  check('many questions from one family are one independent question, not many', !planRehearsal(sameFam, TOPICS).ready && planRehearsal(sameFam, TOPICS).familiesByTopic.eq === 1)
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
