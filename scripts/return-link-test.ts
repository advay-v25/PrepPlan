/** Return links stay inside /app AFTER normalisation (owner repro: '/app/../account' and '/app/%2e%2e/account' both used to return '/account'). */
import assert from 'node:assert/strict'
import { safeInAppReturn } from '../src/lib/curriculum/workspaceIndex'
import { safeNextPath } from '../src/lib/auth/redirect'
let n = 0; const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`) }
ok('RED reference: the previous prefix-then-normalise check really escaped /app', () => {
  const legacy = (v: string) => { if (!/^\/app(\/|\?|$)/.test(v) || v.startsWith('//') || v.includes('\\')) return null; const u = new URL(v, 'http://x.invalid'); return `${u.pathname}${u.search}` }
  assert.equal(legacy('/app/../account'), '/account'); assert.equal(legacy('/app/%2e%2e/account'), '/account')
})
ok('dot-segment escapes are refused (plain and encoded)', () => { for (const v of ['/app/../account', '/app/%2e%2e/account', '/app/%2E%2E/account', '/app/./../account', '/app/curriculum/../../account', '/app/a/%2e%2e%2faccount', '/app/..%2faccount']) assert.equal(safeInAppReturn(v), null, v) })
ok('protocols, hosts, protocol-relative, backslash and control characters are refused', () => { for (const v of ['https://evil.example/app', '//evil.example/app', '/\\evil.example', '/app\\..\\x', 'javascript:alert(1)', '/app/x\nSet-Cookie:a=b', '/app/\u0000', '/app/x%0d%0ay', '/appx', 'app/x', '']) assert.equal(safeInAppReturn(v), null, JSON.stringify(v)) })
ok('the API is never a destination', () => { for (const v of ['/app/api/tasks', '/app/api']) assert.equal(safeInAppReturn(v), null) })
ok('over-long and non-string values are refused', () => { assert.equal(safeInAppReturn('/app/' + 'a'.repeat(300)), null); for (const v of [null, undefined, 5, {}, ['/app']]) assert.equal(safeInAppReturn(v as any), null) })
ok('legitimate app returns keep their path and query', () => {
  for (const v of ['/app', '/app/curriculum', '/app/curriculum?f=covered&q=cash', '/app/curriculum?view=notes&q=duration', '/app/tests/0b6c1a5e-5b53-4a6c-9d0e-1b6f3a1c2d3e/result', '/app/calendar?view=agenda&week=2027-01-04&task=task-1', '/app/curriculum/fsa/r028?tab=cards&los=r028-1']) assert.equal(safeInAppReturn(v), v, v)
})
ok('auth callbacks keep a local path after normalisation, including paths that become protocol-relative', () => {
  for (const value of ['//outside.example', '/step/..//outside.example', '/step/%2e%2e//outside.example', '/\\outside.example', '/\t/outside.example']) {
    assert.equal(safeNextPath(value, '/onboarding'), '/onboarding', value)
  }
  assert.equal(safeNextPath('/onboarding/exam?returnTo=%2Fapp%2Fexam'), '/onboarding/exam?returnTo=%2Fapp%2Fexam')
  assert.equal(safeNextPath('/update-password'), '/update-password')
})
console.log(`${n} passed, 0 failed`)
