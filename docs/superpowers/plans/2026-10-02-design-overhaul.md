# Full Visual Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's entire visual language — color, type, shape, the
glass-hero treatment, and every ad-hoc spot of color — with one warm/editorial
system, across Onboarding, Home, Settings, Tests, Curriculum, and Calendar.

**Architecture:** The app already has a token layer in `src/styles.css`
(`--space-*`, `--radius-*`, `--shadow-*`, `--layer-*`, `--phase-*`) and shared
primitives (`Button`, `Card`, `Dialog`, `Field`, `Notice`, `ProgressRing` in
`src/components/ui/`) that apply CSS classes rather than inline styles. This
means the bulk of the work is: (1) one mechanical rewrite of the token
*values* and a project-wide rename of the handful of token *names* that are
misleading under the new palette (`--blue` is no longer blue), then (2)
page-by-page passes that convert any bespoke, non-token-driven CSS (most
importantly the dark/blurred `.glass-hero` block) onto the new system. No
React component's props or structure changes — only CSS.

**Tech Stack:** Next.js App Router, plain CSS (`src/styles.css`, no CSS
Modules in-scope — `onboarding.module.css` was already retired), Playwright
(new, for the visual-snapshot script).

**Spec:** `docs/superpowers/specs/2026-10-02-design-overhaul-design.md`

## Global Constraints

- Light mode only — no dark-mode variants added this pass.
- No `backdrop-filter`, no gradients, no glassmorphism anywhere in the final
  state — the existing `.glass-hero`/`.glass-panel` treatment is explicitly
  replaced, not kept as an option.
- Token names that no longer describe their color must be renamed, not kept
  with a misleading name: `--blue`→`--accent`, `--blue-dark`→`--accent-dark`,
  `--blue-soft`→`--accent-soft`, `--green`→`--success`,
  `--green-soft`→`--success-soft`, `--amber`→`--warning`,
  `--amber-soft`→`--warning-soft`, `--red`→`--danger`,
  `--red-soft`→`--danger-soft`. The bare `--radius` token (8px, 27 call sites)
  is retired in favor of the existing `--radius-md` scale entry it duplicates.
  After the rename, `grep -c "var(--\(blue\|green\|amber\|red\)\b" src/styles.css`
  and the same across `src/**/*.tsx` must return `0` before a task is done.
- The existing `--radius-sm/md/lg/full` and `--shadow-xs/sm/md/lg` scales are
  **reused, not duplicated** — their rgba tint changes from cool
  (`rgba(10,22,40,*)`) to warm (`rgba(33,28,22,*)`) and `--radius-lg` goes from
  14px to 16px; no new radius/shadow tokens are introduced.
- `npm run verify` (lint + every unit/pure-function suite + route audit) must
  pass after every task. The relevant `e2e:*` suite(s) for a task's page must
  also pass before that task is marked done.
- Copy changes are allowed where they improve the design; any string changed
  must have its corresponding assertion in `scripts/e2e-*.ts` /
  `scripts/*-test.ts` updated in the **same task** that changes the copy.
- Calendar's `repeat(7, minmax(115px, 1fr))` grid column sizing and the
  drag/resize pixel-math files (anything computing block top/height/left from
  pixel measurements) are **not modified** — Task 10 is CSS color/type/shadow
  only on that surface.
- The public marketing page (`src/app/page.tsx`, pre-login) was not named in
  the founder's scope (Home/Tests/Onboarding/Curriculum/Settings/Calendar).
  It shares the `.glass-hero`/`.glass-panel` CSS classes with the in-app Home
  page, so it is **visually affected as a side effect** of Task 3's rewrite of
  those shared selectors, but no task here specifically re-designs it, and no
  task should add page-specific (`.landing-*`) rules to compensate — if Task 3
  leaves the landing page looking reasonable with the shared classes alone,
  that is sufficient; if it looks broken, flag it rather than silently scope-
  creeping into a landing-page redesign.

## Review Focus

- **Reduced motion:** every new/changed hover or transition rule must still
  resolve to near-instant under `prefers-reduced-motion: reduce` — the
  existing `@media (prefers-reduced-motion: reduce)` block at the top of
  `src/styles.css` already zeroes the duration tokens; a task that hard-codes
  a literal `transition: 200ms` instead of `var(--dur-base)` silently escapes
  that switch. Task 2's grep-verify step covers this for the token rename;
  each later task's own verify step must include a grep for hard-coded
  `ms`/`s` transition durations it introduces.
- **Contrast of the new accent on white:** `#1F4D3D` on `#FFFFFF` must still
  clear 4.5:1 before it's adopted for the focus ring and body-text links —
  Task 1 includes a concrete contrast check, not an assumption that "it looks
  dark enough."
- **The landing page regressing silently:** per the Global Constraints note
  above, Task 3 must load `/` (not just `/app`) in its manual check, since
  it's the one page in scope-by-necessity that no task explicitly owns.
- **Color-only status meaning:** Tests/Curriculum render due/scored/repair
  states; Task 4's new `Badge` must carry a text label or icon alongside its
  tone color (WCAG `color-not-only`), and Task 8/9's consumption of `Badge`
  must not drop the existing text labels in favor of color alone.
- **A stale reference to a retired token surviving in a file the grep missed:**
  `grep` in Task 2 is scoped to `src/**/*.{ts,tsx,css}`; inline `style={{...}}`
  objects that build a var name from a string (e.g.
  `` `var(${accent})` `` in `Card.tsx`) pass a *token name*, not a literal
  `--blue`, so they won't show up in that grep but still depend on the names
  being valid — Task 2's step 5 explicitly re-checks every `accent={'--...'}`
  call site across the codebase, not just literal `var(--blue)` text.

---

### Task 1: Rewrite the `:root` token values and font import

**Files:**
- Modify: `src/styles.css:1-91` (the `:root` block and the font `@import`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: every color/font/radius/shadow token later tasks and the global
  rename in Task 2 read by name. Names that change: `--blue`→`--accent`,
  `--blue-dark`→`--accent-dark`, `--blue-soft`→`--accent-soft`,
  `--green`→`--success`, `--green-soft`→`--success-soft`,
  `--amber`→`--warning`, `--amber-soft`→`--warning-soft`, `--red`→`--danger`,
  `--red-soft`→`--danger-soft`. Names that keep their name but change value:
  `--ink`, `--ink-soft`, `--muted`, `--line`, `--line-soft`, `--surface`,
  `--surface-page`, `--surface-raised`, `--surface-sunken`, `--radius-lg`,
  `--shadow-xs/sm/md/lg`, `--layer-*`, `--phase-*`, `--focus-outline`,
  `--font-display`, `--font-mono`, `--font-sans`. The bare `--radius` token
  (line 24) is deleted outright (Task 2 replaces its 27 call sites with
  `var(--radius-md)`).

- [ ] **Step 1: Replace the font import (line 1)**

```css
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');
```

- [ ] **Step 2: Replace the `:root` block's lines 3-26 (base `font-family`,
  `color`, and the first group of named tokens) with:**

```css
:root {
  color-scheme: light;
  font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #211C16;
  background: #FBF7F0;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --ink: #211C16;
  --muted: #6B6155;
  --line: #E6DFD3;
  --line-soft: #F0EAE0;
  --surface: #FFFFFF;
  --accent: #1F4D3D;
  --accent-dark: #163B2F;
  --accent-soft: #E8F0EB;
  --success: #2F7A4F;
  --success-soft: #E9F3EC;
  --warning: #B8863B;
  --warning-soft: #F7EFDE;
  --danger: #B13B32;
  --danger-soft: #FBEEEC;
  --font-display: 'Source Serif 4', Georgia, serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
```

(This deletes the old `--ink`/`--muted`/`--line`/`--surface`/`--blue*`/
`--green*`/`--amber*`/`--red*`/`--radius`/`--font-display`/`--font-mono`
lines and replaces them with the block above — note `--radius` has no
replacement line; it is gone.)

- [ ] **Step 3: Update the remaining token lines that keep their names**

Line 46, `--font-sans`, becomes:
```css
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

Line 49, bump `--radius-lg` from `14px` to `16px` (keep `--radius-xs: 4px`,
`--radius-sm: 6px`, `--radius-md: 10px`, `--radius-full: 999px` as they are):
```css
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 999px;
```

Lines 52-55, retint the shadow scale from cool ink (`rgba(10,22,40,*)`) to
warm ink (`rgba(33,28,22,*)`), same alpha values:
```css
  --shadow-xs: 0 1px 2px rgba(33,28,22,.05);
  --shadow-sm: 0 2px 6px rgba(33,28,22,.06), 0 1px 2px rgba(33,28,22,.04);
  --shadow-md: 0 8px 24px rgba(33,28,22,.10);
  --shadow-lg: 0 20px 56px rgba(33,28,22,.16);
```

Line 73, `--ink-soft` (a lighter text tier between `--ink` and `--muted`):
```css
  --ink-soft: #4A3F33;
```

Lines 76-78, the named surfaces:
```css
  --surface-page: #FBF7F0;
  --surface-raised: #FFFFFF;
  --surface-sunken: #F3EEE4;
```

Lines 81-85, product semantics — `--layer-*` (commitment-type colors used on
Calendar block faces) and `--phase-*` (roadmap phase colors), re-chosen from
the warm family so nothing reads as leftover cool-blue:
```css
  --layer-commitment: #8A7F6E; --layer-class: #6B4F8A; --layer-study: #1F4D3D;
  --layer-review: #3D7A8C;     --layer-diagnostic: #B8863B; --layer-repair: #B13B32;
  --layer-recheck: #A14D73;    --layer-mock: #4B4A8C;      --layer-other: #6B6155;
  --phase-first-pass: #1F4D3D; --phase-consolidation: #6B7F8C;
  --phase-revision: #B8863B;   --phase-final: #B13B32;
```

Line 89, the focus ring (contrast-checked in Step 5 below):
```css
  --focus-outline: 2px solid #1F4D3D;
```

- [ ] **Step 4: Update the two literal color values outside `:root`**

Line 101, `body { ... background: #fff; }` → `background: #FBF7F0;`.
Line 108, `.prose-link { ...; color: var(--blue); }` → this line is covered by
Task 2's rename (it becomes `var(--accent)` there); no separate edit needed
here, just don't hand-edit it now and have Task 2 skip it.

- [ ] **Step 5: Verify contrast before moving on**

Compute the contrast ratio of `#1F4D3D` text/icons on `#FFFFFF` and on
`#FBF7F0` (the two backgrounds it's used against for the focus ring and
`.prose-link`). Using the WCAG relative-luminance formula:
`#1F4D3D` → L ≈ 0.0415; `#FFFFFF` → L = 1.0; `#FBF7F0` → L ≈ 0.936.
Contrast = (1.0 + 0.05) / (0.0415 + 0.05) ≈ **11.5:1** against white, and
(0.936 + 0.05) / (0.0415 + 0.05) ≈ **10.8:1** against the paper background.
Both clear the 4.5:1 AA minimum by a wide margin — record this in the task's
commit message so it isn't re-litigated later.

- [ ] **Step 6: Run `npx tsc --noEmit`**

Expected: no new errors (this task touches only CSS).

- [ ] **Step 7: Start the dev server and load `/`, `/app`, and `/app/settings`**

Run `npm run dev`, then load all three in a browser. Expected: colors look
different (no longer blue — mostly broken-looking is fine right now, since
Task 2 hasn't renamed consumers yet) but **nothing crashes**, because every
old token name except the bare `--radius` still has *a* value or falls back
to `initial`/inherited — confirm the page renders, don't worry about how it
looks yet.

- [ ] **Step 8: Commit**

No git repo in this project — skip `git add`/`git commit`; move to Task 2.

---

### Task 2: Global rename of consumers from old token names to new ones

**Files:**
- Modify: `src/styles.css` (all ~460 call sites across the file, see counts
  in the spec §1 table: `--blue` 115, `--blue-dark` 2, `--blue-soft` 22,
  `--green` 38, `--green-soft` 17, `--amber` 30, `--amber-soft` 12, `--red`
  31, `--red-soft` 8, `--radius` 27)
- Modify: `src/app/app/tests/page.tsx`, `src/components/calendar/ConflictDialog.tsx`,
  `src/components/coach/CoachClient.tsx`, `src/components/home/TodaySequence.tsx`,
  `src/components/ui/ProgressRing.tsx` (inline `var(--blue)`-style usages
  found by the earlier grep)

**Interfaces:**
- Consumes: the new token names from Task 1 (`--accent`, `--accent-dark`,
  `--accent-soft`, `--success`, `--success-soft`, `--warning`,
  `--warning-soft`, `--danger`, `--danger-soft`, `--radius-md`).
- Produces: a codebase with zero references to the retired names, which Task
  3 onward build on without re-deriving this mapping.

- [ ] **Step 1: Run the mechanical rename across `src/styles.css`**

The rename must go in this exact order (longer/more-specific names first, so
e.g. `--blue-dark` isn't half-matched by a `--blue` rule and left with a
dangling `-dark`):

```bash
cd "/Users/advay/Documents/Structured Learning App"
sed -i '' \
  -e 's/--blue-dark/--accent-dark/g' \
  -e 's/--blue-soft/--accent-soft/g' \
  -e 's/--blue\b/--accent/g' \
  -e 's/--green-soft/--success-soft/g' \
  -e 's/--green\b/--success/g' \
  -e 's/--amber-soft/--warning-soft/g' \
  -e 's/--amber\b/--warning/g' \
  -e 's/--red-soft/--danger-soft/g' \
  -e 's/--red\b/--danger/g' \
  -e 's/var(--radius)/var(--radius-md)/g' \
  src/styles.css
```

- [ ] **Step 2: Fix the five `.tsx` files with inline `var(--blue)`-style usage**

Read each of the five files listed above, find every occurrence of
`var(--blue)`, `var(--blue-dark)`, `var(--blue-soft)`, `var(--green)`,
`var(--green-soft)`, `var(--amber)`, `var(--amber-soft)`, `var(--red)`,
`var(--red-soft)`, or `var(--radius)` (as a literal string, inside a `style={{}}`
or template literal), and apply the same renames as Step 1 by hand (there are
only a handful of occurrences across five files — this is not worth scripting).

- [ ] **Step 3: Grep-verify the rename is complete**

```bash
grep -rn "var(--blue\|var(--green\|var(--amber\|var(--red\b\|var(--radius)" src --include="*.css" --include="*.tsx" --include="*.ts"
```

Expected: no output. If anything prints, it was missed by Steps 1-2 — fix it
before continuing.

- [ ] **Step 4: Re-check `accent={'--...'}` call sites (Review Focus item)**

```bash
grep -rn "accent={" src --include="*.tsx"
```

For each result, confirm the string passed (e.g. `accent="--layer-repair"`,
`accent="--phase-final"`) names a token that still exists under Task 1's new
block — these are all `--layer-*`/`--phase-*` names, which kept their names
in Task 1, so this should already be clean; this step is the explicit check
confirming that, not a new edit.

- [ ] **Step 5: Run `npm run verify`**

Expected: all suites pass — this task only changes CSS custom-property
*names*, with Task 1 already having supplied real values for all of them, so
behavior and rendered HTML are unaffected.

- [ ] **Step 6: Load `/`, `/app`, `/app/settings`, `/app/tests`, `/app/curriculum`,
  `/app/calendar` in a browser**

Expected: every page now renders in the new warm-ink-on-cream palette with no
leftover blue, and nothing is visually broken (text still readable, no
invisible-on-background elements) — this is the first point where the whole
app's color has actually changed; the glass-hero panels will look odd here
(dark gradient panel now using warm accent instead of blue, but still
gradient/blurred) — that's expected and is exactly what Task 3 fixes next.

---

### Task 3: Replace `.glass-hero`/`.glass-panel`/`.glass-pill-button` with a non-glass editorial hero

**Files:**
- Modify: `src/styles.css:356-430` (the "Glass primitives" section — selectors
  `.glass-hero`, `.glass-hero--compact`, `.glass-hero__top`,
  `.glass-hero__eyebrow`, `.glass-hero__date`, `.glass-panel`,
  `.glass-panel__eyebrow`, `.glass-panel h3`, `.glass-panel p`,
  `.glass-panel__foot`, `.glass-pill-button` and its `:hover`/`:disabled`/
  `svg`/`--ghost` variants, `.glass-hero__meta`, `.glass-hero__undo`, and the
  `@media (max-width: 560px)` overrides for `.glass-hero`)
- No `.tsx` changes — `NextActionCard.tsx`, `TodaySequence.tsx`, and
  `src/app/page.tsx` keep the same class names; only what those classes
  resolve to changes.

**Interfaces:**
- Consumes: `--ink`, `--surface`, `--accent`, `--accent-soft`, `--line`,
  `--radius-lg`, `--radius-md`, `--radius-full`, `--shadow-lg`,
  `--font-display` from Tasks 1-2.
- Produces: a hero/panel look with no gradient, no `backdrop-filter`, used by
  Home (Task 6) and, as a side effect, the landing page (see Global
  Constraints).

- [ ] **Step 1: Replace the whole "Glass primitives" block (lines 356-430)**
  with:

```css
/* ── Hero panel ───────────────────────────────────────────────────────
   One clear focal point (today's task, this phase's stat) rendered as a
   solid warm-ink card — no gradient, no blur. Retains the .glass-* class
   names so NextActionCard.tsx, TodaySequence.tsx and the landing page need
   no changes; only what the classes resolve to changes. */
.glass-hero {
  position: relative; overflow: hidden;
  border-radius: var(--radius-lg);
  padding: var(--space-6) var(--space-6) var(--space-8);
  background: var(--ink);
  color: var(--surface-page, #FBF7F0);
  box-shadow: var(--shadow-lg);
}
.glass-hero--compact { padding: var(--space-5) var(--space-6); }
.glass-hero__top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.glass-hero__eyebrow { margin: 0; font-size: var(--text-xs); font-weight: var(--weight-semibold); color: rgba(251,247,240,.62); text-transform: uppercase; letter-spacing: var(--track-wide); }
.glass-hero__date { margin: 2px 0 0; font-size: var(--text-xl); font-weight: var(--weight-bold); letter-spacing: -.02em; font-family: var(--font-display); }

.glass-panel {
  position: relative; z-index: 1;
  margin-top: var(--space-5);
  border-radius: var(--radius-md);
  border: 1px solid rgba(251,247,240,.16);
  background: rgba(251,247,240,.07);
  padding: var(--space-5);
}
.glass-panel__eyebrow { margin: 0 0 var(--space-2); font-size: var(--text-xs); font-weight: var(--weight-semibold); color: rgba(251,247,240,.65); text-transform: uppercase; letter-spacing: var(--track-wide); }
.glass-panel h3 { margin: 0 0 var(--space-2); font-size: var(--text-xl); font-family: var(--font-display); font-weight: 600; line-height: 1.2; color: var(--surface-page, #FBF7F0); }
.glass-panel p { margin: 0; color: rgba(251,247,240,.78); font-size: var(--text-sm); line-height: 1.55; }
.glass-panel__foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-5); flex-wrap: wrap; }

.glass-pill-button {
  display: inline-flex; align-items: center; gap: var(--space-2);
  border: none; border-radius: var(--radius-full);
  background: var(--surface-page, #FBF7F0); color: var(--ink);
  padding: 0 var(--space-5); min-height: 44px;
  font-size: var(--text-sm); font-weight: var(--weight-bold);
  cursor: pointer; text-decoration: none;
  transition: background var(--dur-base) var(--ease-standard);
}
.glass-pill-button:hover { background: var(--line-soft); }
.glass-pill-button:disabled { opacity: .6; cursor: wait; }
.glass-pill-button svg { color: var(--accent); }
.glass-pill-button--ghost { background: rgba(251,247,240,.14); color: var(--surface-page, #FBF7F0); border: 1px solid rgba(251,247,240,.28); }
.glass-pill-button--ghost:hover { background: rgba(251,247,240,.22); }
.glass-pill-button--ghost svg { color: var(--surface-page, #FBF7F0); }
.glass-hero__meta { font-size: var(--text-xs); color: rgba(251,247,240,.65); white-space: nowrap; }
.glass-hero__undo { border: 0; background: none; padding: 0; color: var(--surface-page, #FBF7F0); font-weight: var(--weight-bold); text-decoration: underline; cursor: pointer; font-size: inherit; }
```

(Transition duration uses `var(--dur-base)`, per Review Focus, so
`prefers-reduced-motion` still zeroes it.)

- [ ] **Step 2: Update the `@media (max-width: 560px)` block immediately
  after (originally lines 428-430) — no change needed, it only sets padding
  and gap, already token-driven; confirm it still reads:**

```css
@media (max-width: 560px) {
  .glass-hero { padding: var(--space-4) var(--space-4) var(--space-5); }
  .day-strip { gap: var(--space-1); }
```

(leave the rest of that media block as-is; this step is a confirmation, not
an edit, since nothing in it references a retired token.)

- [ ] **Step 3: Run `npm run verify`**

Expected: all suites pass (no HTML/copy changed, only CSS).

- [ ] **Step 4: Load `/`, `/app` in a browser at 1440px and 390px**

Expected: the hero card on both pages is now a solid warm-ink (near-black
warm brown, `--ink` = `#211C16`) card with a cream-tinted panel inset, no
gradient, no blur, text still clearly legible (verify this by eye — it must
not look like a flat error state, it should read as an intentional dark
panel). Per Global Constraints, check `/` specifically since it's the page no
later task re-visits.

---

### Task 4: Build the `Badge` primitive

**Files:**
- Create: `src/components/ui/Badge.tsx`
- Modify: `src/styles.css` (append a new "Badge" section; place it directly
  after the "UI primitives" section, i.e. after line ~1179 in the file as it
  stood before Tasks 1-3's edits — find the exact line by searching for the
  `/* ── UI primitives` comment and inserting after that whole section ends,
  immediately before `/* ── Onboarding` begins)
- Test: manual (component has no logic branches worth a unit test; its only
  behavior is class-name selection, exercised by Task 8/9's e2e suites once
  it's consumed on a real page)

**Interfaces:**
- Consumes: `--accent`, `--accent-soft`, `--gold` (new in this task, not
  defined by Task 1 — add it here since nothing else needs a `--gold` value
  until this component), `--gold-soft`, `--success`, `--success-soft`,
  `--warning`, `--warning-soft`, `--danger`, `--danger-soft`, `--line`,
  `--muted`, `--radius-full`, `--text-2xs`, `--track-wide`,
  `--weight-semibold` from Task 1.
- Produces: `Badge` component with props `{ tone?: 'accent' | 'gold' |
  'success' | 'warning' | 'danger' | 'neutral'; children: React.ReactNode }`,
  rendering `<span className="ui-badge ui-badge--{tone}">{children}</span>`.
  Tasks 8 and 9 (Tests, Curriculum) import and use this.

- [ ] **Step 1: Add the two gold tokens to `:root` in `src/styles.css`**

Insert directly after the `--danger-soft: #FBEEEC;` line from Task 1:
```css
  --gold: #B8863B;
  --gold-soft: #F7EFDE;
```

- [ ] **Step 2: Write `src/components/ui/Badge.tsx`**

```tsx
/**
 * A small-caps, letter-spaced status chip — phase names, test states, repair
 * flags. One component so a given tone always looks the same wherever it
 * appears, replacing the ad-hoc <span> status labels scattered across Tests,
 * Curriculum and Calendar.
 */

export type BadgeTone = 'accent' | 'gold' | 'success' | 'warning' | 'danger' | 'neutral'

export type BadgeProps = {
  tone?: BadgeTone
  children: React.ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  return (
    <span className={['ui-badge', `ui-badge--${tone}`, className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </span>
  )
}
```

- [ ] **Step 3: Append the Badge CSS section to `src/styles.css`**

```css
/* ── Badge ────────────────────────────────────────────────────────────
   Status/phase chip. `tone` always pairs a background tint with a matching
   ink-on-tint foreground — never color alone (WCAG color-not-only): every
   tone is used by its caller alongside a text label, this component only
   supplies the color treatment, not the sole signal. */
.ui-badge {
  display: inline-flex; align-items: center; gap: var(--space-1);
  border-radius: var(--radius-full);
  padding: 2px var(--space-3);
  font-size: var(--text-2xs); font-weight: var(--weight-semibold);
  text-transform: uppercase; letter-spacing: var(--track-wide);
  line-height: 1.6;
  white-space: nowrap;
}
.ui-badge--accent  { background: var(--accent-soft);  color: var(--accent-dark); }
.ui-badge--gold    { background: var(--gold-soft);    color: #7A5A26; }
.ui-badge--success { background: var(--success-soft); color: #1F5536; }
.ui-badge--warning { background: var(--warning-soft); color: #7A5A26; }
.ui-badge--danger  { background: var(--danger-soft);  color: #7E2920; }
.ui-badge--neutral { background: var(--line-soft); color: var(--muted); }
```

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: no errors — `Badge.tsx` is new and unreferenced, so this only
confirms it compiles in isolation.

- [ ] **Step 5: Run `npm run verify`**

Expected: all suites still pass (nothing consumes `Badge` yet, so this
confirms the new CSS doesn't collide with an existing class name —
`grep -c "\.ui-badge" src/styles.css` should show exactly the 7 rules just
added, confirming no pre-existing `.ui-badge*` selector existed to collide
with).

---

### Task 5: Re-skin the remaining shared primitives (Button, Card, Dialog, Field, Notice, ProgressRing)

**Files:**
- Modify: `src/styles.css` (the "UI primitives" section, selectors
  `.primary-button`, `.secondary-button`, `.text-button`, `.icon-button` and
  their `.is-danger`/`.is-sm`/`.is-lg`/`.is-full` modifiers; `.ui-card` and
  its `--tight`/`--loose`/`--info`/`--warn`/`--danger`/`--success`/
  `--accented`/`--interactive` modifiers; `.ui-dialog` and its overlay/head/
  body/foot parts; `.field` and its label/input/error parts; `.ui-notice` and
  its tone modifiers; whatever class `ProgressRing.tsx` renders)
- Modify: `src/components/ui/ProgressRing.tsx` (its 5 inline `var(--blue)`-
  style occurrences were already renamed in Task 2 Step 2 — this task is
  where their *values* are additionally checked for the new warm palette,
  since a ring stroke color is a case where inline `style` carries the actual
  hex/var rather than a CSS class)

**Interfaces:**
- Consumes: all tokens from Tasks 1, 2, and 4.
- Produces: every primitive rendering in the new palette, consumed as-is
  (same class names, same props) by every page task from here on.

- [ ] **Step 1: Read the current "UI primitives" CSS section**

Find it via `grep -n "── UI primitives" src/styles.css` (its line number
shifted after Tasks 1-4's edits) and read the full section.

- [ ] **Step 2: For every rule in that section, confirm it already resolves
  through a renamed token (from Task 2) rather than a literal hex**

Since the section was already built to consume `--blue`/`--green`/etc. by
name (not hardcoded hex — this is why Task 2's rename was sufficient to
recolor it), this step is a confirmation pass: run
`grep -n "#[0-9a-fA-F]\{3,6\}" src/styles.css` scoped to this section's line
range and fix any literal hex found there to use the matching token instead
(there should be few to none; if any exist, they predate the primitives
refactor and are exactly the kind of drift this task is meant to close).

- [ ] **Step 3: Add `box-shadow: var(--shadow-sm)` to `.ui-card` if not
  already present, and `box-shadow: var(--shadow-lg)` to `.ui-dialog` (or
  its content wrapper) if not already present**

These give cards and dialogs the new warm-tinted elevation from Task 1
instead of a flat border-only look, matching the spec's "soft warm-tinted
shadow" component language.

- [ ] **Step 4: Check `ProgressRing.tsx`'s inline stroke color**

Read the file; if its stroke color is computed from a prop or CSS variable
already renamed in Task 2, no change needed here. If it hardcodes a hex
(e.g. `#0b5cff`) directly in the `.tsx` rather than reading a token, change it
to read `var(--accent)` via inline style, matching how the rest of the app
resolves color.

- [ ] **Step 5: Run `npm run verify` and load `/app/settings` (uses Card,
  Notice, Button already) in a browser**

Expected: all suites pass; Settings' section cards now show a subtle warm
shadow and the "Change" buttons are in the new accent green, not blue.

---

### Task 6: Onboarding visual migration

**Files:**
- Modify: `src/styles.css` (the "Onboarding" section, ~350 lines — every
  selector under the `/* ── Onboarding` comment through
  `/* ── Onboarding: week windows, review, and small helpers */`)
- No `.tsx` changes unless Step 2 finds a hardcoded color/font in a component
  under `src/app/onboarding/` or `src/components/onboarding/`

**Interfaces:**
- Consumes: all tokens from Tasks 1-5, including `Badge` from Task 4 for any
  step-status chip.
- Produces: nothing new consumed by later tasks (Onboarding is a leaf in the
  page list) — this is the first full page proof of the new system end to
  end.

- [ ] **Step 1: Grep the Onboarding CSS section for any literal hex or
  retired-token reference Task 2's rename might have missed (it shouldn't
  have, but Onboarding was the newest, most recently-written CSS and is worth
  double-checking)**

```bash
grep -n "#[0-9a-fA-F]\{3,6\}\|var(--blue\|var(--green\|var(--amber\|var(--red\b" src/styles.css | awk -F: '$1 >= START && $1 <= END'
```
(substitute `START`/`END` with the Onboarding section's actual current line
range, found via `grep -n "── Onboarding"`)

- [ ] **Step 2: Fix anything Step 1 finds**, following the same tone mapping
  as Task 1 (blue-ish → `--accent`, green-ish → `--success`, amber-ish →
  `--warning`, red-ish → `--danger`).

- [ ] **Step 3: Grep for ad-hoc status `<span>`/`<div>` elements in
  `src/components/onboarding/**` that duplicate what `Badge` now provides**
  (e.g. a step-completion chip, a "skippable" label) and replace them with
  `<Badge tone="...">` where it's a drop-in fit; leave anything that isn't a
  simple label-chip alone — this task re-skins, it does not restructure the
  flow.

- [ ] **Step 4: Run `npm run verify` and `npm run e2e:onboarding`**

Expected: all pass. If `e2e:onboarding` fails on a copy-string assertion
because Step 3 changed label text while swapping in `Badge`, update that
assertion in the same commit (Global Constraints: copy changes update their
own tests in the same task) — do not change copy incidentally while doing a
visual pass without updating the check that reads it.

- [ ] **Step 5: Walk `/onboarding/exam` through `/onboarding/plan` in a
  browser at 1440px and 390px**

Expected: warm paper background, serif step headlines, no leftover blue/
green/amber/red, every chip/button at least 44px touch target (unchanged from
before this task — confirm, don't just assume).

---

### Task 7: Settings visual migration

**Files:**
- Modify: `src/styles.css` (the `.settings-*` selectors: `.settings-sections`,
  `.settings-section`, `.settings-section__value`, `.settings-account`,
  `.settings-section--standalone`, `.settings-classes-done`)
- No `.tsx` changes expected (Settings already consumes `Card`/`Notice`/
  `Badge`-eligible patterns; this is confirmation + CSS-only token/shadow
  application)

**Interfaces:**
- Consumes: tokens from Tasks 1-5.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Read the current `.settings-*` CSS (grep `"settings-"` in
  `src/styles.css` for the exact lines)**

- [ ] **Step 2: Confirm every rule resolves through a token (no literal hex)**
  — same check pattern as Task 6 Step 1, scoped to the `.settings-*` lines.

- [ ] **Step 3: In `src/app/app/settings/page.tsx`, replace the plain
  "registered"/"not registered yet" and route-name text with a `<Badge>`
  where it reads as a status (e.g. `registered` vs `not registered yet`) —
  read the file first to confirm exact current JSX before editing.**

- [ ] **Step 4: Run `npm run verify`**

Expected: all pass (Settings has no dedicated `e2e:settings` suite per the
current `package.json` script list — `e2e:onboarding` exercises some Settings
read paths incidentally; rely on `npm run verify`'s route audit and the
manual check in Step 5 for this page).

- [ ] **Step 5: Load `/app/settings` in a browser at 1440px and 390px**

Expected: warm card look, legible badges, no layout break at narrow width.

---

### Task 8: Home visual migration

**Files:**
- Modify: `src/styles.css` (any Home-specific selectors beyond the shared
  `.glass-hero`/`.glass-panel` already done in Task 3 — grep `src/app/app/page.tsx`
  and `src/components/home/**` for every `className` they use, then grep
  each class name in `styles.css` to find what's left to re-skin)
- Modify: `src/components/home/TodayFocusCard.tsx`, `TodaySequence.tsx`,
  `NextActionCard.tsx` only if Step 1 finds a hardcoded color/font or a
  status `<span>` that should become `<Badge>`

**Interfaces:**
- Consumes: tokens from Tasks 1-5, `Badge` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Enumerate every class name Home's components render**

```bash
grep -ohE "className=\"[^\"]*\"" src/app/app/page.tsx src/components/home/*.tsx | sort -u
```

For each class name found, confirm it's covered by Task 3 (if it's a
`glass-*` class) or grep it in `styles.css` and apply the Task 1-5 token
mapping to any literal hex/retired-token reference still present.

- [ ] **Step 2: Identify any plain-text status indicator in Home's JSX (e.g.
  a countdown urgency label, a coverage-vs-mastery note) that would read more
  clearly as a `<Badge>`, and convert it** — read each file first; don't
  guess at JSX that hasn't been confirmed.

- [ ] **Step 3: Run `npm run verify` and `npm run e2e:home`**

Expected: all pass; update any copy-assertion per Global Constraints if Step
2 changed label text.

- [ ] **Step 4: Load `/app` in a browser at 1440px and 390px**

Expected: the countdown reads in `--font-mono` (tabular figures), the hero is
the Task-3 solid warm-ink panel, signal cards are warm-bordered.

---

### Task 9: Tests visual migration

**Files:**
- Modify: `src/styles.css` (Tests page selectors — grep `src/app/app/tests/**`
  and `src/components/tests/**` for class names, same enumeration approach as
  Task 8 Step 1)
- Modify: `src/app/app/tests/page.tsx` (already has an inline `var(--blue)`-
  style occurrence renamed in Task 2 — confirm its *value*, not just its
  name, reads correctly here) and any `src/components/tests/*.tsx` file where
  Step 2 finds a state indicator (due/in-progress/scored) that should become
  a `<Badge>`

**Interfaces:**
- Consumes: tokens from Tasks 1-5, `Badge` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Enumerate class names (same command pattern as Task 8 Step 1,
  scoped to `src/app/app/tests/**` and `src/components/tests/**`), re-skin
  any literal hex/retired-token reference found in `styles.css`.**

- [ ] **Step 2: Convert due/in-progress/scored state indicators to `<Badge
  tone="...">` with the state's existing text label retained** (Review Focus:
  color-not-only — the label stays, only the visual treatment changes).

- [ ] **Step 3: Run `npm run verify`, `npm run e2e:tests-scope`,
  `npm run e2e:taking`, `npm run e2e:results`**

Expected: all pass; update copy assertions per Global Constraints if Step 2
changed any label text.

- [ ] **Step 4: Load `/app/tests` and start a test attempt in a browser at
  1440px and 390px**

Expected: paper cards in the new palette, state badges legible and carrying
their text label, test-taking interface unchanged in layout/interaction, only
re-colored.

---

### Task 10: Curriculum visual migration

**Files:**
- Modify: `src/styles.css` (the "Curriculum roadmap (C3)" section — phase bar,
  milestone list, and any other Curriculum-specific selectors)
- Modify: `src/components/curriculum/RoadmapView.tsx` (has an existing
  reference needing the Task 1-2 token mapping confirmed, per the earlier
  grep) and any other `src/components/curriculum/*.tsx` where Step 2 finds a
  status label to convert to `<Badge>`

**Interfaces:**
- Consumes: tokens from Tasks 1-5 (critically `--phase-*`, already re-chosen
  in Task 1), `Badge` from Task 4.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Read the "Curriculum roadmap (C3)" CSS section in full and
  confirm the phase bar reads its colors from `var(--phase-first-pass)` etc.
  rather than a hardcoded hex — if it hardcodes, replace with the token.**

- [ ] **Step 2: Convert milestone topic names to render in `var(--font-display)`
  and week-ranges in `var(--font-mono)` where the current markup allows it
  without a structural change** (read `RoadmapView.tsx` first to confirm
  exactly where topic name and week-range text render).

- [ ] **Step 3: Convert any ad-hoc milestone-phase label `<span>` to `<Badge
  tone="accent|gold|...">` matching the phase, keeping the phase name as the
  label text.**

- [ ] **Step 4: Run `npm run verify`, `npm run e2e:roadmap`, `npm run
  e2e:class-route`**

Expected: all pass; update copy assertions per Global Constraints if Step 2
or 3 changed any label text (the roadmap test suite asserts on phase name
strings like "first_pass" in several places per the existing test file —
confirm those still match before considering this task done).

- [ ] **Step 5: Load `/app/curriculum` in a browser at 1440px and 390px**

Expected: phase bar in the new warm phase-color family (accent green →
warm slate-blue → gold → brick red, not blue → cyan → green → amber),
milestone list shows serif topic names and mono week-ranges.

---

### Task 11: Visual-snapshot script

**Files:**
- Create: `scripts/visual-snap.ts`
- Modify: `package.json` (add a script entry)

**Interfaces:**
- Consumes: Playwright (already a dependency per `package.json`'s existing
  `test:e2e:browser` script using `playwright test`).
- Produces: PNG snapshots under a gitignored output directory, reviewed by
  eye before Task 12 (Calendar) — this is the one surface with no other
  automated "does this look right" check.

- [ ] **Step 1: Confirm Playwright is already a project dependency**

```bash
grep -n "\"playwright\"\|\"@playwright/test\"" package.json
```

Expected: present (the existing `test:e2e:browser` script already depends on
it). If absent, stop and report — do not silently add a new dependency
outside this task's scope.

- [ ] **Step 2: Write `scripts/visual-snap.ts`**

```typescript
/**
 * Visual baseline — not a pass/fail assertion, a review aid. The 430+
 * existing checks are HTTP-and-text assertions: they cannot catch "this page
 * looks broken," only "this HTML still contains the right strings." This
 * captures ~10 routes at three widths so a person can look at them.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE_URL = process.env.SNAP_BASE_URL ?? 'http://localhost:3000'
const OUT_DIR = 'scripts/.visual-snap-out'

const ROUTES = [
  '/',
  '/app',
  '/app/settings',
  '/app/tests',
  '/app/curriculum',
  '/app/calendar',
  '/onboarding/exam',
  '/onboarding/route',
  '/onboarding/week',
  '/onboarding/plan',
]

const WIDTHS: [string, number][] = [
  ['375', 375],
  ['834', 834],
  ['1440', 1440],
]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  for (const [label, width] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    for (const route of ROUTES) {
      const safeName = route === '/' ? 'root' : route.slice(1).replace(/\//g, '-')
      try {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.screenshot({ path: `${OUT_DIR}/${safeName}-${label}.png`, fullPage: true })
        console.log(`  ✓ ${route} @ ${label}px`)
      } catch (e) {
        console.log(`  ✗ ${route} @ ${label}px — ${(e as Error).message}`)
      }
    }
    await page.close()
  }
  await browser.close()
  console.log(`\nSnapshots written to ${OUT_DIR}/`)
}

main()
```

- [ ] **Step 3: Add the script entry to `package.json`**

```json
"visual:snap": "tsx scripts/visual-snap.ts",
```

- [ ] **Step 4: Add `scripts/.visual-snap-out/` to `.gitignore`** (or the
  project's equivalent ignore file — check which exists; this project has no
  git repo per the environment, so this step only matters if/when one is
  initialized — add the line regardless, for when that happens).

- [ ] **Step 5: Run it against the dev server**

```bash
npm run dev &
sleep 3
npm run visual:snap
```

Expected: `scripts/.visual-snap-out/` contains 30 PNGs (10 routes × 3
widths), each logged as `✓`. Routes that need auth (`/app/*`) will likely
fail without a session — if so, note which routes need a signed-in context
and move the auth'd routes' review into the manual per-task browser checks
already specified in Tasks 6-10, rather than blocking this task on scripting
a login flow it wasn't asked to build.

- [ ] **Step 6: Visually review every PNG produced**

Look for: text spilling outside its card, illegible contrast, a leftover
blue/green/amber/red pixel anywhere, broken layout at 375px. Report findings
before Task 12 begins — Calendar is the highest-risk remaining surface and
should start from a confirmed-good baseline on everything else.

---

### Task 12: Calendar visual migration (visual layer only)

**Files:**
- Modify: `src/styles.css` (the "Calendar", "Calendar blocks", and "Calendar
  editing (C2)" sections)
- Modify: `src/components/calendar/ConflictDialog.tsx` (inline `var(--blue)`-
  style usage already renamed in Task 2 — confirm value, not just name, reads
  correctly) and `src/components/calendar/blockFace.tsx` if it hardcodes any
  `--layer-*` color resolution that needs confirming against Task 1's new
  values
- **Do not modify:** any file computing block position/size from pixel
  measurements, the `repeat(7, minmax(115px, 1fr))` grid-template-columns
  declaration, or any drag/resize event-handler logic.

**Interfaces:**
- Consumes: tokens from Tasks 1-5 (critically `--layer-*`, re-chosen in Task
  1), `Badge` from Task 4 if any status chip in the toolbar fits it.
- Produces: nothing new for later tasks (last task in the plan).

- [ ] **Step 1: Read the three Calendar CSS sections in full**

- [ ] **Step 2: Confirm the grid-template-columns rule
  (`repeat(7, minmax(115px, 1fr))` or equivalent) is untouched** — grep for it
  before and after this task's edits and diff the two greps to prove it:

```bash
grep -n "minmax(115px" src/styles.css
```

Run this once before any edit in this task and once after; the two outputs
must be byte-identical (same line content, line number may shift if earlier
lines in the file changed length, which is fine — the rule's content must not
change).

- [ ] **Step 3: Re-skin block-face colors to read from the Task-1 `--layer-*`
  values** (they already read by token name per the codebase's existing
  design — this step confirms rather than restructures, same pattern as Task
  5 Step 2).

- [ ] **Step 4: Re-skin the day-strip, toolbar, and dialog surfaces
  (`ConflictDialog`, the commitment/next-class dialogs) onto the warm palette
  and shadow tokens from Tasks 1 and 5.**

- [ ] **Step 5: Run `npm run verify` and `npm run e2e:calendar`**

Expected: all pass except the pre-existing, already-documented "End-of-cycle
rollover" date-dependent failures unrelated to this work (see prior session
notes) — any *new* failure introduced by this task must be fixed before
moving on; a pre-existing failure is not grounds to skip verifying the rest
of the suite passes.

- [ ] **Step 6: Load `/app/calendar` in a browser at 1440px and 390px, and
  manually drag-resize one block**

Expected: the grid still measures and places blocks identically to before
this task (same column widths, same drag behavior) — only color/type/shadow
changed. Cross-check against the Task 11 snapshot of `/app/calendar` for
anything that regressed.

- [ ] **Step 7: Run the full regression sweep one final time**

```bash
npm run verify
npm run e2e:onboarding
npm run e2e:home
npm run e2e:roadmap
npm run e2e:class-route
npm run e2e:calendar
npm run e2e:tests-scope
npm run e2e:taking
npm run e2e:results
```

Expected: every suite green except the one pre-existing, already-documented
Calendar date-dependent failure. This is the plan's final verification gate.
