# Phase 1 UI/UX overhaul — design tokens, core app shell, dashboard, week

## Context

The app (a CFA Level I study planner, Next.js 16, plain CSS, no component
library) currently has two divergent visual languages:

1. Most pages (landing, auth, onboarding, diagnostics, syllabus, coach,
   settings) share a coherent light/blue design system defined in
   `src/styles.css` (`--ink`, `--blue`, `--muted`, `--line`, etc.).
2. The two pages a signed-in user actually lives in day to day —
   `src/app/app/page.tsx` (dashboard) and `src/app/app/week/page.tsx`
   (week planner) — use inline `style={}` objects that reference CSS
   custom properties which **do not exist anywhere in the codebase**:
   `--brand-blue`, `--brand-red`, `--bg-layer-1`, `--bg-layer-2`,
   `--text-dim`, `--border`. These silently fall back to unstyled
   browser defaults (transparent/black), so the two most-used screens in
   the product are effectively broken today.

This phase fixes that bug as part of a deliberate visual upgrade: moving
the design language from "generic light-blue SaaS template" to a bolder,
more distinctive "Editorial Navy" identity, and adding a small,
purposeful GSAP-based motion layer. Later phases (not in this spec) will
extend the same system to diagnostics/tests, syllabus, coach, auth, and
onboarding.

## Goals

- Fix the broken dashboard and week pages by rewriting them onto real,
  shared CSS classes (no undefined variables, no ad hoc inline styles).
- Refresh the shared design tokens toward a bolder, more distinctive
  identity while keeping brand continuity (blue stays the primary
  action color, "Roadmap" mark unchanged).
- Add a small GSAP motion utility used for entrance/stagger animation
  and an animated mobile nav drawer — nothing route-transition-level,
  nothing scroll-jacked, everything reduced-motion-safe.
- Leave all Supabase data-fetching logic in `page.tsx` files untouched —
  this is a presentation-layer change only.

## Non-goals (deferred to a later phase)

- Diagnostics/test-taking UI, syllabus, coach, settings, auth,
  onboarding, landing page — untouched in this phase.
- Any backend/schema/API change.
- Any new dependency beyond `gsap` (no animation library plugins like
  ScrollTrigger — not needed for this phase's motion scope).

## Design tokens (`src/styles.css` `:root`)

Updated/added, keeping every existing token name that other (untouched)
pages depend on:

- `--ink`: deepen from `#0b1b3b` → `#0a1628` (richer navy-black,
  contrast-checked against white ≥ 12:1)
- `--radius`: `9px` → `8px`
- New `--surface-warm: #faf9f6` — a warm off-white for large
  editorial/hero surfaces (dashboard hero, week hero), distinct from the
  existing cooler `--surface: #f7f9fc` used for compact panels
- Keep `--blue`/`--blue-dark`/`--blue-soft`, `--green`/`--green-soft`,
  `--amber`/`--amber-soft`, `--red`/`--red-soft` as-is — the semantic
  triad already works and doesn't need to change to read as bolder
- Fonts: add **Fraunces** (serif, display) via the existing Google Fonts
  `@import`, used only for large display moments — hero `h1`s, big score
  numbers (`.score strong`, `.result-score`) — replacing Manrope in
  those specific spots. Add **JetBrains Mono** for small data labels:
  question/day counters, subject codes, coverage-node numbers, stat
  chips. DM Sans remains the body/UI font throughout — not introducing a
  second sans-serif, to keep the system disciplined (Swiss-modernist
  restraint) rather than adding a font for its own sake.
- Press feedback stays CSS-only: the existing
  `button:not(:disabled):active { transform: translateY(1px) }` rule
  gets a subtle scale added (`scale(.98)`); GSAP is not used for this —
  CSS already does it well, and GSAP's value in this phase is entrance
  animation and the drawer, not per-button JS listeners.

## New shared pieces

- `src/lib/motion.ts` — registers GSAP once; exports:
  - `prefersReducedMotion()` — reads `matchMedia('(prefers-reduced-motion: reduce)')`
  - `fadeInUp(target, opts?)` — opacity 0→1 + y 12→0, ~0.4s, `power2.out`, no-op under reduced motion
  - `staggerIn(targets, opts?)` — same tween applied with a small per-item stagger (~0.05s)
  - `slideDrawer(el, {direction: 'in' | 'out'}, onComplete?)` — xPercent tween for the mobile nav drawer
- `src/components/Reveal.tsx` (`'use client'`) — wraps a single section/
  card, plays `fadeInUp` on mount via a ref
- `src/components/StaggerList.tsx` (`'use client'`) — wraps a list of
  children, plays `staggerIn` across direct children on mount

These let the (server-rendered, data-fetching) dashboard and week pages
gain entrance motion without becoming client components themselves —
only the thin wrapper is a client component.

## Component/page changes

- **`AppShell.tsx`**: replace the ad hoc inline-styled prototype banner
  with a real class; rework the mobile nav drawer from an instant
  mount/unmount into a 3-state machine (`closed` → `entering`/`open` →
  `exiting` → `closed`) so `slideDrawer` can animate both directions
  before actually unmounting.
- **`Sidebar.tsx`**: visual refresh only (spacing, active-nav indicator)
  against the updated tokens — no structural/behavioral change.
- **`src/app/app/page.tsx`** (dashboard): full rewrite from inline
  `style={}` objects to classes in `styles.css` (new `.dashboard-*`
  rules), fixing the undefined-variable bug. Hero "Next Up" card,
  "Coming Up" list, "Recent Learning" list, and the four workspace
  cards each get wrapped in `Reveal`/`StaggerList`.
- **`src/app/app/week/page.tsx`**: same treatment — full rewrite off
  inline styles referencing the same undefined variables, onto new
  `.week-plan-*` classes; the scheduled-items list and floating-tasks
  list get wrapped in `StaggerList`.
- **`package.json`**: add `gsap` as a dependency.

## Testing / verification

No automated UI test suite exists in this repo (this project doesn't
have Jest/Playwright configured). Verification is manual:

- `npm run dev`, visually check dashboard, week, and sidebar (incl.
  mobile drawer open/close) at 375px / 768px / 1024px / 1440px
- Toggle OS-level reduced-motion and confirm all animation becomes a
  no-op (content still appears, just without the tween)
- `npm run lint` (this repo's `lint` script runs `tsc --noEmit`) and
  `npm run build` must both pass before calling this done
