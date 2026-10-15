# Curriculum workspace — final plan (draft for approval)

Supersedes the phase list in `2026-09-19-curriculum-and-los-tracker.md` (Phase 1 of that plan, the Readiness tracker, is built and is reused here).

## 1. What the page is

Curriculum is the student's **map and workspace for the whole syllabus**: where they stand, what to fix, their own notes and flashcards, and their test history — per subject and per reading. It does **not teach content**. Content (the CFA/Schweser material) trains the AI that writes tests and explains relevance; the student sees only short original outcome descriptions.

## 2. Structure (three levels, Notion-like)

**Level 1 — `/app/curriculum`: ten subject cards**, in roadmap sequence. Each card: subject name, exam relevance line, band mix (Repair / Verify / Maintain / Untested), readings covered, last checked, open repairs. Filter: by confidence state. Tabs: Overview · Roadmap.

**Level 2 — `/app/curriculum/[subject]`: reading cards.** Every reading (63 in total) is a card inside its subject: title, coverage state, verdict chip, confidence mark, "covered in class" tag. Also on this page: subject notes, subject flashcards, subject test history, the subject's AI relevance note.

**Level 3 — reading page (click a card):**
- 2–3 line outcome description (original wording, the only "content" shown) + "why it matters for the exam" line from the AI
- Status: coverage, verdict, self mark vs evidence
- Test history for this reading (attempts, per-question result, confidence given, verdict per question)
- Repairs and scheduled tasks for it
- Notes (block editor) · Flashcards
- Actions: Check this reading, Plan a repair, Log class coverage

## 3. Confidence model (student mark × evidence, verified by the AI)

Per answered question the student gives confidence; the system combines it with correctness and the AI's read of the attempt (time taken, changed answer, which distractor was chosen, repeat pattern in the same outcome).

| Confidence | Result | Verdict | Consequence |
|---|---|---|---|
| High | Wrong | **Concept miss** | Repair, highest priority; a differently worded retest is scheduled |
| Low | Right | **Guess** | Verify; not counted as mastery |
| High | Right | **Secure** | Maintain candidate, needs 2+ observations |
| Low | Wrong | **Known gap** | Repair, expected |
| Mid | any | **Unsettled** | Verify until a second observation |

**Per reading / outcome: an overall student mark + AI verification.** The student marks overall confidence (Not started / Shaky / Fairly sure / Solid). Evidence verifies it, producing one of: Verified, Overconfident, Underconfident (marks low, scores well → still goes to revision), Unassessed. Situational rules: recency decay (21 days), sample size, and repeated misses outrank one good result. The verdict shows **only on this page** (Home and Coach read from it).

"Taught again" means a **repair task pointing the student to the reading/outcome** in their own materials, never content delivered by the app.

**Manual changes:** the student may override coverage or a verdict. A warning is shown, the row is tagged "manual", and the change is logged. The AI's evidence verdict stays visible beside it and can say "evidence disagrees".

## 4. Notes (Notion-style, more structured)

- Notes attach to a **subject** or a **reading** (one page each, plus optional sub-pages later).
- Block editor: headings, text, bullets, checklists, toggles, callouts, **tables**, dividers, **links and link embeds** (URL preview), quotes, code/formula text.
- Structured extras: each note page opens with fixed sections — "Key ideas", "Common mistakes", "Formulas" — that the student can rename or hide. A "Mistake log" block can pull in their own wrong answers for that reading (read-only reference).
- Autosave with a revision guard (same optimistic-concurrency pattern as tasks). Stored as block JSON.
- **Embeds are by URL only in v1** (Drive/Notion/YouTube/web links). Uploading files or docs is a later, paid feature — this matches the earlier decision that private materials are premium.
- Editor library: a Notion-style block editor (BlockNote or TipTap). Adds a dependency; needs your approval.

## 5. Flashcards

- Decks per reading and per subject.
- Student-authored, plus AI-drafted cards **from the outcome description and the student's own wrong answers** (original wording, student approves before saving).
- Spaced repetition (simple scheduler: Again / Hard / Good / Easy).
- **Flashcard ratings are self-report only** and never move a verdict band (activity is not understanding). Only tests do.

## 6. Class-led logging (Calendar)

- In the Calendar, "Log what we covered": pick the reading, then the outcomes or part covered (or a short free-text portion), with certainty (sure / roughly).
- Stored as coverage logs; a reading can be part-covered across several classes. Feeds the weekly plan (consolidation for what was taught) and shows as a "covered in class" tag on the reading card. It is exposure, never evidence.
- Built now inside Calendar only. Class-led vs self-study paywall split comes later.

## 7. Data (additive)

| Table | Purpose |
|---|---|
| `reading_outcomes` (or `learning_modules.summary` + `relevance_note`) | The 2–3 line outcomes and AI relevance text, 63 rows |
| `curriculum_notes` | `user_id, scope_type, scope_id, blocks jsonb, revision` |
| `flashcards`, `flashcard_reviews` | Cards and scheduling; deck = scope |
| `coverage_logs` | Class/self coverage per reading, portion, certainty, date |
| `confidence_marks` | Student overall mark per reading/outcome, with `manual_override` + reason |
| Derived (no table) | Verdicts and bands, computed from evidence + marks |

All user tables get RLS (own rows only) and are written through checked routes.

## 8. Question bank (separate track, Tests tab)

Parallel workstream: original questions per reading, in the existing item schema with review tiers, written to test the concepts in your CFA/Schweser texts. **They must be original, not reproduced.** Target: per-reading minimums that satisfy the paper thresholds (5–9 items per module). Needs your source files and a review process (see questions). Curriculum works with an honest empty state until each reading has enough items.

## 9. Build phases

| # | Phase | Ships |
|---|---|---|
| 0 | Content: 63 reading outcome descriptions + subject relevance lines (I draft, you review) | Data seed |
| 1 | Subject cards → reading cards → reading page, roadmap order, confidence filter, existing tracker embedded | The new structure |
| 2 | Test history per subject and reading | History tab |
| 3 | Confidence engine: verdict matrix, overall mark, AI verification, manual override with warning | The core logic |
| 4 | Notes editor | Notes on subjects and readings |
| 5 | Flashcards | Decks + review |
| 6 | Calendar class logging | Coverage feed |
| 7 | Home, Coach and the weekly review read the same verdicts | Cross-page truth |
| T | Question bank build | Runs in parallel from Phase 0 |

Each phase has live e2e tests on the dedicated `+e2e` account, and nothing writes on render.

## 10. Open decisions

1. Editor library approval (BlockNote or TipTap) and URL-only embeds in v1.
2. LOS granularity for class logging: do we keep our own short outcome list per reading, or portion by free text?
3. Where the CFA/Schweser texts are, and whether questions are AI-drafted with your review.
4. Flashcards as self-report only.
5. Confidence scale: 3-level (Low / Medium / High) or 4-level?
