/**
 * Versioned Coach evaluation. Runs scripts/coach-eval/cases.json against the VERIFIED path (intent, proposals, links, reply) and the
 * model boundary (validation of simulated provider output), records failures by case in results/<promptVersion>.json so the next
 * prompt revision can be compared on the same examples. Offline: no provider is called.
 *   npm run coach:eval
 */
import fs from 'node:fs'
import path from 'node:path'
import { classifyIntent, deterministicReply, planLinks, planProposals, type CoachSituation } from '../src/lib/coach/actions'
import { modelReply, type Provider } from '../src/lib/coach/model'
import { makeGateway } from '../src/lib/coach/modelGateway'
import { buildCoachContext, COACH_PROMPT_VERSION } from '../src/lib/coach/response'

const dir = path.join(process.cwd(), 'scripts', 'coach-eval')
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'))
const base: CoachSituation = { intent: 'free', today: '2026-09-21', todayOpen: [], repairs: [], cycle: { start: '2026-09-21', end: '2026-09-27' }, load: {}, paper: 'none', closing: false }

type Result = { id: string; category: string; passed: boolean; failures: string[] }
async function main() {
  const results: Result[] = []
  for (const c of spec.cases) {
    const failures: string[] = []
    const intent = classifyIntent(c.message)
    const s: CoachSituation = { ...base, ...(c.situation ?? {}), intent }
    const { proposals, notes } = planProposals(s)
    const links = planLinks(s)
    let reply = deterministicReply(s, 'Insufficient evidence', notes, proposals)
    const e = c.expect ?? {}
    if (e.intent && intent !== e.intent) failures.push(`intent ${intent} != ${e.intent}`)
    if (e.noProposal && proposals.length) failures.push('proposed a change')
    if (e.proposal && proposals[0]?.kind !== e.proposal) failures.push(`expected proposal ${e.proposal}`)
    if (e.movesCount !== undefined && (proposals[0]?.changes as any)?.moves?.length !== e.movesCount) failures.push('wrong number of moves')
    if (e.stays !== undefined && (proposals[0]?.changes as any)?.staysDue?.length !== e.stays) failures.push('wrong number of stays-due')
    for (const l of e.links ?? []) if (!links.some(x => x.href === l)) failures.push(`missing link ${l}`)

    if (c.model) {
      const provider: Provider = async ({ signal }) => {
        if (c.model.throws) throw new Error('503 upstream')
        if (c.model.delayMs) await new Promise((res, rej) => { const t = setTimeout(res, c.model.delayMs); signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })) }) })
        return c.model.raw ?? ''
      }
      const ctx = buildCoachContext(s, 'Insufficient evidence', { proposals: proposals.map(p => p.title), links: links.map(l => l.label) }, [])
      const gateway = makeGateway({ reserve: async () => ({ ok: true, callId: 1 }), settle: async () => {} })
      const out = await modelReply({ ctx, history: [], message: c.message, provider, gateway, timeoutMs: c.model.timeoutMs ?? 1000 })
      const rejected = out.reply === null
      if (e.modelRejected !== undefined && rejected !== e.modelRejected) failures.push(`model ${rejected ? 'rejected' : 'accepted'} (${out.reason}); expected ${e.modelRejected ? 'rejected' : 'accepted'}`)
      if (e.modelReason && out.reason !== e.modelReason) failures.push(`reason ${out.reason} != ${e.modelReason}`)
      if (out.reply) reply = out.reply
    }
    for (const t of e.reply ?? []) if (!reply.includes(t)) failures.push(`reply lacks "${t}"`)
    for (const t of e.replyForbids ?? []) if (reply.toLowerCase().includes(String(t).toLowerCase())) failures.push(`reply contains "${t}"`)
    results.push({ id: c.id, category: c.category, passed: failures.length === 0, failures })
  }
  const failed = results.filter(r => !r.passed)
  const outDir = path.join(dir, 'results'); fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${COACH_PROMPT_VERSION}.json`), JSON.stringify({ promptVersion: COACH_PROMPT_VERSION, casesVersion: spec.version, total: results.length, passed: results.length - failed.length, failed: failed.map(f => ({ id: f.id, category: f.category, failures: f.failures })) }, null, 1))
  for (const r of results) console.log(`  ${r.passed ? '✓' : '✗'} [${r.category}] ${r.id}${r.passed ? '' : ' — ' + r.failures.join('; ')}`)
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed (prompt ${COACH_PROMPT_VERSION})`)
  if (failed.length) process.exit(1)
}
main()
