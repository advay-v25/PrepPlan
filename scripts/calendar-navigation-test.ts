import assert from 'node:assert/strict'
import { calendarTaskHref, calendarSelectionHref, findCalendarTask } from '../src/lib/routing/calendar'

const href = new URL(calendarTaskHref('task/with ? punctuation', '2026-10-13'), 'https://roadmap.test')
assert.equal(href.pathname, '/app/calendar')
assert.equal(href.searchParams.get('task'), 'task/with ? punctuation')
assert.equal(href.searchParams.get('week'), '2026-10-13')
assert.equal(href.searchParams.get('view'), 'agenda')

const opened = new URL(calendarSelectionHref('week=2026-10-12&view=week', 'repair-1'), 'https://roadmap.test')
assert.equal(opened.searchParams.get('week'), '2026-10-12')
assert.equal(opened.searchParams.get('view'), 'week')
assert.equal(opened.searchParams.get('task'), 'repair-1')
assert.equal(calendarSelectionHref(opened.search.slice(1), null), '/app/calendar?week=2026-10-12&view=week')
assert.equal(calendarSelectionHref('task=old', null), '/app/calendar')
assert.equal(new URL(calendarSelectionHref('task=old', 'new'), 'https://roadmap.test').searchParams.get('task'), 'new')

const entries = [
  { id: 'task-1', isTask: true, revision: 1 },
  { id: 'class-1', isTask: false, revision: 1 },
]
assert.equal(findCalendarTask(entries, 'task-1')?.id, 'task-1')
assert.equal(findCalendarTask(entries, 'class-1'), null)
assert.equal(findCalendarTask(entries, 'missing-or-another-account'), null)
assert.equal(findCalendarTask(entries, null), null)
assert.equal(findCalendarTask([{ ...entries[0], revision: 2 }], 'task-1')?.revision, 2)
console.log('Calendar navigation: encoded IDs, retained week/view, close, missing task, commitments and fresh revisions passed.')
