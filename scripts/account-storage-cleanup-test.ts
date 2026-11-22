/** Pure: owned-storage cleanup against an in-memory Storage fake (folders, nesting, >1 page, partial failure + retry, other students' objects). */
import { removeOwnedStorage } from '../src/lib/account/storageCleanup'
let p = 0, f = 0
const ok = (n: string, c: boolean, d = '') => { c ? (p++, console.log('  ✓', n)) : (f++, console.log('  ✗', n, d)) }

function fake(paths: string[], o: { failRemoveAfter?: number; failListUnder?: string; buckets?: string[] } = {}) {
  const store = new Map<string, Set<string>>(); for (const b of o.buckets ?? ['b1']) store.set(b, new Set(paths))
  let removedCalls = 0
  const api = {
    listBuckets: async () => ({ data: [...store.keys()].map(name => ({ name })), error: null }),
    from: (b: string) => ({
      list: async (dir: string, { limit, offset }: { limit: number; offset: number }) => {
        if (o.failListUnder && dir.startsWith(o.failListUnder)) return { data: null, error: { message: 'boom' } }
        const kids = new Map<string, boolean>()   // name -> isObject
        for (const x of store.get(b)!) if (x.startsWith(`${dir}/`)) { const rest = x.slice(dir.length + 1), i = rest.indexOf('/'); kids.set(i < 0 ? rest : rest.slice(0, i), i < 0) }
        const rows = [...kids].sort(([a], [c]) => a.localeCompare(c)).slice(offset, offset + limit).map(([name, obj]) => ({ name, id: obj ? `id-${name}` : null }))
        return { data: rows, error: null }
      },
      remove: async (ps: string[]) => { if (o.failRemoveAfter !== undefined && removedCalls++ >= o.failRemoveAfter) return { error: { message: 'boom' } }; for (const x of ps) store.get(b)!.delete(x); return { error: null } },
    }),
  }
  return { api, store }
}
const U = 'user-1', V = 'user-2'
const many = Array.from({ length: 250 }, (_, i) => `${U}/bulk/f${String(i).padStart(3, '0')}.txt`)
const mine = [`${U}/a.txt`, `${U}/docs/b.txt`, `${U}/docs/deep/c.txt`, `${U}/docs/deep/deeper/d.txt`, ...many]
const theirs = [`${V}/keep.txt`, `${V}/docs/keep2.txt`, `${U}x/lookalike.txt`, 'loose.txt']

;(async () => {
  let t = fake([...mine, ...theirs])
  let r = await removeOwnedStorage(U, t.api as never)
  ok('nested folders and more than one page are all removed', r.ok && r.removed === mine.length && ![...t.store.get('b1')!].some(x => x.startsWith(`${U}/`)), JSON.stringify(r))
  ok("another student's objects, a prefix lookalike (user-1x/) and loose files are untouched", theirs.every(x => t.store.get('b1')!.has(x)))
  t = fake(mine, { buckets: ['b1', 'b2'] }); r = await removeOwnedStorage(U, t.api as never)
  ok('every bucket is walked', r.ok && r.removed === mine.length * 2)
  t = fake([...mine, ...theirs], { failRemoveAfter: 1 }); r = await removeOwnedStorage(U, t.api as never)
  ok('a provider failure partway is reported with the real progress, not as all-or-nothing', !r.ok && r.removed === 100 && [...t.store.get('b1')!].filter(x => x.startsWith(`${U}/`)).length === mine.length - 100, JSON.stringify(r))
  const left = [...t.store.get('b1')!]; const t2 = fake(left); r = await removeOwnedStorage(U, t2.api as never)
  ok('retry continues where it stopped and finishes', r.ok && r.removed === mine.length - 100 && ![...t2.store.get('b1')!].some(x => x.startsWith(`${U}/`)) && theirs.every(x => t2.store.get('b1')!.has(x)))
  t = fake([...mine, ...theirs], { failListUnder: `${U}/docs/deep` }); r = await removeOwnedStorage(U, t.api as never)
  ok('an unlistable nested folder fails the cleanup (the account is not deleted over files that could not be inspected)', !r.ok)
  ok('no files at all is a clean success', (await removeOwnedStorage(U, fake(theirs).api as never)).ok)
  console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0)
})()
