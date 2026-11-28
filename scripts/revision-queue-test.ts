/**
 * Maintenance and targeted revision as one derived queue: the pure selection policy, on fixed dates.
 * Asserts which readings are chosen, why, and how that changes from week to week as activity is (or is not) recorded.
 * Nothing here reads a database; the live loop is exercised by e2e-revision.ts.
 */
import {
  candidateFor, intervalDays, recencyOf, REVISION_ASSUMPTIONS, rotationKey, selectRevision, type RevisionReading,
} from '../src/lib/curriculum/revisionQueue'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const NOW = new Date('2026-11-02T09:00:00Z')
const day = (offset: number, from = NOW) => new Date(from.getTime() + offset * 86_400_000).toISOString()
const weekStart = (w: number) => new Date(NOW.getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10)
const TOPICS = ['ethics', 'quant', 'econ', 'fsa']
const reading = (id: string, topic: string, o: Partial<RevisionReading> = {}): RevisionReading => ({
  id, name: `Reading ${id}`, topic, topicName: topic.toUpperCase(), coverage: 'studied', uncertainty: null,
  outcomeActivity: [null, null, null, null], reportedCurrent: false,
  evidence: { repair: 0, verify: 0, maintain: 0, untested: 4, latestAt: null }, scheduled: false, continuing: false, repairOverlap: false,
  history: { lastPlannedAt: null, lastDeclinedAt: null }, ...o,
})
/** Three covered readings in each of four subjects. */
const library = (o: (id: string, topic: string) => Partial<RevisionReading> = () => ({})) =>
  TOPICS.flatMap((t, ti) => [1, 2, 3].map(k => { const id = `r${ti}${k}`; return reading(id, t, o(id, t)) }))
const select = (readings: RevisionReading[], w = 0, limit = 3, phase: 'first_pass' | 'consolidation' | 'revision' | 'final' = 'first_pass', now = NOW) =>
  selectRevision({ readings, phase, now, weekStart: weekStart(w), limit })

console.log('\n1. Midway through the first pass, nothing flagged: maintenance still returns')
{
  const s = select(library())
  check('three readings are chosen for maintenance', s.selected.length === 3 && s.selected.every(e => e.kind === 'maintenance'))
  check('each says why: no activity date is recorded, which is unknown rather than forgotten', s.selected.every(e => e.reasons.some(r => /unknown, not forgotten/.test(r))))
  check('and none of them is described as a test result', s.selected.every(e => !/forgot(ten)? it|failed/i.test(e.reasons.join(' '))))
  const partly = library((id) => ({ coverage: id === 'r01' ? 'taught' : 'studied' }))
  check('a partly covered reading is first-pass work, not a revision candidate', !select(partly, 0, 12).selected.some(e => e.readingId === 'r01'))
  check('verified readings stay eligible for maintenance (strong evidence does not exclude)', select(library(() => ({ coverage: 'verified' })), 0, 12).selected.length === 12)
}

console.log('\n2. Unknown recency is explicit, neither zero nor forgotten')
{
  const unknown = reading('u', 'fsa')
  check('source is unknown with no day count', recencyOf(unknown, NOW, 21).source === 'unknown' && recencyOf(unknown, NOW, 21).days === null)
  const c = candidateFor(unknown, { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, null)
  check('it counts as exactly due (1 interval), not zero', c.parts.dueness === REVISION_ASSUMPTIONS.unknownDueness)
  const old = candidateFor(reading('o', 'fsa', { outcomeActivity: [day(-60), day(-60), day(-60), day(-60)] }), { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 60)
  const fresh = candidateFor(reading('f', 'fsa', { outcomeActivity: [day(-1), day(-1), day(-1), day(-1)] }), { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 1)
  check('ranks above something revisited yesterday, below something long overdue', fresh.score < c.score && c.score < old.score, `${fresh.score} < ${c.score} < ${old.score}`)
  const reported = recencyOf(reading('c', 'fsa', { reportedCurrent: true }), NOW, 21)
  check('working on it now at onboarding is reported, carries NO date, and is not recency', reported.source === 'reported' && reported.days === null && reported.at === null)
  const rc = candidateFor(reading('c', 'fsa', { reportedCurrent: true }), { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, null)
  check('so it counts as unknown (exactly due), never as recently studied, and says so', rc.parts.dueness === REVISION_ASSUMPTIONS.unknownDueness && rc.reasons.some(r => /no study date/.test(r)))
  check('recorded activity wins over a report', recencyOf(reading('c', 'fsa', { reportedCurrent: true, outcomeActivity: [day(-2), null, null, null] }), NOW, 21).source === 'recorded')
}

console.log('\n2b. Activity dates keep what they are')
{
  const logged = reading('l', 'fsa', { outcomeActivity: [day(-7), day(-7), day(-7), day(-7)], newestActivityKind: 'study_date' })
  const l = candidateFor(logged, { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 7)
  check('studied seven days ago (logged today) is seven days old, from the study date', l.recency.days === 7 && l.recency.provenance === 'study_date' && l.reasons.some(r => /7 days ago \(the study date you logged\)/.test(r)))
  const done = candidateFor(reading('d', 'fsa', { outcomeActivity: [day(0), day(0), day(0), day(0)], newestActivityKind: 'recorded' }), { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 0)
  check('completed today with no study date uses the completion record and says so', done.recency.days === 0 && done.recency.provenance === 'recorded' && done.reasons.some(r => /today \(when you marked it done\)/.test(r)))
  check('the study date makes it overdue sooner than completion-today would', l.parts.dueness > done.parts.dueness)
  const none = candidateFor(reading('n', 'fsa'), { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, null)
  check('no reliable date is unknown, with no provenance', none.recency.source === 'unknown' && none.recency.provenance === null)
}

console.log('\n3. Rotation: equal readings take turns instead of the lowest-numbered always winning')
{
  const firsts = new Set<string>()
  for (let w = 0; w < 8; w++) firsts.add(select(library(), w).selected[0].readingId)
  check('the leading pick changes across weeks of identical candidates', firsts.size >= 3, [...firsts].join(','))
  check('the lowest id is not simply first every week', ![0, 1, 2, 3, 4, 5, 6, 7].every(w => select(library(), w).selected[0].readingId === 'r01'))
  check('the same week gives the same answer twice (preview equals acceptance)', JSON.stringify(select(library(), 3).selected.map(e => e.readingId)) === JSON.stringify(select(library(), 3).selected.map(e => e.readingId)))
  check('the rotation key is stable', rotationKey('r12', '2026-11-02') === rotationKey('r12', '2026-11-02'))
  const planned = library(id => ({ history: { lastPlannedAt: id === 'r01' || id === 'r02' ? '2026-10-26' : null, lastDeclinedAt: null } }))
  check('readings never planned before come ahead of readings planned recently, all else equal', !select(planned, 0, 3).selected.some(e => ['r01', 'r02'].includes(e.readingId)))
  const [rotatesFirst, rotatesSecond] = ['a', 'b'].sort((a, b) => rotationKey(a, weekStart(0)) - rotationKey(b, weekStart(0)))
  const tied = [
    reading(rotatesFirst, 'fsa', { history: { lastPlannedAt: '2026-10-26', lastDeclinedAt: null } }),
    reading(rotatesSecond, 'econ'),
  ]
  check('fitting only one of two equal candidates still picks the one never planned', select(tied, 0, 2).selected[0]?.readingId === rotatesSecond)
}

console.log('\n4. Several covered subjects rotate over successive cycles, and history changes the selection')
{
  // Each week's chosen readings are completed with every outcome confirmed on the Wednesday.
  const activity = new Map<string, string[]>()
  const seenByWeek: string[][] = []
  for (let w = 0; w < 6; w++) {
    const when = new Date(NOW.getTime() + (w * 7 + 2) * 86_400_000)
    const s = select(library(id => ({ outcomeActivity: activity.get(id) ?? [null, null, null, null] })), w, 4, 'consolidation', new Date(NOW.getTime() + w * 7 * 86_400_000))
    seenByWeek.push(s.selected.map(e => e.readingId))
    for (const e of s.selected) activity.set(e.readingId, [when.toISOString(), when.toISOString(), when.toISOString(), when.toISOString()])
  }
  const firstThree = new Set(seenByWeek.slice(0, 3).flat())
  check('twelve readings, four per week: three weeks reach every reading once', firstThree.size === 12, `${firstThree.size}`)
  check('a reading completed last week is not chosen again the following week', seenByWeek.slice(1).every((ids, i) => ids.every(id => !seenByWeek[i].includes(id))))
  check('week four rests while the last round is still recent; rotation resumes when it is due', seenByWeek[3].length === 0 && seenByWeek.slice(4).every(ids => ids.length === 4))
  check('every subject appears in every week of the first three (no subject is starved)', seenByWeek.slice(0, 3).every(ids => new Set(ids.map(i => `t${i[1]}`)).size >= 2))
}

{
  const narrow = reading('chapter-one', 'fsa', {
    outcomeActivity: [day(-24), day(-10)],
    outcomeEvidence: [{ band: 'verify', checkedAt: day(-24) }, null],
    evidence: { repair: 0, verify: 1, maintain: 0, untested: 1, latestAt: day(-24) },
  })
  check('an older narrow check can prompt recall before routine first-pass spacing', select([narrow]).selected[0]?.readingId === narrow.id)
  const recalled = { ...narrow, outcomeActivity: [day(-1), day(-1)] }
  const rest = select([recalled])
  check('subsequent recall postpones the next session without refreshing the check', rest.selected.length === 0
    && rest.waiting[0]?.reasons.some(reason => reason.includes('earlier check is now old')))
}

console.log('\n5. Missed and partial work')
{
  const base = library()
  const week1 = select(base, 0, 3).selected.map(e => e.readingId)
  // Scheduled but never done: no activity is recorded, so nothing about the reading changes.
  const week2 = select(library(id => ({ history: { lastPlannedAt: week1.includes(id) ? weekStart(0) : null, lastDeclinedAt: null } })), 1, 3, 'first_pass', new Date(NOW.getTime() + 7 * 86_400_000))
  const missed = candidateFor(reading('m', 'fsa', { history: { lastPlannedAt: weekStart(0), lastDeclinedAt: null } }), { phase: 'first_pass', now: NOW, weekStart: weekStart(1) }, null)
  check('a missed revision leaves recency unknown (scheduling alone refreshes nothing)', missed.recency.source === 'unknown' && missed.parts.dueness === 1)
  check('it stays eligible; the rotation moves to readings not yet offered rather than abandoning it', week2.selected.every(e => !week1.includes(e.readingId)) && week2.waiting.length + week2.selected.length >= 9)
  const declined = candidateFor(reading('d', 'fsa', { history: { lastPlannedAt: weekStart(0), lastDeclinedAt: '2026-11-01' } }), { phase: 'first_pass', now: NOW, weekStart: weekStart(1) }, null)
  check('a reading the student removed is offered later, not nagged straight away, and is not marked forgotten or mastered', declined.parts.cooldown < 0 && declined.recency.source === 'unknown' && !/(?<!not )forgotten|mastered/i.test(declined.reasons.join(' ')))

  const partial = reading('p', 'fsa', { outcomeActivity: [day(-2), day(-2), null, null] })
  const done = reading('q', 'fsa', { outcomeActivity: [day(-2), day(-2), day(-2), day(-2)] })
  const cp = candidateFor(partial, { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 2)
  const cq = candidateFor(done, { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 2)
  check('partial work refreshes only the confirmed outcomes (2 of 4)', cp.recency.refreshedOutcomes === 2 && cp.recency.totalOutcomes === 4)
  check('the unconfirmed half keeps the reading partly due', cp.parts.dueness > cq.parts.dueness && cp.parts.dueness > 0.4)
  check('and the explanation says only part was confirmed', cp.reasons.some(r => /covers 2 of 4 outcomes; the rest are untouched/.test(r)))
}

console.log('\n6. Continuation, overlap and repairs: one obligation, never two')
{
  const readings = library(id => ({ continuing: id === 'r01', scheduled: id === 'r02', repairOverlap: id === 'r03' }))
  const s = select(readings, 0, 12)
  check('a continuing reading is not selected again', !s.selected.some(e => e.readingId === 'r01') && s.elsewhere.some(e => e.readingId === 'r01' && e.state === 'continuing'))
  check('a reading with a live task in the week is not selected again', !s.selected.some(e => e.readingId === 'r02') && s.elsewhere.some(e => e.readingId === 'r02' && e.state === 'in_plan'))
  check('a reading owned by an open repair keeps the repair and gets no second block', !s.selected.some(e => e.readingId === 'r03') && s.elsewhere.some(e => e.readingId === 'r03' && e.state === 'repair'))
  check('each says where the obligation already lives', s.elsewhere.every(e => (e.waitingReason ?? '').length > 20))
  check('the other nine remain selectable', s.selected.length === 9)
}

console.log('\n7. Strong evidence rests only the scope it supports, and never removes the reading')
{
  const act = [day(-30), day(-30), day(-30), day(-30)]
  const sec = (age: number) => ({ band: 'maintain' as const, checkedAt: day(-age) })
  const wholly = (age: number) => reading('s', 'fsa', { outcomeActivity: act, evidence: { repair: 0, verify: 0, maintain: 4, untested: 0, latestAt: day(-age) }, outcomeEvidence: [sec(age), sec(age), sec(age), sec(age)] })
  const plain = reading('n', 'fsa', { outcomeActivity: act })
  const opts = { phase: 'consolidation' as const, now: NOW, weekStart: weekStart(0) }
  const none = candidateFor(plain, opts, 30)
  const rest = candidateFor(wholly(5), opts, 30)
  check('a reading whose every outcome is secure and recent rests (half urgency)', rest.parts.dueness < none.parts.dueness && Math.abs(rest.parts.dueness - none.parts.dueness / 2) < 0.02)
  check('older secure evidence no longer rests it: as urgent as any other, still eligible', candidateFor(wholly(60), opts, 30).parts.dueness === none.parts.dueness && select([wholly(5)], 0, 3, 'consolidation').eligible === 1)

  // Secure on two outcomes, the other two untested: only the supported half rests.
  const subset = reading('p', 'fsa', { outcomeActivity: act, evidence: { repair: 0, verify: 0, maintain: 2, untested: 2, latestAt: day(-3) }, outcomeEvidence: [sec(3), sec(3), null, null] })
  const cs = candidateFor(subset, opts, 30)
  check('secure scope on a subset reduces only that scope: untested outcomes keep full urgency', cs.parts.dueness > rest.parts.dueness && cs.parts.dueness < none.parts.dueness && Math.abs(cs.parts.dueness - none.parts.dueness * 0.75) < 0.02, `${cs.parts.dueness} vs ${none.parts.dueness}`)
  check('and the reading is not described as secure overall: it names the split', cs.reasons.some(r => /Of 4 outcomes here, 2 secure and recent .*2 untested/.test(r)) && !cs.reasons.some(r => /Your recent questions here were secure/.test(r)))

  // Mixed ages: one recent, one older secure, one unsteady, one untested.
  const mixed = reading('m', 'fsa', { outcomeActivity: act, evidence: { repair: 0, verify: 1, maintain: 2, untested: 1, latestAt: day(-3) }, outcomeEvidence: [sec(3), sec(60), { band: 'verify', checkedAt: day(-2) }, null] })
  const cm = candidateFor(mixed, opts, 30)
  check('mixed ages: only the recent secure outcome rests; the old one does not borrow its freshness', Math.abs(cm.parts.dueness - none.parts.dueness * (0.5 + 1 + 1 + 1) / 4) < 0.02, `${cm.parts.dueness}`)
  check('the unsteady outcome raises priority in proportion to its share, not for the whole reading', cm.parts.evidence > 0 && cm.parts.evidence < 0.75 && Math.abs(cm.parts.evidence - 0.75 / 4) < 0.01)
  check('all four kinds stay visible in the explanation', /1 secure and recent/.test(cm.evidenceNote ?? '') && /1 secure but older/.test(cm.evidenceNote ?? '') && /1 need a fresh look/.test(cm.evidenceNote ?? '') && /1 untested/.test(cm.evidenceNote ?? ''), cm.evidenceNote ?? '')
  check('nothing says forgotten or failed', !/(?<!not )forgotten|failed/i.test(cm.reasons.join(' ')))
  check('a reading with evidence only at reading level (no per-outcome detail) gets NO reduction: conservative', candidateFor(reading('c', 'fsa', { outcomeActivity: act, evidence: { repair: 0, verify: 0, maintain: 4, untested: 0, latestAt: day(-2) } }), opts, 30).parts.dueness === none.parts.dueness)
}

console.log('\n8. Reported uncertainty gets priority without taking every later week')
{
  const flagged = (id: string, t: string): Partial<RevisionReading> => (t === 'fsa' ? { uncertainty: { level: 'most', assumed: false } } : {})
  const many = TOPICS.flatMap((t, ti) => Array.from({ length: t === 'fsa' ? 8 : 3 }, (_, k) => reading(`r${ti}${k + 1}`, t, flagged('', t))))
  const first = select(many, 0, 4)
  check('flagged readings lead', first.selected[0].topic === 'fsa' && first.selected[0].kind === 'targeted')
  check('but a subject takes at most half the places while others have candidates', first.selected.filter(e => e.topic === 'fsa').length <= 2, `${first.selected.map(e => e.readingId)}`)
  check('the other places go to other subjects', first.selected.some(e => e.topic !== 'fsa'))
  const short = select(many, 0, 8).selected.slice(0, 4)
  check('a shorter placement still gets uncertain work first and makes room for another subject', short[0].topic === 'fsa' && short.filter(e => e.topic === 'fsa').length <= 2)
  const recentElsewhere = many.map(r => r.topic === 'fsa' ? r : { ...r, outcomeActivity: [day(-1), day(-1), day(-1), day(-1)] })
  check('subject variety cannot promote recently revised work ahead of due work', select(recentElsewhere, 0, 8).selected.slice(0, 2).every(e => e.topic === 'fsa'))
  // Four weeks of completing exactly what is chosen.
  const act = new Map<string, string[]>()
  let fsaWeeks = 0, otherTopics = new Set<string>()
  for (let w = 0; w < 4; w++) {
    const now = new Date(NOW.getTime() + w * 7 * 86_400_000)
    const s = selectRevision({ readings: many.map(r => ({ ...r, outcomeActivity: act.get(r.id) ?? r.outcomeActivity })), phase: 'consolidation', now, weekStart: weekStart(w), limit: 4 })
    if (s.selected.some(e => e.topic === 'fsa')) fsaWeeks++
    s.selected.filter(e => e.topic !== 'fsa').forEach(e => otherTopics.add(e.topic))
    const when = new Date(now.getTime() + 2 * 86_400_000).toISOString()
    for (const e of s.selected) act.set(e.readingId, [when, when, when, when])
  }
  check('the uncertain subject appears in the weeks but other subjects also keep appearing', fsaWeeks >= 1 && otherTopics.size >= 3)
  const targetedAfter = candidateFor({ ...many[0], uncertainty: { level: 'most', assumed: false }, outcomeActivity: [day(-1), day(-1), day(-1), day(-1)] }, { phase: 'consolidation', now: NOW, weekStart: weekStart(0) }, 1)
  check('just revised, a flagged reading yields: the flag no longer outranks everything', targetedAfter.parts.reported < 0.5)
  check('the flag is still its reason, labelled self-reported', targetedAfter.reasons[0].includes('self-reported'))
}

console.log('\n9. Phase, checkpoint and limits')
{
  check('intervals tighten as the exam approaches', intervalDays('first_pass', null) > intervalDays('consolidation', null) && intervalDays('consolidation', null) > intervalDays('revision', null) && intervalDays('revision', null) > intervalDays('final', null))
  check('a mock within three weeks shortens them', intervalDays('revision', 10) < intervalDays('revision', null) && intervalDays('revision', 40) === intervalDays('revision', null))
  check('the assumptions are labelled as planning assumptions in one place', typeof REVISION_ASSUMPTIONS.targetedIntervalDays === 'number')
  const s = select(library(), 0, 0)
  check('a limit of zero selects nothing and loses nothing', s.selected.length === 0 && s.waiting.length === 12)
  const waiting = select(library(), 0, 3)
  check('everything not chosen is listed as waiting with a reason', waiting.waiting.length === 9 && waiting.waiting.every(w => !!w.waitingReason))
  const noEvidence = select(library(), 0, 3)
  check('readings with no reviewed questions are still selected (diagnostic coverage is a separate matter)', noEvidence.selected.length === 3 && noEvidence.selected.every(e => e.evidenceNote === 'No reviewed-question evidence yet, so revision is guided by activity only'))
}

console.log('\n9. Weakness-only bridge after first pass')
{
  const lib = library((id) => id === 'r01' ? { evidence: { repair: 0, verify: 2, maintain: 0, untested: 2, latestAt: null } } : id === 'r12' ? { uncertainty: { level: 'several', assumed: false } as RevisionReading['uncertainty'] } : {})
  const b = selectRevision({ readings: lib, phase: 'consolidation', now: NOW, weekStart: weekStart(0), limit: 8, bridge: true })
  check('only the tested weakness and the self-reported reading are chosen', b.selected.map(e => e.readingId).sort().join() === 'r01,r12', b.selected.map(e => e.readingId).join())
  check('the rest are held for broader revision and not called weaknesses', b.bridge?.held === 10 && b.elsewhere.filter(e => /Held for broader revision/.test(e.waitingReason ?? '')).length === 10)
  check('the bridge reports tested and self-reported reasons separately', b.bridge?.tested === 1 && b.bridge?.selfReported === 1)
  const none = selectRevision({ readings: library(), phase: 'consolidation', now: NOW, weekStart: weekStart(0), limit: 8, bridge: true })
  check('with no tested or reported reason nothing is invented: the week keeps its room', none.selected.length === 0 && none.bridge?.justified === 0 && none.bridge?.held === 12)
  const broad = selectRevision({ readings: library(), phase: 'revision', now: NOW, weekStart: weekStart(0), limit: 3 })
  check('outside the bridge routine rotation still applies', broad.selected.length === 3 && broad.bridge === undefined)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
