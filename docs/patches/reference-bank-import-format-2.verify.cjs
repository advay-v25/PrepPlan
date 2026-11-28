/** Candidate importer against disposable local databases: both formats import; every invalid file leaves nothing behind. */
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict')
const root = process.argv[2], mod = require(path.join(__dirname, 'b/scripts/reference-bank-import.cjs'))
const { openStage } = require(path.join(root, 'scripts/lib/stage.cjs')), { Client } = require(path.join(root, 'node_modules/pg'))
const load = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const current = () => load('output/question-bank/2027/draft-bank.json'), legacy = () => load('output/question-bank/2027/baseline-2026-11-25/draft-bank.json')
const TABLES = ['assessment_items', 'item_batches', 'item_batch_cells', 'item_families', 'curriculum_concepts', 'concept_outcome_map']
let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; console.log(`  ✓ ${name}`) }
;(async () => {
  for (const [label, bank] of [['format .2 (current file)', current()], ['format .1 (25 Nov baseline)', legacy()]]) {
    const stage = await openStage(['--local']), c = new Client(stage.cfg.connection); await c.connect()
    try {
      const count = async t => Number((await c.query(`select count(*) n from public.${t}`)).rows[0].n)
      const snapshot = async () => Object.fromEntries(await Promise.all([]).then(async () => { const out = []; for (const t of TABLES) out.push([t, await count(t)]); return out }))
      const empty = await snapshot()
      const refuse = async (name, mutate) => { const b = structuredClone(bank); mutate(b); await assert.rejects(() => mod.ingest(c, b)); ok(`${label}: refused, nothing written · ${name}`, JSON.stringify(await snapshot()) === JSON.stringify(empty)) }
      const last = b => b.items[b.items.length - 1]
      const rehash = i => { i.contentHash = mod.hashItem(i) }
      await refuse('unknown format', b => { b.schema = 'reference-draft-bank.3' })
      await refuse('not quarantined', b => { b.status = 'PUBLISHED' })
      await refuse('empty items', b => { b.items = [] })
      await refuse('content edited after hashing (last item)', b => { last(b).draft.stem += ' x' })
      await refuse('published flag (last item)', b => { last(b).published = true })
      await refuse('human sign-off claimed (last item)', b => { last(b).mapping.signOff = 'signed' })
      await refuse('duplicate id', b => { b.items.push(structuredClone(b.items[0])) })
      await refuse('wrong outcome mapping on the LAST item, after earlier inserts', b => { const i = last(b); i.outcomeId = 'nonexistent'; rehash(i) })
      await refuse('database constraint failure on the LAST item', b => { const i = last(b); i.draft.keyIndex = 2; i.draft.card = { ...i.draft.card, itemForm: 'not-a-form', cognition: 'nope' }; rehash(i) })
      await refuse('family shared by unrelated items', b => { b.items[1].familyProposal.id = b.items[0].familyProposal.id; b.items[1].familyHint = 'other' })
      if (bank.schema.endsWith('.2')) {
        await refuse('held-out flag disagrees with pool intent', b => { b.items.find(i => i.heldOut).heldOut = false })
        await refuse('missing source pack', b => { delete last(b).packFactsHash })
      } else await refuse('held-out item in format .1', b => { last(b).heldOut = true })
      const first = await mod.ingest(c, bank), second = await mod.ingest(c, bank)
      ok(`${label}: imports ${first.inserted} drafts`, first.inserted === bank.items.length)
      ok(`${label}: a retry inserts nothing`, second.inserted === 0 && second.preserved === bank.items.length)
      const q = async sql => Number((await c.query(sql)).rows[0].n)
      ok(`${label}: every row is a draft, none eligible`, await q("select count(*) n from public.assessment_items where review_status='draft'") === bank.items.length && await q('select count(*) n from public.student_eligible_items') === 0 && await q('select count(*) n from public.rehearsal_eligible_items') === 0)
      const held = bank.items.filter(i => i.heldOut).length, families = new Set(bank.items.map(i => i.familyProposal.id)).size
      ok(`${label}: ${held} held-out drafts kept apart; ${families} provisional families, none confirmed; 0 review decisions`, await q('select count(*) n from public.assessment_items where held_out') === held && await q('select count(*) n from public.item_families') === families && await q("select count(*) n from public.item_families where construction_status<>'provisional'") === 0 && await q('select count(*) n from public.item_review_decisions') === 0)
      const changed = structuredClone(bank); changed.items[0].draft.stem += ' Changed.'; changed.items[0].contentHash = mod.hashItem(changed.items[0])
      const after = await snapshot()
      await assert.rejects(() => mod.ingest(c, changed), /Existing item differs/)
      ok(`${label}: changed content never overwrites`, JSON.stringify(await snapshot()) === JSON.stringify(after))
    } finally { await c.end(); await stage.stop() }
  }
  console.log(`\n${n} checks passed`)
})().catch(e => { console.error(e.message.slice(0, 600)); process.exit(1) })
