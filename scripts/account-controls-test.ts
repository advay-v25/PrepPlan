/** Pure checks: requesting-session authentication evidence, reminder patch validation, export manifest shape. */
import { sessionAuthenticatedAt, isRecentSessionAuth } from '../src/lib/auth/recentAuth'
import { OWNED_TABLES, PARENT_OWNED } from '../src/lib/account/export'

let p = 0, f = 0
const ok = (n: string, c: boolean, d = '') => { c ? (p++, console.log('  ✓', n)) : (f++, console.log('  ✗', n, d)) }
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const now = new Date('2026-11-14T12:00:00Z'), at = (min: number) => Math.floor((now.getTime() - min * 60_000) / 1000)

ok('a session that authenticated 2 minutes ago is recent', isRecentSessionAuth(jwt({ iat: at(1), amr: [{ method: 'otp', timestamp: at(2) }] }), now))
ok('a session that authenticated an hour ago is NOT recent even though the token was just refreshed (iat is new, amr is old)', !isRecentSessionAuth(jwt({ iat: at(0), amr: [{ method: 'password', timestamp: at(60) }] }), now))
ok('another device signing in cannot help: only THIS token\'s methods count (account last_sign_in_at is never read)', !isRecentSessionAuth(jwt({ iat: at(0), amr: [{ method: 'password', timestamp: at(45) }] }), now))
ok('a token with no authentication-method evidence is not recent', !isRecentSessionAuth(jwt({ iat: at(0) }), now) && !isRecentSessionAuth('garbage', now) && !isRecentSessionAuth(null, now))
ok('the newest method counts (a re-authentication after the first sign-in)', isRecentSessionAuth(jwt({ amr: [{ method: 'password', timestamp: at(120) }, { method: 'otp', timestamp: at(3) }] }), now))
ok('a timestamp from the future is not trusted', !isRecentSessionAuth(jwt({ amr: [{ method: 'otp', timestamp: at(-30) }] }), now))
ok('an old password authentication followed by a recent token_refresh is NOT recent', !isRecentSessionAuth(jwt({ amr: [{ method: 'password', timestamp: at(60) }, { method: 'token_refresh', timestamp: at(1) }] }), now))
ok('anonymous and unknown methods never count', !isRecentSessionAuth(jwt({ amr: [{ method: 'anonymous', timestamp: at(1) }, { method: 'mystery', timestamp: at(1) }, { timestamp: at(1) }] }), now))
ok('each supported provider method counts when recent (password, otp, magiclink, oauth, totp, sso/saml)', ['password', 'otp', 'magiclink', 'oauth', 'totp', 'sso/saml'].every(m => isRecentSessionAuth(jwt({ amr: [{ method: m, timestamp: at(2) }] }), now)))
ok('the authentication instant is reported exactly', sessionAuthenticatedAt(jwt({ amr: [{ method: 'otp', timestamp: at(5) }] }))?.toISOString() === '2026-11-14T11:55:00.000Z')
ok('every export table has a non-empty paging key; parent tables name their parent', Object.values(OWNED_TABLES).every(k => k.length > 0) && PARENT_OWNED.every(c => c.key.length > 0 && c.parent in OWNED_TABLES))
console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0)
