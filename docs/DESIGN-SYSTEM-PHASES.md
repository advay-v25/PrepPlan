# Design system: phased overhaul

Written 2026-09-26. Built on what the code *actually* contains today, not on the older onboarding plan's Part D,
which is now partly out of date.

## Where things really stand (Phase 0 audit)

Already done, and worth not redoing:
- Token layer in `:root`: spacing, type, radius, elevation, control heights, named z-index layers, motion durations.
- Primitives in `src/components/ui/`: `Button`, `Card`, `Dialog`, `Field`, `Notice`, `ProgressRing`.
- One correct focus-trap hook (`useFocusTrap`: scroll lock, `[href]`, disabled/hidden filtering).
- Defects the old plan listed that are **already fixed**: the failing focus ring (now a solid 2px), `Reveal` rendering
  invisible content server-side, toast/modal stacking (named z-layers).

Genuinely still open (measured, not assumed):
- The `Dialog` primitive had **zero consumers**; five dialogs each carried their own diverging copy of the trap.
- ~20 raw hex colors and many raw `5/6/7px` radii outside the token layer.
- Two coexisting input systems (`.field` / `.modal-card input` vs the `Field` primitive).
- 88 lines in `src/styles.css` are over 200 characters (effectively undiffable); dead rules remain.
- No visual (browser) check exists for any surface; all 430+ checks are HTTP-level.

Note on the requested skill: `taste-skill:design-taste-frontend-v1` does not exist. I used the closest one,
`taste-skill:taste-skill-v1`. It assumes a greenfield Tailwind + Framer Motion marketing site (bento grids, glass,
perpetual animations). This app is plain CSS with a tested, accessible product UI, so I take its *principles*
(deliberate type and color, real empty/loading/error states, restrained motion, no cliché patterns) and apply them
through the existing tokens rather than rewriting the stack, which would break every green check.

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Audit against the real code | **Done** |
| 1 | **Overlay unification**: all five dialogs and drawers onto the one `Dialog` primitive | **Done, verified in a browser** |
| 1b | **Calendar blocks**: full redesign (`blockFace.tsx` + the "Calendar blocks" section of `styles.css`) | **Done, verified in a browser** |
| 2 | Forms: move `.field` / `.modal-card input` users onto `Field`; error wiring; fix the weekday picker wrap | Next |
| 3 | Tokenize the stray colors and radii; promote calendar-layer and phase colors into `:root` | Planned |
| 4 | Surface migration in risk order: Settings and Home, Coach, Tests and Results, Curriculum, Calendar grid last | Planned |
| 5 | Product polish with the taste principles: type hierarchy, tabular numerals, empty/loading/error states, motion under `prefers-reduced-motion` | Planned |
| 6 | De-minify `styles.css`, delete dead rules, add `scripts/visual-snap.ts` at 390 / 834 / 1440 | Planned |

Order matters: Phase 6's snapshots should exist **before** Phase 4 touches the calendar grid, whose 115px columns
carry the most fragile geometry.

## Phase 1 detail (done)

- `ConflictDialog`, `NewTaskDialog`, `CommitmentDialog`, `ChallengeDialog`, `TaskDetailDrawer` now use `Dialog`.
- `Dialog` gained: `title` accepts a node (for a warning icon), an `eyebrow` slot (drawer's layer tag), and the
  primitive's footer now stacks full-width on mobile like the old one did.
- Bugs closed by construction: two dialogs let Tab escape to links; none filtered disabled or hidden fields; none
  locked page scroll.
- Verified in a real browser: scroll lock on and restored, focus contained across 9 Tab presses, Escape closes,
  labelled dialog, correct layout at 1440 and 390 wide. Suites: calendar 35/35, editing 40/40, routes 26/26,
  taking 64/64, integration 44/44.
- Dead rules now safe to delete in Phase 6: `.dialog-overlay`, `.drawer-overlay`, `.modal-card`, `.modal-layer`,
  `.task-drawer` (the drawer body classes such as `.task-drawer__facts` are still used).
- **Not yet checked in a browser:** the task drawer (the test account's week has no tasks) and the conflict dialog.

## Found while doing this (not design, but real)

- `scripts/e2e-calendar.ts` began failing after the question-bank build: two unscoped diagnostics now draw the same
  concepts, and a concept never re-opens a repair thread it already has. That is correct product behavior; the test
  assumed a tiny bank. The second diagnostic is now scoped to reading `r028`. Suite is back to 35/35.
- The mobile weekday picker leaves "Sat" alone on a full-width row. Phase 2.

## Calendar blocks (Phase 1b, done)

- A block is now a card: layer-colored left rail, an icon **and** a word for its type (never color alone), and a
  time range with a short duration ("5:30–7pm · 1h 30m").
- What a block shows depends on its height: `xs` one line, `sm` title and time, `md` two-line title, `lg` type,
  title, time and status. Short titles truncate on one line with the full title as a tooltip.
- States: done keeps its text readable (green check, muted surface, no strikethrough or fade); partly done gets a
  half progress bar and a label; fixed commitments and classes are hatched with a lock, so they read as constraints.
- Week grid, "no set time" chips, "not yet placed" chips, agenda rows and the legend share the one look.
- Each block's button carries a single spoken summary (type, title, time, length, status, fixed) as its label.
- Layer colors now come from the `--layer-*` tokens instead of hard-coded hex.
- Verified in a browser at 1440 (week) and 390 (agenda) with a seeded week covering every layer, short and long
  blocks, done and partial states, a class and the 8-hour Work commitment. Seed rows were removed afterwards.
- **Not exercised in a browser:** dragging and resizing, and opening the task drawer from a block. Those handlers
  are unchanged and the block keeps the same class names, but I did not drive them by hand.
