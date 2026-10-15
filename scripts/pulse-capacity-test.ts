/**
 * Real capacity math — exact start/end ranges, not a per-slot guess (spec §0, §3.1 item 2).
 */
import { minutesBetween, subtractOverlaps } from '../src/lib/planning/pulse/capacity'

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const eq = (n: string, a: unknown, b: unknown) => check(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\nCapacity math\n')

eq('two-hour window', minutesBetween('07:00', '09:00'), 120)
eq('fifteen-minute window (was indistinguishable from a two-hour one before this fix)', minutesBetween('07:00', '07:15'), 15)

eq('no overlap: window unchanged', subtractOverlaps({ start: '18:00', end: '21:00' }, []), [{ start: '18:00', end: '21:00' }])
eq('overlap removes a bite from the middle', subtractOverlaps({ start: '18:00', end: '21:00' }, [{ start: '19:00', end: '19:30' }]),
  [{ start: '18:00', end: '19:00' }, { start: '19:30', end: '21:00' }])
eq('overlap covering the whole window empties it', subtractOverlaps({ start: '18:00', end: '19:00' }, [{ start: '17:00', end: '20:00' }]), [])
eq('overlap at the edge trims one side', subtractOverlaps({ start: '18:00', end: '21:00' }, [{ start: '20:00', end: '22:00' }]),
  [{ start: '18:00', end: '20:00' }])

eq('multiple blocks in one window (sequential subtraction)', subtractOverlaps({ start: '08:00', end: '20:00' }, [{ start: '10:00', end: '11:00' }, { start: '14:00', end: '15:00' }]),
  [{ start: '08:00', end: '10:00' }, { start: '11:00', end: '14:00' }, { start: '15:00', end: '20:00' }])
eq('overlap at start (block begins before window, ends partway through)', subtractOverlaps({ start: '18:00', end: '21:00' }, [{ start: '16:00', end: '19:00' }]),
  [{ start: '19:00', end: '21:00' }])

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
