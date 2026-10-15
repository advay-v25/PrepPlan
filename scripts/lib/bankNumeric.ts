import { create, all } from 'mathjs'

/**
 * Numeric items are authored as formulas, not typed numbers: the key and every distractor are COMPUTED, so the
 * arithmetic cannot be mistyped, and each distractor is literally "the answer you get if you make error X".
 * The independent verifier then re-derives the key from the stem alone.
 *
 * Templates: {name} inserts a value formatted with vf[name] (default n0); {name:fmt} overrides the format.
 */
const math = create(all, {})
const evalMath = math.evaluate.bind(math)

export type Fmt = 'usd0' | 'usd2' | 'usdm1' | 'pct1' | 'pct2' | 'n0' | 'n1' | 'n2' | 'x2'

const group = (n: number, d: number) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export function fmtValue(v: number, f: Fmt): string {
  switch (f) {
    case 'usd0': return `$${group(v, 0)}`
    case 'usd2': return `$${group(v, 2)}`
    case 'usdm1': return `$${group(v, 1)} million`
    case 'pct1': return `${group(v, 1)}%`
    case 'pct2': return `${group(v, 2)}%`
    case 'n0': return group(v, 0)
    case 'n1': return group(v, 1)
    case 'n2': return group(v, 2)
    case 'x2': return `${group(v, 2)}x`
  }
}
const DECIMALS: Record<Fmt, number> = { usd0: 0, usd2: 2, usdm1: 1, pct1: 1, pct2: 2, n0: 0, n1: 1, n2: 2, x2: 2 }

export type NumericSpec = {
  vars: Record<string, number>
  /** Named intermediate values, evaluated in order and available to key/distractor expressions and templates. */
  calc?: Record<string, string>
  /** Display formats for variables and intermediates in the stem and solution. */
  vf?: Record<string, Fmt>
  key: string
  fmt: Fmt
}

/** Names mathjs treats as keywords, constants or functions. Authors may use them as variables; they are aliased here. */
const RESERVED = new Set(['end', 'e', 'i', 'pi', 'inv', 'int', 'sum', 'mean', 'max', 'min', 'abs', 'det', 'size', 'log', 'exp', 'norm', 'round', 'sign', 'mod', 'xor', 'not', 'and', 'or', 'to', 'in', 'true', 'false', 'null', 'x', 'y'])
const alias = (n: string) => (RESERVED.has(n) && n !== 'max' && n !== 'min' && n !== 'abs' && n !== 'round' ? `v_${n}` : n)

export function renderNumeric(spec: NumericSpec, wrongExprs: string[], templates: string[]) {
  const names = [...Object.keys(spec.vars), ...Object.keys(spec.calc ?? {})]
  const rewrite = (expr: string) => names.reduce((x, n) => (alias(n) === n ? x : x.replace(new RegExp(`\\b${n}\\b`, 'g'), alias(n))), expr)
  const scope: Record<string, number> = {}
  for (const [k, v] of Object.entries(spec.vars)) scope[alias(k)] = v
  for (const [k, expr] of Object.entries(spec.calc ?? {})) scope[alias(k)] = evalMath(rewrite(expr), scope)
  const round = (v: number) => Number(v.toFixed(DECIMALS[spec.fmt]))
  const keyVal = round(evalMath(rewrite(spec.key), scope))
  const wrongVals = wrongExprs.map(ex => round(evalMath(rewrite(ex), scope)))
  const all = [keyVal, ...wrongVals]
  if (new Set(all).size !== all.length || all.some(v => !Number.isFinite(v))) throw new Error(`options not distinct/finite after rounding: ${all.join(', ')}`)
  scope.ans = keyVal
  const fill = (t: string) => t.replace(/\{(\w+)(?::(\w+))?\}/g, (_, name: string, f?: string) => {
    const k = alias(name)
    if (!(k in scope)) throw new Error(`template uses unknown name {${name}}`)
    return fmtValue(scope[k], (f as Fmt) ?? spec.vf?.[name] ?? (name === 'ans' ? spec.fmt : 'n0'))
  })
  return { keyText: fmtValue(keyVal, spec.fmt), wrongTexts: wrongVals.map(v => fmtValue(v, spec.fmt)), texts: templates.map(fill), scope }
}
