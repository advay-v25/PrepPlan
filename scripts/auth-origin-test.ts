/** The live site redirects apex to www, so sign-in from either form of the configured host must be accepted, and nothing else. */
import assert from 'node:assert/strict'
import { appRequestRefusal, authOrigin } from '../src/lib/auth/requestSecurity'
import { needsPassword } from '../src/lib/auth/passwordState'
const req = (origin: string, host: string) => new Request(`https://${host}/api/auth`, { method: 'POST', headers: { origin, host, 'content-type': 'application/json' } })
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'production'
let n = 0; const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ✓ ${name}`) }
for (const configured of ['https://prepplan.si', 'https://www.prepplan.si']) {
  env.NEXT_PUBLIC_SITE_URL = configured
  ok(`configured ${configured}: both apex and www are accepted`, () => {
    assert.equal(appRequestRefusal(req('https://prepplan.si', 'prepplan.si')), null)
    assert.equal(appRequestRefusal(req('https://www.prepplan.si', 'www.prepplan.si')), null)
  })
  ok(`configured ${configured}: another host, another scheme and a lookalike are refused`, () => {
    assert.equal(appRequestRefusal(req('https://evil.example', 'prepplan.si'))?.status, 403)
    assert.equal(appRequestRefusal(req('http://www.prepplan.si', 'www.prepplan.si'))?.status, 403)
    assert.equal(appRequestRefusal(req('https://www.prepplan.si.evil.example', 'www.prepplan.si.evil.example'))?.status, 403)
    assert.equal(authOrigin(req('https://evil.example', 'evil.example')), configured)
  })
}
ok('a Google-only account must add a password; email accounts and accounts that added one must not', () => {
  assert.equal(needsPassword({ app_metadata: { providers: ['google'] }, user_metadata: {} }), true)
  assert.equal(needsPassword({ app_metadata: { providers: ['email'] }, user_metadata: {} }), false)
  assert.equal(needsPassword({ app_metadata: { providers: ['email', 'google'] }, user_metadata: {} }), false)
  assert.equal(needsPassword({ app_metadata: { providers: ['google'] }, user_metadata: { password_set: true } }), false)
  assert.equal(needsPassword({ app_metadata: {}, user_metadata: {} }), true)
})
console.log(`${n} passed, 0 failed`)
