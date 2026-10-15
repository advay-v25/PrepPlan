# Full Visual Design Overhaul — Design Spec

## Context

The app (Home, Tests, Onboarding, Curriculum, Settings, Calendar) currently runs
on a blue-on-white palette (`#0b5cff`), DM Sans + Fraunces + JetBrains Mono, and
a partial token layer (`--space-*`, `--radius`, phase colors already promoted to
`:root`). The founder wants a complete visual replacement — new palette, new
fonts, new card/component language, new spacing rhythm — across every surface,
not a consistency pass on the existing look.

Direction chosen with the founder (see chat): **editorial / warm academic**,
**light mode only** for this pass, **no existing color is a constraint** —
including the blue accent.

## 1. Design tokens (`src/styles.css` `:root`)

### Color

| Token | Value | Replaces | Use |
|---|---|---|---|
| `--paper` | `#FBF7F0` | `--surface` (`#f7f9fc`) | page background |
| `--surface` | `#FFFFFF` | `#ffffff` (kept) | cards, raised elements |
| `--ink` | `#211C16` | `--ink` (`#0a1628`) | primary text |
| `--muted` | `#6B6155` | `--muted` (`#60708b`) | secondary text |
| `--line` | `#E6DFD3` | `--line` (`#dce2ea`) | hairline borders |
| `--line-soft` | `#F0EAE0` | `--line-soft` (`#e9edf2`) | subtler dividers |
| `--accent` | `#1F4D3D` | `--blue` (`#0b5cff`) | primary action color |
| `--accent-dark` | `#163B2F` | `--blue-dark` | hover/active |
| `--accent-soft` | `#E8F0EB` | `--blue-soft` | tinted/selected backgrounds |
| `--gold` | `#B8863B` | (new) | secondary highlight — streaks, emphasis, used sparingly |
| `--gold-soft` | `#F7EFDE` | (new) | tinted gold backgrounds |
| `--success` | `#2F7A4F` | `--green` (`#22975b`) | same warm family as accent, distinguishable from it |
| `--success-soft` | `#E9F3EC` | `--green-soft` | |
| `--warning` | `#B8863B` | `--amber` (`#d97706`) | reuses `--gold` |
| `--warning-soft` | `#F7EFDE` | `--amber-soft` | reuses `--gold-soft` |
| `--danger` | `#B13B32` | `--red` (`#c43d4b`) | warm brick red, not candy-red |
| `--danger-soft` | `#FBEEEC` | `--red-soft` | |

Phase colors (`--phase-first-pass`, `--phase-consolidation`, `--phase-revision`,
`--phase-final`) are re-chosen from the same warm family rather than the
current blue/cyan/green/amber set, so the phase bar reads as one coherent
palette:

| Token | Value | Notes |
|---|---|---|
| `--phase-first-pass` | `#1F4D3D` (accent) | |
| `--phase-consolidation` | `#6B7F8C` | warm slate-blue, distinct from accent |
| `--phase-revision` | `#B8863B` (gold) | |
| `--phase-final` | `#B13B32` (danger family, urgency) | |

Old token names (`--blue`, `--green`, `--amber`, `--red`, `--ink`, `--muted`,
`--line`, `--surface`) are **removed**, not aliased — every consumer is
migrated to the new names as part of this work (an alias would let old and new
language coexist indefinitely, which is exactly the drift the current
six-different-card-paddings problem came from).

### Typography

Replace the font import wholesale:

```css
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');
```

| Token | Value | Use |
|---|---|---|
| `--font-display` | `'Source Serif 4', Georgia, serif` | headings, section labels |
| `--font-body` (new, = base `font-family`) | `'Inter', ui-sans-serif, system-ui, sans-serif` | body/UI text |
| `--font-mono` | `'IBM Plex Mono', ui-monospace, monospace` | numbers, timers, dates, effort stats |

Type scale (`--text-*`) and weight tokens stay structurally the same (already
tokenized); only the family changes.

### Shape & depth

| Token | Value | Replaces |
|---|---|---|
| `--radius-sm` | `6px` | ad-hoc small radii |
| `--radius-md` | `10px` | `--radius` (`8px`) |
| `--radius-lg` | `16px` | ad-hoc large radii (12px et al) |
| `--shadow-card` | `0 1px 2px rgba(33,28,22,.06)` | existing flat/no-shadow cards |
| `--shadow-raised` | `0 1px 2px rgba(33,28,22,.06), 0 8px 24px rgba(33,28,22,.08)` | dialogs, popovers |

No blur, no gradients, no glassmorphism anywhere — this replaces the
onboarding's current "glass-hero" treatment (`src/app/page.tsx`,
`src/components/home/NextActionCard.tsx`, `TodayFocusCard.tsx` all reference
glass-hero-adjacent styling and are in scope to re-skin).

Spacing (`--space-*`), z-index, and motion tokens are kept as-is — they're
structurally sound; only the values they're applied to (color, type, radius)
change.

## 2. Primitives

Existing: `src/components/ui/{Button,Card,Dialog,Field,Notice,ProgressRing}.tsx`.
These are re-skinned (new tokens), not rewritten — their APIs stay stable so
every page consuming them keeps compiling through the token swap.

New: `src/components/ui/Badge.tsx` — a small-caps, letter-spaced chip for
phase/status labels (used today as ad-hoc spans across Curriculum, Tests,
Calendar). One component, driven by a `tone` prop mapped to the semantic
tokens (`accent | gold | success | warning | danger | neutral`).

## 3. Page-by-page scope

| Page | Files | Treatment |
|---|---|---|
| Onboarding | `src/app/onboarding/**`, `src/components/onboarding/**` | First full consumer of the new system: warm paper background, serif step headlines, chip/field primitives restyled. Proves the token+primitive layer on the lowest-risk surface. |
| Home | `src/app/app/page.tsx`, `src/components/home/**` | Countdown becomes a mono-numeral hero stat; signal cards become warm-bordered `Card`s with serif labels; remove glass-hero treatment. |
| Settings | `src/app/app/settings/page.tsx`, `src/components/settings/**` | Already uses `Card`/`Notice` — mostly a token swap plus the new `Badge` where status is shown. |
| Tests | `src/app/app/tests/**`, `src/components/tests/**` | Paper cards and the test-taking interface restyled onto the new tokens; due/in-progress/scored states use semantic tokens via `Badge`, never color alone. |
| Curriculum | `src/app/app/curriculum/**`, `src/components/curriculum/**` | Phase bar recolored onto the new `--phase-*` tokens; milestone list gets serif topic names + mono week-ranges. |
| Calendar | `src/app/app/calendar/**`, `src/components/calendar/**` | **Visual layer only** — card face, color tokens, typography. The 7-column grid math, drag/resize pixel calculations, and `repeat(7, minmax(115px, 1fr))` column sizing are unchanged. Built and reviewed last, after a visual-snapshot baseline exists. |

`src/styles.css` is de-minified section by section as each page migrates
(existing lines run up to 15 rules; this makes the diff reviewable per page
rather than one unreviewable whole-file rewrite).

## 4. Copy changes

The founder has approved copy changes where they improve the design. Any
string changed under this work updates its corresponding assertion in the
~430 existing checks (`scripts/e2e-*.ts`, `scripts/*-test.ts`, the
`route-audit` nav-label checks) in the same task, not as a follow-up — a task
that changes copy is not done until its own tests reflect that copy.

## 5. Build order

1. Token layer rewrite in `src/styles.css` `:root` (color, type, shape) —
   additive alongside old tokens initially within this single task, removed
   at the end of the task once nothing references the old names (verified by
   grep).
2. Primitives re-skin (`Button`, `Card`, `Dialog`, `Field`, `Notice`,
   `ProgressRing`) + new `Badge`.
3. Onboarding (proves the system end to end on the newest, simplest surface).
4. Settings, then Home.
5. Tests.
6. Curriculum.
7. Visual-snapshot script (`scripts/visual-snap.ts`, Playwright, ~10 routes ×
   375/834/1440px) — written before Calendar, the one surface with no other
   automated check for "does this still look right."
8. Calendar (visual layer only, per the constraint above).

## 6. Verification

- `npm run verify` (lint + all unit/pure-function suites) must stay green
  after every task.
- The relevant `e2e:*` suite runs after each page's migration
  (`e2e:onboarding`, `e2e:home`, `e2e:tests-scope`/`e2e:taking`/`e2e:results`,
  `e2e:spine`/`e2e:class-route` for Curriculum, `e2e:calendar` last).
- `npm run audit:routes` stays green throughout (internal links are a
  structural check, unaffected by visual changes, and catches an accidental
  broken nav link early).
- Visual-snapshot script output is reviewed by eye at each stage boundary
  from Tests onward (Curriculum, Calendar) — the automated checks cannot
  catch "this looks broken," only "this HTML still contains the right
  strings."

## Out of scope

- Dark mode (explicitly deferred per the founder's answer).
- Any change to Calendar's grid math, drag/resize behavior, or column sizing.
- Any new feature or behavior change — this is visual only; `/api/*` routes,
  roadmap/planning logic, and data flows are untouched.
