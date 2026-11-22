# Analysis + Onboarding v3

**Author:** Dwight (hive) · **Date:** 4 Sep 2026 · **Status:** findings + build spec, awaiting sign-off
**Supersedes for onboarding:** `ONBOARDING-V2.md` §4, `PHASE-1-FINAL.md` §7, `ONBOARDING-SPEC.md` §3.
Everything else in those documents stands.

---

## 0. The one-paragraph read

The product is a **learning control system for CFA Level I**, not a tutor and not a content library. Its loop is `coverage → verification → diagnosis → intervention → re-verification` (`PRODUCT-REVIEW-v1.md` §1). It plans **one week at a time**, tests constantly, and uses the test results — never self-report — to re-cut the next week. The user brings their own material; we supply structure, measurement and accountability (`PRD-v1.md` §1, D3).

Onboarding's only job in that system is to **collect enough context to build week 1 and to seed the tools**. It is not an assessment, not a qualification, and not a place where a plan is produced. That is now the explicit instruction from the founder, and it is also what the arithmetic supports — pass times observed in the wild range from ~3 months to ~12 for the same syllabus, so any population-level hour prescription is noise dressed as a fact.

---

## 1. What the build actually is today (verified, 4 Sep 16:58–17:02)

Typecheck is clean (`npx tsc --noEmit`, no output). The app runs. Nothing below is speculative — each item was read from the file named.

| Area | State |
|---|---|
| Onboarding | 5-step "study context" form, v4 envelope, all questions optional — `src/components/onboarding/OnboardingFlow.tsx` |
| Gates | Removed. `/onboarding/blocked` and `/onboarding/plan` are 2-line redirects to `/app`; `/api/feasibility` returns `410` |
| Planner | **Disabled.** `/api/plan` returns `409 WEEKLY_PLANNER_PENDING` — `src/app/api/plan/route.ts:8` |
| Dashboard | Reduced to a context echo plus six "prototype tool" links — `src/app/app/page.tsx` |
| Persistence | One JSON blob in `onboarding_sessions.answers` |
| Curriculum | **Absent.** `src/data.ts` holds 5 hard-coded demo subjects and 8 demo questions. No 102-module graph, no LOS, no edges |
| Schema | `supabase/schema.sql` already declares `availability_rules`, `class_schedules`, `user_materials`, `non_negotiables`, `learning_modules`, `lm_edges`, `user_module_state`, `user_rate_estimate`, `questions`, `plan_blocks` — all with RLS |

### 1.1 The defect that matters most

`src/lib/planning/scheduler.ts:33-35` reads the user's week from `availability_rules` and `class_schedules`.

`src/app/api/onboarding/route.ts:31` writes **only** `onboarding_sessions.answers`.

Nothing in `src/` ever inserts a row into `availability_rules`, `class_schedules`, `user_materials` or `non_negotiables`. So the scheduler's inputs are permanently empty, it falls through to its "seed two slots for everyone" branch (`scheduler.ts:38`), and every user would get the same generic week even if `/api/plan` were re-enabled. **The onboarding answers and the planner are not connected.** This is the real break behind "the onboarding build is broken."

### 1.2 The rest of the defect list, ranked

1. **The planner is switched off.** The product's entire promise — "we plan your week" — currently returns HTTP 409. Ungating access is right; disabling the deliverable is not. The user gets an account and then nothing to do.
2. **Availability is captured as decoration.** `availability: string[]` of `"3-Evening"` tokens inside the blob (`src/lib/study-context.ts:16`). Not queryable, not joined to anything, not slot-typed in the DB.
3. **The strongest signals are not asked.** Prior CFA L1 attempts, finance/quant background, and class *times* are the three inputs with the largest effect on both sequencing and pace (`EFFORT-MODEL.md` §3, `ONBOARDING-V2.md` §4). v4 asks none of them at slot/structured granularity. `background` is one free-text box.
4. **A question that changes nothing is still there.** "How do tests feel right now?" (`testComfort`) is read by zero lines of code. `ONBOARDING-V2.md` §2 explicitly cut it. It is a personality quiz.
5. **Materials never resolve.** `sources` is a chip list; `user_materials` is never written; there is no LM→provider mapping. Under D3 (we do not teach, we point) an unresolvable pointer means the product has no repair path at all. This is a correctness requirement, not a Phase-4 nicety (`PRD-v1.md` §2a).
6. **A silent gate survives.** `examMonth` is validated as `>= 2027` (`src/lib/study-context.ts:11`). A candidate sitting in Nov 2026 is rejected by a regex with the message "Use a month in 2027 or later." That is denying someone access, just quietly.
7. **File uploads are analysed and discarded.** `/api/materials/analyze` returns a relevance summary; the file, its structure, and any mapping are thrown away (`OnboardingFlow.tsx:90`). The user pays the upload cost and gets a sentence.
8. **No accountability contract is set.** D5 says the weekly diagnostic *is* the accountability mechanism. Onboarding never picks the diagnostic day, never sets a reminder, never names the failure mode. `checkInDay` is saved and, per the UI's own copy, "does not schedule notifications or email reminders."
9. **Resume is blob-shaped.** `onboarding_sessions.current_screen` / `partial` from `ONBOARDING-V2.md` §7 were never added; step lives inside the JSON.
10. **The look is a different product.** `onboarding.module.css` uses `Arial`, `--blue:#315dec`, 5–6px radii. `src/styles.css` uses `DM Sans`/`Manrope`, `--blue:#0b5cff`, `--radius:9px`, `--ink:#0b1b3b`. Two type systems, two blues, two radius scales. The onboarding screen does not look like the app it opens into — that is the "broken look."
11. **The copy apologises.** "Nothing here affects access to Roadmap." · "This is not a study contract or a prediction of your result." · "No plan was automatically assigned." Six defensive disclaimers on five screens. They are a correct *policy* rendered as anxious *voice*. A user reading this concludes the software is unsure of itself.
12. **Curriculum year mismatch, unresolved.** Every doc targets the **2027** curriculum (102 LMs). The founder's own material on `~/Desktop/CFA L1/` is the **2026** curriculum (CFAI V1–V10) plus 2026 Schweser Books 1–4. Nobody has reconciled these. See §6 Q1.

---

## 2. Where the prior work fell short

The prior documents are good — `PRD-v1.md`, `PRODUCT-REVIEW-v1.md` and `EFFORT-MODEL.md` are genuinely strong product thinking. They fail in three specific, correctable ways.

**2.1 They made access a judgement call.** `PHASE-1-FINAL.md` §7.2 / D6 specifies a **hard gate**: below `HARD_GATE_HOURS` or `HARD_GATE_MIN_WEEKS`, "No plan for this window." `ONBOARDING-V2.md` reversed this as D12 and the code is now ungated — correct, and it stays reversed. Recording why, so it never returns: gating is a product opinion wearing a safety jacket. We sell software that helps people use the time they have. We are not the registrar.

**2.2 They prescribed hours, then over-corrected into saying nothing.** `PHASE-1-onboarding-landing-login.md` §4 had `required = 310 × (1 − 0.55 × coverage) × stage_multiplier` — a population survey mean presented to an individual as a personal fact. `EFFORT-MODEL.md` correctly demolished it and replaced it with a per-user rate multiplier and a **range that narrows with evidence**. Then the 4 Sep build over-corrected in the opposite direction and removed estimation *entirely* — no projection, no planner, no honest read. Both extremes are wrong, and the distinction is already written down (`ONBOARDING-V2.md` §1):

| Operation | Verdict |
|---|---|
| Prescribing a target ("you need 300 hours") | Never |
| Estimating module effort internally to size and order a week | Required — nothing works without it |
| Reporting a projection as a widening/narrowing range, updated weekly | Kept, and it is the differentiator |

**2.3 They specified a data model and then wrote to a blob.** `ONBOARDING-V2.md` §7 and `supabase/schema.sql` both describe structured, queryable per-user context. The implementation writes one JSONB column. Every downstream consumer — scheduler, dashboard, coach, projection — has to parse a blob it cannot index, so none of them were wired, so the planner was disabled, so the product does nothing. §1.1 is the direct consequence of this.

**2.4 One thing nobody has started.** The 102-module curriculum graph with prerequisite edges is called "the single highest-value asset in the company" (`PRD-v1.md` §5.1) and "2–3 weeks of careful solo work." It does not exist in any form. `src/data.ts` has five demo subjects. Without it there is no sequencing, no prerequisite drag, no repair pointer, and no way to generate a test that means anything. **Onboarding v3 can ship without it; week 2 of the product cannot.**

---

## 3. Onboarding v3 — the spec

### 3.1 Rules

1. **No verdict, no gate, no denial.** There is no branch anywhere in this flow that ends in "you cannot proceed." Every field is optional; every path ends in the dashboard.
2. **We never state an hours requirement.** Not at onboarding, not later. Internally we estimate; externally we project a range and attribute every change.
3. **Onboarding collects; it does not plan.** It ends by handing a structured context object to the week-1 builder. The plan is agreed with the user afterwards, weekly.
4. **Ask only what we will use, but ask everything we will use.** The founder's instruction is *maximum context* — so the filter is not "is this a short form" but "does any tool in this product read this field?" Anything read by the scheduler, the test generator, the projection or the coach is in. Anything read by nothing is out (`testComfort`, "learning style", "why CFA", target score).
5. **Every screen is skippable and every answer is editable forever** from `/app/settings`.

### 3.2 The screens

Six screens, target under five minutes with everything skippable. Progress saves on every advance to structured columns, not a blob.

**S1 · Your exam.** Sitting window (any open CFAI window, **not restricted to 2027**) · registered yes/not yet/undecided · exact date if they have one · timezone (browser-detected, confirmed in one line).
→ `profiles.exam_sitting`, `profiles.exam_date`, `profiles.registered`, `profiles.timezone`.
*Used by:* horizon, weeks-remaining, every projection.

**S2 · Your week.** The 7×3 availability grid (morning/afternoon/evening — tap what is realistically free). Live, non-judgemental readout beneath: *"9 slots — roughly 13–18 hours."* A range, no target to compare against, no red text. Then **fixed commitments** as rows: type (class / work / travel / other) + weekday + start + end.
→ **one row per slot** in `availability_rules`, rows in `class_schedules`.
*Used by:* the scheduler, directly. This is the screen §1.1 is missing.

**S3 · Where you're starting.** Prior L1 attempts (never / once / twice+) · background chips (finance or accounting degree · works in finance · comfortable with maths and stats · studied in English · none of these) · current stage (not started / studying now / returning after a break / revision) · what they are covering right now (free text, feeds the first week's ordering).
→ `profiles.prior_attempts`, `profiles.background[]`, `profiles.stage`, `profiles.current_focus`.
*Used by:* the rate prior (weak, wide, overwritten by week 2), bridge-block injection, week-1 entry point.

**S4 · Your material.** Which sources they have (Schweser · CFAI curriculum · institute notes · nothing yet — "nothing yet" is a first-class answer) · optional coaching institute invite code · optional file upload.
→ rows in `user_materials`, `profiles.institute_id`.
Under D3 this determines whether a repair pointer resolves. Show the mapping honestly once it exists: *"We matched 94 of 102 modules to your material; for the other 8 we'll point you to the reading, not the LOS."* Never fabricate a pointer.

**S5 · How we keep you honest.** The accountability contract, currently absent entirely and the actual differentiator (D5).
Weekly diagnostic day — framed as the week's fixed point, not homework · reminder time and channel · **"What usually breaks your study plan?"** single-select: *I fall behind and can't catch up* · *I study but don't retain it* · *I avoid the topics I find hard* · *I can't tell if I'm actually ready*.
→ `profiles.diagnostic_day`, `profiles.reminder_at`, `profiles.reminder_channel`, `profiles.failure_mode`.
That last field selects which intervention the coach leads with. It is the only "how do you feel" question that changes product behaviour, and it replaces `testComfort` entirely.

**S6 · Check this.** Every answer, grouped, each inline-editable. Then the honest read — always shown, never blocking, phrased as observation not instruction:

> Your week has about 14 hours in it and there are 21 weeks to your sitting. We'll lead with the highest-weight material and tell you every week exactly where you stand.

Three registers (comfortable / tight / very tight), chosen by arithmetic, all ending in the same button: **Build my first week.** Never "Generate plan."

### 3.3 What onboarding hands over

```ts
type OnboardingContext = {
  horizon:     { sitting: string; exam_date: string | null; weeks_remaining: number; registered: boolean }
  capacity:    { slots: Slot[]; hours_low: number; hours_high: number }
  commitments: Commitment[]                                    // class | work | travel | other, recurring
  rate_prior:  { prior_attempts: 0|1|2; background: string[]; multiplier_low: number; multiplier_high: number }
  materials:   { providers: string[]; pointers_resolve: boolean }
  contract:    { diagnostic_day: number; reminder_at: string; failure_mode: string }
  institute:   { id: string | null }
}
```

Nothing in this object is a commitment made *to* the user about total hours. The rate prior is deliberately wide and is overwritten by the first two weeks of measured data (`EFFORT-MODEL.md` §5).

### 3.4 Progressive capture — what we deliberately do not ask now

| Captured | When | Replaces |
|---|---|---|
| Actual vs. planned block duration | First completed block | Any self-reported pace |
| 12-question placement diagnostic | Day 1–3, offered not forced | The module self-report grid |
| Skip reason, one tap | Whenever a block is skipped | Nothing — this is the real capacity signal |
| "Was that about right?" | End of week 1 | The honesty-discount guess |
| Per-topic materials check | First time that topic is scheduled | The full materials audit |
| Measured mastery | Every diagnostic | All self-reported knowledge |

**Onboarding buys the right to start; the product earns the rest.**

### 3.5 The look

Delete `onboarding.module.css` as a separate design language. Onboarding renders in the app's system: `Manrope` headings / `DM Sans` body, `--blue:#0b5cff`, `--ink:#0b1b3b`, `--radius:9px`, the same 44px control heights and focus rings as `/app`. It should look like the first room of the house, not the porch of a different one.

Voice: **calm and certain.** Delete every apology. The policy ("nothing here decides whether you get in") is enforced in code and stated **once**, plainly, on S1 — not re-litigated on every screen. Replace "This is not a study contract or a prediction of your result" with "You can change any of this later." Same fact, no flinch.

---

## 4. Build order

| # | Work | Why first |
|---|---|---|
| 1 | Migration: `profiles` columns from §3.2, `onboarding_sessions.current_screen`/`partial`; confirm `availability_rules.slot`/`available` shape | Everything else writes into it |
| 2 | `/api/onboarding` writes structured rows in a transaction, keeps the blob as an audit copy | Closes §1.1 — the actual break |
| 3 | Onboarding v3 UI, six screens, app design system | The founder's brief |
| 4 | Remove the `>= 2027` exam-month restriction | Closes the last silent gate (§1.2 #6) |
| 5 | Re-enable `/api/plan` against real `availability_rules`, producing **one week** | The product does something again |
| 6 | Curriculum graph ingestion — 102 LMs, LOS, prerequisite edges | Unblocks sequencing, tests, pointers (§2.4) |

Steps 1–5 are the onboarding fix. Step 6 is the next lane and it is on the critical path for everything after week 1.

---

## 5. Explicitly out of scope

Teaching or explaining content (D3) · a large practice bank · a six-month block-level plan · any hours prescription · any readiness verdict that blocks · study notes, summaries or video · multi-exam support · native mobile.

---

## 6. Open questions for the founder

1. **Which curriculum year ships?** All docs say 2027 (102 LMs). The material on `~/Desktop/CFA L1/` is 2026 CFAI V1–V10 plus 2026 Schweser. Week-1 content, exam windows, and the `>= 2027` validation all depend on the answer.
2. **May we build the graph from the CFAI PDFs you own?** `PRD-v1.md` §2a.2 permits structure (module list, LOS text, reading/page index) but forbids publisher body text entering a model context as a generation source. Confirm we treat the CFAI outline as structure-only and never feed Schweser prose to the LLM.
3. **Reminders — real or preference-only?** S5 sets a reminder time and channel. Shipping actual email/push needs a provider decision; until then the field stores a preference and we should say so once, not on every screen.
