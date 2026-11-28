import type { BankItem } from '../bankLoader'
import type { NumericSpec } from '../bankNumeric'
type Wrong = [text: string, reason: string]
/** Local authoring only. These labels are proposals; no reviewer confirmation or family independence is inferred. */
export const q = (o: string, t: BankItem['t'], stem: string, answer: string, a: Wrong, b: Wrong, solution: string): BankItem => ({
  o, t, q: stem, ok: answer, c: t === 'E' ? 'interpret' : t === 'H' ? 'integrate' : 'apply', f: t === 'E' ? 'direct' : 'scenario',
  w: [[a[0], 'C', a[1]], [b[0], 'M', b[1]]], sol: solution,
})
export const n = (o: string, t: BankItem['t'], stem: string, vars: Record<string, number>, key: string, fmt: NumericSpec['fmt'], a: Wrong, b: Wrong, solution: string): BankItem => ({
  o, t, q: stem, c: 'calculate', f: 'calculation', num: { vars, key, fmt, vf: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Number.isInteger(v) ? 'n0' : 'n2'])) }, w: [[a[0], 'F', a[1]], [b[0], 'I', b[1]]], sol: solution,
})
