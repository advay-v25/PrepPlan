/**
 * Canonical bank audit: npx tsx scripts/bank-audit.ts  (writes docs/BANK-COVERAGE-2027.md). Reads ONLY getCapacityReport, the same reader behind bank:capacity,
 * so this document, the reviewer counts and the app's availability use one eligibility rule. A failed read stops with "UNAVAILABLE"; it never writes zeros.
 * Per-student freshness (items a student has already seen) is NOT in this global report; preflight shows it per student and labels it.
 */
import { writeFileSync } from 'fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getCapacityReport, capacitySummary, MIN_FAMILIES_PER_OUTCOME } from '../src/lib/tests/capacityReport'
import { createAdminClient } from '../src/lib/supabase/admin'
import { readAll } from '../src/lib/supabase/readAll'

async function main() {
  const r = await getCapacityReport()
  const admin = createAdminClient()
  const [rd, lo] = await Promise.all([
    readAll<{ id: string; reading_no: number; title: string }>((a, z) => admin.from('curriculum_readings').select('id, reading_no, title').order('id').range(a, z)),
    readAll<{ id: string; code: string }>((a, z) => admin.from('reading_los').select('id, code').order('id').range(a, z)),
  ])
  const title = new Map(rd.map(x => [x.id, `Reading ${x.reading_no}: ${x.title}`]))
  void lo
  const L: string[] = ['# 2027 question bank coverage', '',
    `Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/bank-audit.ts\` from the canonical capacity reader (\`getCapacityReport\`). Candidate, automatically checked, quarantined, approved and family counts are separate columns and are never added together.`,
    'Only items in the exact-version eligibility views count as approved. A status label, an automatic PASS or a difficulty label is not publication. Per-student freshness is not global and is not shown here.', '',
    ...capacitySummary(r).map(l => `- ${l}`), '',
    '## By subject', '', `| Subject | Raw | Auto-checked | Quarantined | Approved routine | Approved held-out | Families routine/held-out | Outcomes below ${MIN_FAMILIES_PER_OUTCOME}-family depth |`, '|---|---:|---:|---:|---:|---:|---:|---:|']
  for (const t of r.topics) L.push(`| ${t.name} | ${t.raw} | ${t.autoPass} | ${t.quarantined} | ${t.approvedRoutine} | ${t.approvedHeldOut} | ${t.familiesRoutine}/${t.familiesHeldOut} | ${t.outcomesBelowDepth} of ${t.outcomes} |`)
  L.push('', '## By reading (paper-ready means enough approved routine items for an ordinary paper)', '', '| Reading | Raw | Approved routine | Families | Outcomes below depth | Paper-ready |', '|---|---:|---:|---:|---:|:-:|')
  for (const x of r.readings.filter(x => x.raw || x.approvedRoutine || x.approvedHeldOut)) L.push(`| ${title.get(x.id) ?? x.id} | ${x.raw} | ${x.approvedRoutine} | ${x.familiesRoutine} | ${x.outcomesBelowDepth} of ${x.outcomes} | ${x.servable ? 'yes' : 'no'} |`)
  L.push('', `Readings with no candidate and no approved item are omitted from this table (${r.readings.filter(x => !(x.raw || x.approvedRoutine || x.approvedHeldOut)).length} of ${r.readings.length}); use \`npm run bank:matrix\` for the full topic → reading → outcome → concept matrix.`)
  writeFileSync('docs/BANK-COVERAGE-2027.md', L.join('\n') + '\n')
  console.log(capacitySummary(r).join('\n')); console.log('\nWritten to docs/BANK-COVERAGE-2027.md')
}
main().catch(e => { console.error(`UNAVAILABLE (this is not zero): ${e.message}`); process.exit(2) })
