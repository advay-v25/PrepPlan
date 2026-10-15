/** Ethics bank: `npm run ethics:lint | ethics:load | ethics:verify`. Rules live in scripts/lib/bankLoader.ts. */
import { cli, type BankConfig, type BankItem, type Outcome } from './lib/bankLoader'
import { ETHICS } from './lib/ethicsBank/structure'
import ITEMS_JSON from './lib/ethicsBank/items.json'

export const config: BankConfig = {
  prefix: 'q-eth', conceptSeed: 'ethics-concept', seed: 20270112, topic: 'Ethics', cellTopic: 'Ethical and Professional Standards',
  items: ITEMS_JSON as unknown as BankItem[],
  reportPath: 'docs/ETHICS-BANK-VERIFICATION.json',
  provenance: o => `Original item mapped to 2027 CFAI Ethics Module ${o.readingNo} LOS ${o.code}`,
  outcomes: async () => new Map<string, Outcome>(ETHICS.flatMap(r => r.los.map(([code, title, page]) =>
    [`${r.id}-${code}`, { id: `${r.id}-${code}`, readingId: r.id, readingTitle: r.title, readingNo: Number(r.id.slice(1)) - 92, code, title, note: `Page ${page} of the 2027 Ethics volume.` }] as [string, Outcome]))),
}
if (process.argv[1]?.includes('load-ethics-bank')) cli(config).catch(e => { console.error(e); process.exit(1) })
