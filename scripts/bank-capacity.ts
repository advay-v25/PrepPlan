/**
 * Read-only content capacity: npx tsx scripts/bank-capacity.ts [--json] [--concepts]
 * Candidates, automatic passes, quarantine, exact-version approvals and independent families are separate; "servable" uses the serving rules.
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getCapacityReport, capacitySummary } from '../src/lib/tests/capacityReport'

getCapacityReport().then(r => {
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); return }
  console.log(capacitySummary(r).join('\n'))
  console.log('\nBy subject: candidates raw/auto · approved routine/held-out · confirmed families routine/held-out · outcomes below depth')
  for (const t of r.topics) console.log(`  ${t.id.padEnd(6)} ${String(t.raw).padStart(4)}/${String(t.autoPass).padEnd(4)} · ${t.approvedRoutine}/${t.approvedHeldOut} · ${t.familiesRoutine}/${t.familiesHeldOut} · ${t.outcomesBelowDepth}/${t.outcomes}`)
  console.log(`\nMock limiting topics: ${r.serving.mock.limitingTopics.map(l => `${l.topic} ${l.families}/${l.wanted}`).join(', ') || 'none'}`)
  if (process.argv.includes('--concepts')) for (const c of r.concepts.filter(c => c.missingCells.length).slice(0, 40)) console.log(`  ${c.name}: ${c.missingCells.join('; ')}`)
}).catch(e => { console.error(`UNAVAILABLE (this is not zero): ${e.message}`); process.exit(2) })
