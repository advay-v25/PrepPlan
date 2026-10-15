# Curriculum page and LOS readiness tracker — end-to-end plan

**Authority:** `docs/FOUNDER-PRODUCT-DECISIONS.md` (§5 evidence, §6 pressure, §8 recording learning) → this plan.
**Origin:** the founder's own "CFA L1 2026 LOS Readiness Tracker" PDF — one row per learning outcome, banded Maintain / Verify / Repair, with rationale, the specific concept to address, how to improve, proof of mastery, and progress. This plan turns that document into a live feature driven by the student's own evidence.

## 1. The student's view

Curriculum answers three questions, in this order:

1. **What have I actually demonstrated?** — Readiness view (default): every learning outcome as Repair, Verify, Maintain or Untested, each with a plain reason.
2. **What do I do next?** — "Work in this order": Repair rows first (close them before broad rereading), then Verify, each with the question count and the proof that clears it.
3. **Where am I against the plan?** — Roadmap view: phases, milestones, calm plan-pressure (no hours target), planned vs actual.

Rules the feature never breaks:
- A row moves only on **diagnostic or revision evidence**. Completing a task, self-reported coverage or confidence never moves a band on its own.
- **Guessed-correct is not mastery.** A right answer given with low confidence (or a wrong one given with high confidence) is a confidence mismatch and holds the row at Verify.
- **No evidence = Untested**, never Maintain.
- Practice-mode attempts are excluded from bands.
- No percentage, pass probability or hours instruction appears anywhere on the page.

## 2. Band rules (implemented in `src/lib/curriculum/losTracker.ts`)

| Band | When |
|---|---|
| Repair | evidence state `needs_repair`, or an open repair thread; named "recurring" when the thread has more than one occurrence |
| Verify | `unstable`; confidence mismatch; disputed answer; only one valid observation; or supported evidence older than 21 days |
| Maintain | supported, ≥2 valid observations, no mismatch, evidence within 21 days |
| Untested | no valid evidence |

Method per band (the student's own): Repair = relearn + error note + 12–15 fresh questions + differently-worded next-day retest (≥90%, no guessed-correct); Verify = closed-book recall + 6–8 fresh questions (≥85%, correct reasoning); Maintain = 3–5 mixed questions + 60-second summary (≥90% with immediate recall, else drops to Verify).

Progress tracks the *improvement*, never understanding: Not started → Scheduled → Worked — awaiting retest → Retest due; only new evidence returns a row to Maintain ("Holding").

## 3. Phases

### Phase 1 — Read model and page (DONE in this change)
- `losTracker.ts` pure classification, method text, progress, ordering — 30 unit tests (`npm run los:test`, in `verify`).
- `losTrackerService.ts`: live composition from `curriculum_concepts` (active manifest) × `evidence_events` (evidence mode) × `repair_threads` × `plan_blocks` × `user_module_state`, grouped topic → module → outcome. Read-only, user-scoped.
- `GET /api/curriculum/readiness`; `ReadinessTracker` server component; Curriculum page with Readiness (default) and Roadmap views; band filter (`?band=repair`).
- Live test `npm run e2e:readiness` (20 checks): a real diagnostic answered wrong moves outcomes to Repair with no refresh step.
- Plan-pressure copy rewritten to calm states without hours (Decisions §6); `e2e:roadmap` brought back to green.

### Phase 2 — Make each row actionable
- "Check this in Tests" deep-links with the outcome's concept scope (the `concept_check` purpose already exists) instead of the generic Tests page.
- "Plan this" turns a Repair/Verify row into a **proposal** (never a silent write) using the existing repair-proposal flow; acceptance places it on the Calendar; the linked task drives `Scheduled` / `Worked`.
- Next-day retest scheduling from `repair_threads.next_recheck_due_at`, surfaced on Home as a next action.

### Phase 3 — Depth of the outcome map (content pipeline, not code)
- Today only a handful of concepts are mapped (the page states this honestly: "tracking N outcomes across X of 63 modules"). The full ~300-outcome map must come from the company's curriculum pipeline.
- **Licensing decision for the founder:** the attached PDF reproduces CFA Institute learning-outcome statements and Schweser wording. Decisions §11/§14 require original, rights-cleared text. The product should hold its own paraphrased outcome descriptions (as the existing `curriculum_concepts.name` values are), keyed to the same reading/LOS codes so the tracker matches the founder's mental model without shipping licensed text.
- Importer contract: `{ moduleId, losCode, name, importance, scopeNote }` rows into `curriculum_concepts`, plus item-bank coverage per outcome (a row with no bank items stays Untested and says so).

### Phase 4 — Record learning inside Curriculum (Decisions §8)
- Module drawer: self-reported coverage (exposure, never evidence), class log ("what was covered", mapping certainty), recorded as activity.
- Uncertain mappings stay unconfirmed until resolved; nothing is guessed silently.

### Phase 5 — Cross-page truth
- Home's four signals read this tracker (curriculum position and demonstrated understanding), so Home, Curriculum and Coach can never disagree.
- Coach reads the same rows to point at the right module/outcome — it never teaches the outcome itself.

### Phase 6 — Revision and papers
- Revisionary and mixed papers (already classified and bank-gated) write evidence per outcome; a row that returns to correct-and-confident across two papers earns Maintain.
- Decay: Maintain older than 21 days falls to Verify automatically (implemented); a scheduled "maintenance mix" of 3–5 questions is planned as low-priority Calendar work.

### Phase 7 — Export
- A print/PDF view of the tracker in the founder's original layout (module, outcome, band, rationale, concept, how to improve, proof, progress) for offline study.

## 4. Known limits (stated, not hidden)
- Evidence is per **concept**; the PDF is per **outcome**. Until Phase 3 maps one concept per outcome, a concept may cover part of an outcome.
- The bank is small (19 reviewed items in three FSA modules), so most rows are honestly Untested today.
- Diagnostic-to-band is immediate; there is no background job — the page recomputes on every visit.
