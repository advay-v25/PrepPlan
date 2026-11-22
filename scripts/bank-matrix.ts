/**
 * Capability matrix: npx tsx scripts/bank-matrix.ts [--json] [--topic fsa]
 * topic → reading → outcome → concept, from the canonical capacity reader plus the source-pack directory (read-only; no private extract is printed).
 * Columns: pack (exact id) · concept sign-off · mapping · raw / auto-checked / quarantined · approved routine / held-out · independent families routine / held-out.
 */
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getCapacityReport } from '../src/lib/tests/capacityReport'
import { loadSourcePacks, selectPack, SOURCE_PACK_DIR } from '../src/lib/diagnostic/sourcePacks'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
getCapacityReport().then(r => {
  const packs = loadSourcePacks(SOURCE_PACK_DIR), only = arg('topic')
  const rows = r.outcomes.filter(o => !only || o.topicId === only).map(o => {
    const cs = r.concepts.filter(c => o.conceptIds.includes(c.conceptId))
    const pack = cs.map(c => selectPack(packs, o.id, c.conceptId)).find(Boolean) ?? selectPack(packs, o.id, '')
    return { topic: o.topicId, reading: o.readingId, outcome: o.id, concepts: cs.length, signedOff: cs.filter(c => c.verified).length, exact: cs.filter(c => c.exactMapping).length,
      pack: pack ? `${pack.packId}@${pack.version} (${pack.rights.state})` : null, raw: o.raw, autoPass: o.autoPass, quarantined: o.quarantined, approvedRoutine: o.approvedRoutine, approvedHeldOut: o.approvedHeldOut, familiesRoutine: o.familiesRoutine, familiesHeldOut: o.familiesHeldOut }
  })
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ manifest: r.manifest, packsLoaded: packs.length, rows }, null, 1)); return }
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, x) => a + Number(x[k] ?? 0), 0)
  console.log(`Edition ${r.manifest.year} ${r.manifest.version} · ${rows.length} outcomes · ${packs.length} source pack(s) in ${SOURCE_PACK_DIR}`)
  console.log(`outcomes with a pack ${rows.filter(x => x.pack).length} · with a signed-off concept ${rows.filter(x => x.signedOff).length} · with an exact mapping ${rows.filter(x => x.exact).length} · raw ${sum('raw')} · approved routine ${sum('approvedRoutine')} · held-out ${sum('approvedHeldOut')}`)
  for (const x of rows.filter(x => x.pack || x.raw || x.approvedRoutine || x.approvedHeldOut)) console.log(`  ${x.topic.padEnd(5)} ${x.outcome.slice(0, 8)} concepts ${x.concepts} signed ${x.signedOff} exact ${x.exact} pack ${x.pack ?? '—'} · raw ${x.raw}/${x.autoPass}/${x.quarantined} · approved ${x.approvedRoutine}/${x.approvedHeldOut} · families ${x.familiesRoutine}/${x.familiesHeldOut}`)
}).catch(e => { console.error(`UNAVAILABLE (this is not zero): ${e.message}`); process.exit(2) })
