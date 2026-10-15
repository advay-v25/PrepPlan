/**
 * Gives the ten 2027 Ethics readings (r093–r102) a real outcome structure.
 *
 *   npx tsx scripts/seed-ethics-structure.ts
 *
 * Outcomes follow the Code of Ethics / Standards of Professional Conduct rather than the generic
 * "demonstrate, recommend, identify" learning-outcome trio that repeats on every Standards module: one
 * outcome per Standard sub-section (I(A) … VII(B)) means a miss on a test points at a specific Standard,
 * which is what a repair task can act on. Titles are original wording. Pages are the printed page
 * numbers from the volume's contents. Idempotent (upserts by id).
 *
 * This is a structure decision, not a content one: it is editable here and re-runnable.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

import { ETHICS } from './lib/ethicsBank/structure'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const modules = ETHICS.map((r, i) => ({ id: `${r.id}-m1`, reading_id: r.id, module_no: r.no, title: r.title, start_page: 1, sequence: 1 }))
  const los = ETHICS.flatMap(r => r.los.map(([code, title, page], i) => ({ id: `${r.id}-${code}`, reading_id: r.id, module_id: `${r.id}-m1`, code, title, page, sequence: i + 1 })))
  const m = await admin.from('reading_modules').upsert(modules, { onConflict: 'id' }); if (m.error) throw new Error(m.error.message)
  const l = await admin.from('reading_los').upsert(los, { onConflict: 'id' }); if (l.error) throw new Error(l.error.message)
  const r = await admin.from('curriculum_readings').update({ structure_pending: false }).in('id', ETHICS.map(x => x.id)); if (r.error) throw new Error(r.error.message)
  console.log(`Ethics structured: ${modules.length} modules, ${los.length} outcomes; structure_pending cleared for ${ETHICS.length} readings.`)
}
main().catch(e => { console.error(e); process.exit(1) })
