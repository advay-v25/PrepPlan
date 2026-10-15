/**
 * Route and link audit.
 *
 * Enumerates every route the App Router exposes, then every internal link and
 * form action in the source, and reports links that point at nothing. A link to
 * a route that no longer exists is invisible until a user clicks it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PRIMARY_NAVIGATION } from '../src/lib/routing/registry'

const SRC = 'src'
const APP = join(SRC, 'app')

type Route = { pattern: string; kind: 'page' | 'route'; file: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

// --- 1. Routes -------------------------------------------------------------
const routes: Route[] = []
for (const file of walk(APP)) {
  const rel = relative(APP, file).replace(/\\/g, '/')
  const m = rel.match(/^(.*?)\/?(page|route)\.tsx?$/)
  if (!m) continue
  const [, dir, kind] = m
  const segments = dir.split('/').filter(Boolean)
    .filter(s => !(s.startsWith('(') && s.endsWith(')'))) // route groups
  routes.push({
    pattern: '/' + segments.join('/'),
    kind: kind === 'page' ? 'page' : 'route',
    file: relative('.', file),
  })
}
routes.sort((a, b) => a.pattern.localeCompare(b.pattern))

console.log(`\nRoutes (${routes.length})\n`)
for (const r of routes) console.log(`  ${r.kind === 'page' ? 'page ' : 'api  '} ${r.pattern || '/'}`)

// --- 2. Links --------------------------------------------------------------
const dynamicSeg = /\[[^\]]+\]/g
function matches(link: string, pattern: string): boolean {
  const p = pattern.split('/').filter(Boolean)
  const l = link.split('/').filter(Boolean)
  if (p.length !== l.length) return false
  return p.every((seg, i) => (seg.startsWith('[') ? true : seg === l[i]))
}

type Link = { href: string; file: string; line: number }
const links: Link[] = []
const LINK_PATTERNS = [
  /href=["'](\/[^"'`{}\s]*)["']/g,
  /href=\{`(\/[^`]*)`\}/g,
  /(?:router\.(?:push|replace)|redirect)\(\s*["'](\/[^"'`]*)["']/g,
  /(?:router\.(?:push|replace)|redirect)\(\s*`(\/[^`]*)`/g,
  /action=["'](\/[^"']*)["']/g,
  /fetch\(\s*["'](\/api\/[^"'`?]*)/g,
  /fetch\(\s*`(\/api\/[^`?]*)/g,
  // Nav arrays declare their destination as `id`, not `href`.
  /\bid:\s*["'](\/[^"']*)["']/g,
  // State selectors return actionable destinations rather than rendering a
  // Link directly. These are still user-facing links and must resolve.
  /\bdestination:\s*["'](\/[^"'`]*)["']/g,
  /\bdestination:\s*`(\/[^`]*)`/g,
]

for (const file of walk(SRC)) {
  if (!/\.(tsx?|jsx?)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const re of LINK_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        let href = m[1].split('?')[0].split('#')[0]
        // Template holes become a dynamic segment for matching purposes. A
        // hole fused onto the end of a segment with no preceding slash (e.g.
        // `/report-${suffix}`) is a fragment, not a route parameter — drop it.
        // A hole that IS its own segment (preceded by a slash, e.g.
        // `/api/onboarding/${step}`) is a route parameter and must count
        // toward the match, or it silently resolves against the parent route
        // instead of the dynamic one actually being called.
        href = href.replace(/([^/])\$\{[^}]*\}$/, '$1')
        href = href.replace(/\$\{[^}]*\}/g, 'x').replace(/\/+$/, '') || '/'
        if (href.startsWith('//')) continue
        links.push({ href, file: relative('.', file), line: i + 1 })
      }
    }
  })
}

// Navigation uses registry constants rather than duplicated literals, so add
// its resolved destinations to the same audit explicitly.
for (const item of PRIMARY_NAVIGATION) {
  links.push({ href: item.href, file: 'src/lib/routing/registry.ts', line: 0 })
}

const unique = new Map<string, Link>()
for (const l of links) if (!unique.has(l.href + l.file)) unique.set(l.href + l.file, l)

const broken: Link[] = []
const external = new Set(['/auth/callback'])
for (const l of unique.values()) {
  if (external.has(l.href)) continue
  const hit = routes.some(r => matches(l.href, r.pattern))
  if (!hit) broken.push(l)
}


// --- 2b. Primary navigation contract --------------------------------------
const expectedPrimaryIds = ['home', 'calendar', 'curriculum', 'tests', 'coach', 'settings']
const actualPrimaryIds = PRIMARY_NAVIGATION.map(item => item.id)
const primaryNavigationValid =
  expectedPrimaryIds.length === actualPrimaryIds.length &&
  expectedPrimaryIds.every((id, index) => actualPrimaryIds[index] === id) &&
  new Set(PRIMARY_NAVIGATION.map(item => item.href)).size === PRIMARY_NAVIGATION.length

if (primaryNavigationValid) {
  console.log('Primary navigation matches the canonical six student destinations.')
} else {
  console.log('\nPrimary navigation is invalid.')
  console.log(`  Expected: ${expectedPrimaryIds.join(', ')}`)
  console.log(`  Actual:   ${actualPrimaryIds.join(', ')}`)
}

console.log(`\nInternal links checked: ${unique.size}`)
if (broken.length === 0) {
  console.log('All internal links resolve to a route.\n')
} else {
  console.log(`\nLinks pointing at no route (${broken.length}):\n`)
  for (const b of broken) console.log(`  ${b.href}\n      ${b.file}:${b.line}`)
  console.log()
}

// --- 3. Unreachable pages --------------------------------------------------
const linkedPaths = new Set([...unique.values()].map(l => l.href))
const orphanPages = routes.filter(r => {
  if (r.kind !== 'page') return false
  if (r.pattern === '' || r.pattern === '/') return false
  if (r.pattern.includes('[')) return false // reached dynamically
  return ![...linkedPaths].some(href => matches(href, r.pattern))
})

if (orphanPages.length) {
  console.log(`Pages nothing links to (${orphanPages.length}) — reachable only by typing the URL:\n`)
  for (const p of orphanPages) console.log(`  ${p.pattern}\n      ${p.file}`)
  console.log()
}

process.exit(broken.length === 0 && primaryNavigationValid ? 0 : 1)
