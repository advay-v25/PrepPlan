/** FSA bank: `npm run fsa:lint | fsa:load | fsa:verify`. Rules live in scripts/lib/bankLoader.ts. */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { cli, type BankConfig, type Outcome } from './lib/bankLoader'
import { FSA_ITEMS } from './lib/fsaBank/all'

// FSA readings r027–r038 are Learning Modules 1–12 of the 2027 FSA volume. Outcomes come from the database
// (reading_los), which is the structure the rest of the app already uses.
async function outcomes() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data: readings, error } = await db.from('curriculum_readings').select('id, title, reading_no').eq('topic_id', 'fsa').order('reading_no'); if (error) throw new Error(error.message)
  const { data: los, error: e2 } = await db.from('reading_los').select('id, reading_id, code, title, sequence').in('reading_id', readings!.map(r => r.id)).order('id'); if (e2) throw new Error(e2.message)
  const first = Math.min(...readings!.map(r => Number(r.reading_no)))
  const byId = new Map(readings!.map(r => [r.id as string, r]))
  return new Map<string, Outcome>(los!.map(l => { const r = byId.get(l.reading_id as string)!; return [l.id as string, { id: l.id as string, readingId: r.id as string, readingTitle: r.title as string, readingNo: Number(r.reading_no) - first + 1, code: l.code as string, title: l.title as string }] }))
}

export const config: BankConfig = {
  prefix: 'q-fsa', seed: 20270213, topic: 'FSA', cellTopic: 'Financial Statement Analysis',
  items: FSA_ITEMS, outcomes, reportPath: 'docs/FSA-BANK-VERIFICATION.json',
  provenance: o => `Original item mapped to 2027 CFAI FSA Module ${o.readingNo} LOS ${o.code}`,
}
if (process.argv[1]?.includes('load-fsa-bank')) cli(config).catch(e => { console.error(e); process.exit(1) })
