import assert from 'node:assert/strict'
import { normalizePersonName } from '../src/lib/auth/personName'
for (const [input, expected] of [
  ['  Ananya   Rao ', 'Ananya Rao'],
  ['E\u0301lodie 刘', 'Élodie 刘'],
  ['आदित्य शिंदे', 'आदित्य शिंदे'],
  ['𐐀', '𐐀'],
  ['Anne-Marie', 'Anne-Marie'],
  ["O'Brien", "O'Brien"],
  ['O’Brien', 'O’Brien'],
  ['Jean-Luc  Picard', 'Jean-Luc Picard'],
  ['Mary-Jane O’Neil-Smith', 'Mary-Jane O’Neil-Smith'],
] as const) assert.equal(normalizePersonName(input), expected)
for (const input of ['', 'Name2', '-Anne', 'Anne-', "'Brien", "O'", 'Anne--Marie', "O''Brien", "O'-Brien", 'Anne - Marie', 'Anne -Marie', 'A-', '-', "'", '<name>', 'A\nB', 'A\n', 'A\u200b', 'A😀', '\u0301A', 'Anne‐Marie', 'O‘Brien', 'A'.repeat(101)]) {
  assert.equal(normalizePersonName(input), null)
}
console.log('name validation cases passed')
