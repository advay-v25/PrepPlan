import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { selectRevision, type RevisionReading } from '../src/lib/curriculum/revisionQueue'
import { revisionStatusForEntry } from '../src/lib/curriculum/revisionOverview'
import { describeRevision } from '../src/lib/planning/weeklyReview/service'
import { RevisionRotation } from '../src/components/review/RevisionRotation'

const reading: RevisionReading = {
  id: 'r032', name: 'Inventories', topic: 'fsa', topicName: 'FSA', coverage: 'studied', uncertainty: null,
  outcomeActivity: [null], reportedCurrent: false, evidence: { repair: 0, verify: 0, maintain: 0, untested: 1, latestAt: null },
  scheduled: false, continuing: false, repairOverlap: false, history: { lastPlannedAt: null, lastDeclinedAt: null },
}
const selection = selectRevision({ readings: [reading], phase: 'consolidation', now: new Date('2026-11-25T12:00:00Z'), weekStart: '2026-11-23', limit: 3, bridge: true })
assert.equal(selection.elsewhere[0].state, 'waiting')
assert.equal(revisionStatusForEntry(selection.elsewhere[0].state), 'held', 'a held reading has no current task')
assert.equal(revisionStatusForEntry('in_plan'), 'in_plan')
assert.equal(revisionStatusForEntry('repair'), 'repair')
const preview = describeRevision({ ...selection, phase: 'consolidation', limit: 3, placed: [] })!
assert.deepEqual(preview.bridge, { justified: 0, held: 1, tested: 0, selfReported: 0 })
const html = renderToStaticMarkup(<RevisionRotation revision={preview} />)
assert.match(html, /first pass is recorded as finished/)
assert.match(html, /No targeted revision is indicated/)
assert.match(html, /Held for broader revision/)
assert.match(html, /\/app\/curriculum\/fsa\/r032/)
assert.doesNotMatch(html, /No revision fits|already covered/)
console.log('PASS revision presentation: held status, bridge counts, honest no-concern wording and exact reading link')
