/** Student-facing assessment, Home and Coach copy must never state a pass prediction, a readiness percentage or an on-track verdict. Static scan; nothing is rendered. */
import fs from 'node:fs'
import path from 'node:path'

const roots = ['src/components/tests', 'src/components/diagnostic', 'src/components/home', 'src/components/coach', 'src/app/app/tests', 'src/app/app/coach', 'src/lib/tests', 'src/lib/coach']
const BANNED: [string, RegExp][] = [
  ['pass prediction', /\b(?:probability|chance|likelihood) of passing\b|\bpass(?:ing)? (?:probability|prediction|rate)\b|\bpredicted (?:pass|score)\b/i],
  ['pass promise', /\b(?:you(?:'ll| will)|likely to|on track to|guaranteed to) pass\b/i],
  ['readiness verdict', /\byou(?:'re| are) (?:exam[- ])?ready\b|\bexam[- ]ready\b|\b\d{1,3}\s?%\s*(?:ready|likely)\b|\bready for the exam\b/i],
]
const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : /\.(tsx?|md)$/.test(e.name) && files.push(p) } }
roots.filter(r => fs.existsSync(r)).forEach(walk)
let failed = 0
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // A rule that FORBIDS the phrase (the Coach reply validator, comments saying never to) is not a claim.
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\bRULES\b|readiness_claim|\['[a-z_]+', \//.test(line) || /Never an? |never |does not affect your readiness|\bnot (?:a |an )?[^.]{0,60}(?:prediction|promise|probability)|\bdo not (?:state|claim|predict)|\bno pass /i.test(line)) return
    for (const [name, re] of BANNED) if (re.test(line)) { failed++; console.log(`  ✗ ${f}:${i + 1} ${name}: ${line.trim().slice(0, 120)}`) }
  })
}
console.log(`${files.length} files scanned`)
if (failed) { console.log(`\n0 passed, ${failed} failed`); process.exit(1) }
console.log('  ✓ no pass prediction, pass promise or readiness verdict in student-facing assessment, Home or Coach copy\n\n1 passed, 0 failed')
