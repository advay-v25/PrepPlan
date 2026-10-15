import { isTutoringRequest } from '../src/lib/coach/policy'

const cases: Array<[string, boolean]> = [
  ['Teach me the entire FSA chapter', true],
  ['Solve this question for me', true],
  ['Walk me through the subject', true],
  ['What should I study next?', false],
  ['Why did I miss income statement questions?', false],
  ['Help me recover this week after missing two classes', false],
]
let failed = 0
for (const [message, expected] of cases) {
  const actual = isTutoringRequest(message)
  if (actual !== expected) failed++
  console.log(`${actual === expected ? '✓' : '✗'} ${message}`)
}
console.log(`${cases.length - failed} passed, ${failed} failed`)
if (failed) process.exit(1)
