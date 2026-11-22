import { nearMatches, similarity } from '../src/lib/diagnostic/nearMatch'
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const a = { id: 'a', stem: 'Revenue is $500,000 and COGS is $320,000. The gross profit margin is closest to:', options: ['36.0%', '64.0%', '56.0%'] }
const figures = { id: 'b', stem: 'Revenue is $900,000 and COGS is $410,000. The gross profit margin is closest to:', options: ['54.4%', '45.6%', '58.0%'] }
const reworded = { id: 'c', stem: 'Sales were $620,000 with cost of goods sold of $300,000. What is the gross profit margin, closest to:', options: ['51.6%', '48.4%', '40.0%'] }
const other = { id: 'd', stem: 'A bond pays a semiannual coupon. Which statement about its duration is most likely correct?', options: ['It rises with maturity', 'It is unaffected by coupon', 'It equals maturity'] }
ok('new figures on the same construction score as close', similarity(a, figures) >= 0.7, similarity(a, figures))
console.log('   reworded similarity', similarity(a, reworded).toFixed(2), 'unrelated', similarity(a, other).toFixed(2))
ok('a reworded sibling is still surfaced as a hint', nearMatches(a, [reworded, other]).some(m => m.id === 'c'))
ok('an unrelated question is not surfaced', !nearMatches(a, [other]).length)
ok('the item itself is excluded', !nearMatches(a, [a, figures]).some(m => m.id === 'a'))
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
