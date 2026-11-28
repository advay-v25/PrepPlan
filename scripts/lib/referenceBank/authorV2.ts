import type { BankItem } from '../bankLoader'
import type { NumericSpec } from '../bankNumeric'
import type { Cognition, ErrorCode, ItemForm } from '../../../src/lib/diagnostic/types'

export type PoolIntent = 'routine' | 'held_out_mock' | 'evaluation'

export type AuthoredItemV2 = BankItem & {
  difficultyRationale: string
  poolIntent: PoolIntent
  familyHint?: string
}

type WrongCoded = [textOrExpr: string, code: ErrorCode, reason: string]

export function itemQ(
  o: string,
  t: BankItem['t'],
  c: Cognition,
  f: ItemForm,
  q: string,
  ok: string,
  w1: WrongCoded,
  w2: WrongCoded,
  sol: string,
  difficultyRationale: string,
  poolIntent: PoolIntent = 'routine',
  familyHint?: string
): AuthoredItemV2 {
  return { o, t, c, f, q, ok, w: [w1, w2], sol, difficultyRationale, poolIntent, familyHint }
}

export function itemN(
  o: string,
  t: BankItem['t'],
  c: Cognition,
  f: ItemForm,
  q: string,
  vars: Record<string, number>,
  key: string,
  fmt: NumericSpec['fmt'],
  w1: WrongCoded,
  w2: WrongCoded,
  sol: string,
  difficultyRationale: string,
  poolIntent: PoolIntent = 'routine',
  familyHint?: string
): AuthoredItemV2 {
  return {
    o,
    t,
    c,
    f,
    q,
    num: {
      vars,
      key,
      fmt,
      vf: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Number.isInteger(v) ? 'n0' : 'n2'])),
    },
    w: [w1, w2],
    sol,
    difficultyRationale,
    poolIntent,
    familyHint,
  }
}
