/**
 * Seeds the 2027 curriculum spine from data/curriculum-2027/*.json.
 * Idempotent (upserts by id). Ethics readings are seeded as `structure_pending`
 * (title and pages only) until the founder specifies their structure.
 *
 *   npx tsx scripts/seed-curriculum-2027.ts
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

type Reading = { n: number; title: string; modules: [string, string, number][]; los: [string, string, number][] }
type Subject = { id: string; name: string; readings: Reading[] }

const DIR = join(process.cwd(), 'data/curriculum-2027')
// The last reading of each Schweser volume has no following reading to measure against.
const LAST_IN_VOLUME_PAGES: Record<number, number> = { 26: 6, 50: 11, 79: 9, 102: 12 }
// Old learning modules whose evidence maps directly onto a new reading.
const LEGACY: Record<number, string[]> = { 27: ['fsa-intro'], 28: ['fsa-income'], 29: ['fsa-balance'] }
const OLD_TOTAL_EFFORT = 189 // keep the overall syllabus load unchanged

const band = (pages: number) => (pages <= 4 ? 1 : pages <= 8 ? 2 : pages <= 14 ? 3 : 4)

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const desc = JSON.parse(readFileSync(join(DIR, 'descriptions.json'), 'utf8')) as Record<string, [string, string]>

  const rows: { subject: string; reading: Reading; pages: number; index: number }[] = []
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'descriptions.json').sort()) {
    const subjects = (JSON.parse(readFileSync(join(DIR, f), 'utf8')).subjects ?? []) as Subject[]
    const all = subjects.flatMap(s => s.readings.map(r => ({ subject: s.id, reading: r })))
    all.sort((a, b) => a.reading.n - b.reading.n)
    all.forEach((x, i) => {
      const next = all[i + 1]
      const pages = LAST_IN_VOLUME_PAGES[x.reading.n] ?? (next ? next.reading.modules[0][2] - x.reading.modules[0][2] : 0)
      if (pages <= 0) throw new Error(`No page count for reading ${x.reading.n}`)
      rows.push({ subject: x.subject, reading: x.reading, pages, index: 0 })
    })
  }
  rows.sort((a, b) => a.reading.n - b.reading.n)
  const perSubject = new Map<string, number>()
  for (const r of rows) { const i = (perSubject.get(r.subject) ?? 0) + 1; perSubject.set(r.subject, i); r.index = i }

  const totalPages = rows.reduce((s, r) => s + r.pages, 0)
  const k = OLD_TOTAL_EFFORT / totalPages

  const readings = rows.map(r => {
    const pending = r.subject === 'eth'
    const d = desc[String(r.reading.n)]
    return {
      id: `r${String(r.reading.n).padStart(3, '0')}`, reading_no: r.reading.n, topic_id: r.subject, title: r.reading.title,
      sequence: r.index, start_page: r.reading.modules[0][2], page_count: r.pages,
      effort_units: Math.round(r.pages * k * 100) / 100, effort_band: band(r.pages),
      summary: pending ? null : d?.[0] ?? null, relevance: pending ? null : d?.[1] ?? null,
      structure_pending: pending, legacy_module_ids: LEGACY[r.reading.n] ?? [],
    }
  })
  let r = await admin.from('curriculum_readings').upsert(readings, { onConflict: 'id' })
  if (r.error) throw new Error(`readings: ${r.error.message}`)

  const modules: any[] = [], los: any[] = []
  for (const x of rows) {
    if (x.subject === 'eth') continue
    const rid = `r${String(x.reading.n).padStart(3, '0')}`
    x.reading.modules.forEach(([no, title, page], i) => modules.push({
      id: `${rid}-m${no.split('.')[1]}`, reading_id: rid, module_no: no, title, start_page: page, sequence: i + 1,
    }))
    x.reading.los.forEach(([code, title, page], i) => {
      const mod = [...x.reading.modules].reverse().find(m => m[2] <= page) ?? x.reading.modules[0]
      los.push({ id: `${rid}-${code}`, reading_id: rid, module_id: `${rid}-m${mod[0].split('.')[1]}`, code, title, page, sequence: i + 1 })
    })
  }
  const m = await admin.from('reading_modules').upsert(modules, { onConflict: 'id' })
  if (m.error) throw new Error(`modules: ${m.error.message}`)
  const l = await admin.from('reading_los').upsert(los, { onConflict: 'id' })
  if (l.error) throw new Error(`los: ${l.error.message}`)

  // Existing test concepts -> the outcome they evidence (name match; approximate = judgement call).
  const MAP: [string, string, boolean][] = [
    ['Roles of Financial Reporting and Analysis', 'r027-b', false],
    ['Required Financial Statements', 'r027-a', true],
    ['Current Assets and Quick Ratio', 'r029-e', true],
    ['Asset Impairment under IFRS', 'r033-b', false],
    ['Revenue Recognition 5-Step Model', 'r028-a', false],
    ['Expense Recognition and Inventory Cost Flow', 'r028-b', false],
    ['Depreciation and Amortisation Methods', 'r028-b', true],
    ['Non-Recurring Items and Discontinued Operations', 'r028-c', false],
    ['Basic EPS and Weighted Average Shares', 'r028-d', false],
    ['Diluted EPS and Anti-Dilutive Securities', 'r028-d', false],
    ['Gross Profit, Operating Profit and Margin Analysis', 'r028-e', true],
    ['Common-Size Income Statement Analysis', 'r028-e', false],
  ]
  const { data: concepts } = await admin.from('curriculum_concepts').select('id, name')
  const cmap = MAP.flatMap(([name, outcome, approximate]) => {
    const c = (concepts ?? []).filter(x => x.name === name)
    return c.map(x => ({ concept_id: x.id as string, outcome_id: outcome, approximate }))
  })
  const cm = await admin.from('concept_outcome_map').upsert(cmap, { onConflict: 'concept_id' })
  if (cm.error) throw new Error(`concept map: ${cm.error.message}`)

  console.log(`Mapped ${cmap.length} concepts to outcomes. Seeded ${readings.length} readings (${readings.filter(x => x.structure_pending).length} structure-pending), ${modules.length} modules, ${los.length} outcomes. Total pages ${totalPages}, effort/page ${k.toFixed(4)}.`)
}
main().catch(e => { console.error(e); process.exit(1) })
