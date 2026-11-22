# UI/UX overhaul plan (started 21 Nov 2026)

Goal: studying should feel light and rewarding, yet stay calm, elegant and professional. Product rules do not change (no lessons, no pass predictions, no blended readiness score, cards and practice never create "demonstrated" evidence). This is look, feel, layout and button placement only.

## Design direction (revised after Phase 0 feedback)
References: apple.com, logitech.com, kaptest.com. Direction: quiet, confident, premium; colour is used for action and meaning, not decoration.
- **Colour:** graphite neutrals (Apple-style light grey canvas in Light, near-black graphite in Dark), one cobalt blue for the main action and current selection, amber for reward moments, green for done/correct, red for problems. No purple or indigo anywhere.
- **Themes:** Light, Dark and System (follows the device). A three-way switch sits in the sidebar; the choice is saved in a cookie so the right theme is painted before the page shows.
- **Type:** Geist (UI and headings, tight tracking on headings) and Geist Mono for numbers and timers. A display serif may be added for landing-page headlines in Phase 9 only.
- **Liquid glass:** buttons are translucent with blur, a bright top edge and soft depth; main buttons are tinted cobalt glass. Glass is kept to controls (and later floating bars and sheets) so text surfaces stay solid and readable.
- **Shape:** 10/14/22 px radii, neutral shadows, borders for structure.
- **Motion (design-motion-principles):** lift on hover, springy press, small celebrations on completion; frequent actions stay instant; reduced motion respected.
- **Tile layouts:** redesigned page by page in Phases 2-9, not in the foundation.
- **Dopamine without noise:** progress ring, streak chip, completion moments, friendly empty states. No fake urgency, no pass predictions, no blended score.

## Phases (one at a time; you check each before the next)
| # | Scope | Status |
|---|---|---|
| 0 | Foundation: tokens, fonts, Light/Dark/System, glass buttons, focus, motion tokens (revised v3) | **built, awaiting your check** |
| 1 | App shell: sidebar, mobile tab bar, page transitions (theme switch already built) | **built, awaiting your check** |
| 2 | Home: one-screen board (done first, at your request) | **built, awaiting your check** |
| 3 | Calendar (week grid, task drawer, dialogs) | **built, awaiting your check** |
| 4 | Curriculum (tracker, roadmap, notes, flashcards) | **built, awaiting your check** |
| 5 | Tests (preflight, attempt runner, results, repairs) | **built, awaiting your check** |
| 6 | Coach | **built, awaiting your check** |
| 7 | Log, Review week, Exam, Materials, Settings | **built, awaiting your check** |
| 8 | Onboarding and auth screens | **built, awaiting your check** |
| 9 | Landing page, demo, privacy, terms, error and empty pages | **built, awaiting your check** |
| 10 | Final polish sweep: hard-coded colours, spacing audit, motion audit, accessibility, dark-mode pass | **built, awaiting your check** |

## Phase 0 — what you check by hand
Open the app in a normal window, then a phone-width window (or your phone on the same network). Pages will look recoloured but not yet re-laid-out; that is expected.
0. **Theme switch:** bottom of the sidebar has three small icons (sun / monitor / moon). Try each; reload and confirm it stays. System should follow your computer.
1. **Colours:** Home, Calendar, Curriculum, Tests, Coach, Settings. Is there any page that still looks green/beige/purple (old brand) as a big block? Note the page and the element.
2. **Text:** can you read everything easily? Pay attention to grey helper text and small labels.
3. **Font:** all text should be one clean sans (Geist); numbers and timers monospaced. No serif headings anywhere.
4. **Buttons:** main buttons are blue glass, secondary ones clear glass with a bright top edge. Hover lifts, press shrinks. Disabled ones look flat. Check white text on blue is easy to read.
5. **Keyboard:** press Tab through a page. Every stop needs a clear blue ring, including text boxes.
6. **Dark theme:** switch your computer to dark appearance and reload. Look for white boxes, invisible text, unreadable buttons. List each one.
7. **Reduced motion:** turn on "Reduce motion" in your system settings; nothing should bounce or slide.
8. **Phone:** nothing overflows sideways; buttons are easy to tap.

Reply with what felt wrong (page + element). Say "go" to start Phase 1.

## Known leftovers (handled in the page phases, not forgotten)
- About 60 hard-coded colours remain in feature CSS (old greens, amber text, some borders). They are replaced page by page as each page is redesigned.
- Landing page still uses its old layout until Phase 9.
- No theme switch yet (Phase 1).

## Phase 1 — what you check by hand (app shell)
1. **Sidebar (laptop):** pill-shaped menu items, the open page filled in soft blue (no side stripe). At the bottom: theme switch, your name, Settings, and a quiet "Sign out" (hover shows "Sign out of this device"). Nothing should wrap or look cramped.
2. **Phone tab bar:** a floating glass bar at the bottom with Home, Calendar, Curriculum, Tests, More. The open page is highlighted. Content scrolls behind it and the last card is not hidden.
3. **More:** opens the menu with Coach, Settings, theme switch and Sign out. Close it with the X, Escape or a tap outside.
4. **Ask Coach button:** on phone it sits above the tab bar, not on top of it.
5. **Live paper:** during a running test there is no tab bar (focus mode); the small menu button top-left remains.
6. **Page change:** moving between pages gives a very quick fade (no sliding). With "Reduce motion" on, none.
7. **Dark and light:** repeat 1-2 in both.

## Phase 1b — pages reached from Home (22 Nov 2026)
Every link on Home was followed (nav, tasks, week tiles, roadmap, signals, exam): all resolve with no errors. Review-week, Log, Exam, Calendar log-class and mock-report, Coach, Tests, Curriculum (all five tabs), Flashcards and Settings were opened and checked in light and dark.
- Found and fixed: 182 class names used in the app had no CSS rule at all (for example the whole weekly-review form, `muted`, `review-error`, reading and class-log blocks). Core ones now have rules; the rest follow in each page's phase.
- Weekly review: now a narrow, card-based page with a "← Home" link, pill-style answer choices and clear error/hint text.
- Plain checkboxes, radios, selects, fieldsets and text links share the house look inside every app page.
- Curriculum tabs and the Roadmap hero follow the cobalt direction (the hero was black in light and white in dark); Coach's Send button is cobalt.
- Not yet redesigned (their own phases): tile layouts on Calendar, Curriculum, Tests, Coach, Settings.
- Known: /app/tests/review, /app/tests/manifest, /app/settings/sources and /app/materials return "Page not found" when opened bare; Home does not link to them.

## Phase 3 — what you check by hand (Calendar)
1. **Week view:** day columns with soft-tinted study chips (no coloured side stripes), a quiet grey "Work/Commitment" block, the Sunday paper in amber. Titles wrap at word boundaries.
2. **Agenda view (phone default):** each day a card list; times sit above the title on phones.
3. **Top bar:** "Week details" is a pill that opens the summary; Week/Agenda switch, filters and the two Add buttons share one row (two columns on phones).
4. **Open a task:** the side sheet (bottom sheet on phones) has clear sections; Done is the one blue button.
5. **Add study task / Add commitment / Add a mock:** dialogs share one field style; the page behind is dimmed and blurred, including the sidebar and tab bar.
6. **Ask Coach button:** hidden on Calendar so it never covers the grid (Coach stays in the sidebar and More).
7. **Light and dark:** repeat 1-5 in both.

Also fixed this round: dialogs were sitting *under* the sidebar and tab bar (a stacking problem from the page fade); the duplicate-key console error when a class is moved onto a day that already has it; three stale tests (sign-out is server-side, "Done" button name, dev cache header).

## Phase 4 — what you check by hand (Curriculum)
1. **Overview:** "Where you are" is one clean card; search is a pill; filter chips are pills (open one, it turns soft blue); each subject is a card whose readings are quiet rows with the number on the left.
2. **Roadmap:** the phase bar, "Does this fit?" and milestone cards have no coloured side stripes (tinted full borders instead). In dark mode the blue hero's small lines are readable.
3. **Readiness:** the four Repair / Verify / Maintain / Untested tiles are tinted tiles, not striped; outcome rows likewise.
4. **Notes, Cards, a subject page and a reading page:** cards, editor toolbar and confidence pills share the same look.
5. **Light and dark, laptop and phone:** repeat 1-4.

Also this round: removed the two empty folders behind the "Page not found" for /app/settings/sources and /app/materials. /app/tests/review and /manifest stay hidden from students on purpose (reviewer role).
Tests hub (/app/tests) styling is Phase 5.

## Phase 5 — what you check by hand (Tests)
1. **Tabs:** This week / Practice and checks / Mocks are pills like Curriculum; the open one is soft blue.
2. **This week:** the weekly-paper card is one raised card with a thin blue border (no thick outline), clear heading and one blue action.
3. **Practice and checks:** the five check types are tiles; the chosen one is soft blue. Subject and Reading selects line up.
4. **History:** an empty history is a dashed placeholder; past papers are cards with the score on the right and a hover lift.
5. **Mocks:** the rehearsal explanation and the "Plan a mock" links read clearly.
6. **Running a paper and a result page** (need questions in the bank, so I styled them but could not screenshot them): question dots turn blue when answered, confidence choices are pills, the clock is monospaced; result sections are cards and tables have a quiet header row.
7. **Light and dark, laptop and phone.**

## Phase 6 — what you check by hand (Coach)
1. **Top card:** "What I am working from" is one quiet card with the Curriculum / Tests / Calendar links.
2. **Conversation:** your messages are soft-blue bubbles on the right; the Coach's are white (dark: raised) cards with a small blue avatar. Action buttons inside a reply wrap instead of overflowing.
3. **Suggestions:** three pill buttons above the box turn soft blue on hover.
4. **Message box:** a rounded box with a blue focus ring and a blue Send button; on a phone it is taller so your text is not cut off.
5. **Result page (Phase 5 follow-up):** the "Difficulty delivered…" line is now a card of its own, and sections inside an open group are no longer cards in cards.
6. **Light and dark, laptop and phone.**

## Phase 7 — what you check by hand (Log, Exam, Settings, Review week)
1. **Log learning (/app/log):** one card; "What did you do?", "Which reading?", "How long?" and "When?" are plain headings, not boxes inside boxes. "Choose an earlier day", "Enter different minutes" and "Add a note" have a small arrow and open on tap.
2. **Exam (/app/exam):** "Your exam" is a card; after the exam day the "After the exam" and retake panels are cards too.
3. **Settings (/app/settings):** the four setup cards, Reminders, Download calendar and now Account are all cards of the same weight; the delete-account box sits inside Account.
4. **Review week:** unchanged since Phase 1b.
5. **Materials:** there is no Materials page (the empty folder was removed), so nothing to check.
6. **Light and dark, laptop and phone.**

## Phase 8 — what you check by hand (auth and onboarding)
1. **Sign in, Create account, Forgot password, Verify email:** the logo is now the same blue check-in-a-box as inside the app (it was a "//" mark). Everything else on these pages was already on the new look and is unchanged.
2. **Private beta page (/not-invited):** now a centred card instead of loose text on grey.
3. **Onboarding (5 steps):** already on the new look (blue active step, soft-blue selected choices, disabled Continue until you choose). On a phone the step list scrolls sideways and the logo can sit slightly cut off when it scrolls; I left that as it is.
4. **Light and dark, laptop and phone.**
Not seen: the later onboarding steps (study route, where you are, your week, review) and update-password; I only captured step 1.

## Phase 9 and 10 — what you check by hand
1. **Landing (/):** dark hero and dark closing band in light AND dark mode; stat cards with large numbers; short copy. Scroll the whole page.
2. **Walkthrough (/demo):** card with a 5-segment bar; finish all five steps.
3. **Sign in (/login) in dark mode:** the navy "How Roadmap works" panel on the right is readable (it was dark-on-navy).
4. **Privacy, Terms, not-found, error pages:** same logo as the app.
5. **Everywhere:** no thick coloured left edges any more; keyboard Tab shows a blue ring on links, buttons and summaries; with "Reduce motion" on nothing lifts or slides.
6. **Where the CSS lives:** later passes are in src/overhaul.css (imported after styles.css).
