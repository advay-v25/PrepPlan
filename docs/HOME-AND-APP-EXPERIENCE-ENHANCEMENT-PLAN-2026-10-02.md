# Roadmap — Home and connected app experience improvement plan

**Date:** 2 October 2026  
**Status:** Proposal for review; no application logic or candidate data changed.  
**Recommendation:** Fix inconsistent state first. Then simplify Home around the next action, Today and this week's checkpoint. Keep the product's depth in the pages that own it.

## 1. What this review covers

Reviewed the current authenticated app in the browser: Home, Calendar, Tests, Curriculum overview and Roadmap, Coach, Settings and the exam-edit step. Checked Home on desktop and at 390 × 844, its main navigation action and mobile navigation. Reviewed their source code, onboarding/authentication entry points, shared operating state, planning services, route registry, founder decisions and the current design-overhaul specification.

The route audit found **81 routes and 173 resolvable internal links**. This proves destination existence, not that each destination performs the intended action. Home's sampled warning/error log was empty and no framework error overlay was visible.

**Limits:** This was an existing authenticated account with no accepted study week or scored evidence. I did not create another account, change its plan, submit a test, exercise email delivery/Google OAuth/password recovery, or test every authenticated state. Landing redirected the authenticated browser to Home; its content was reviewed in source, not as a signed-out visual walkthrough. Active-week, revision, mock and final-week behaviour still needs scenario testing.

Some earlier September issues have already changed: onboarding now has five steps; exam saves clear stale dates; Settings edit links have a return destination. Do not rebuild these from an old audit. The current foundation includes real task mutations, source-free onboarding, curriculum tracking, papers, repair threads, weekly review and Coach proposals. The problem is how consistently they connect and how much implementation detail the student sees.

## 2. Directions to preserve

- Roadmap organises, plans, tests and analyses. It does not replace classes or teach the curriculum from scratch.
- Verified identity and completed onboarding precede workspace access. There is no feasibility rejection.
- An unregistered candidate selects February, May, August or November and a year. The exact booked date is added later; an indicative planning boundary is not an invented appointment.
- Self-study: Monday–Saturday study, Sunday paper. Class-led cycles follow the agreed class-boundary rules, with the check before the relevant class.
- New completed learning feeds diagnostics; revision feeds revisionary papers. Uncompleted scheduled scope is not silently tested as completed.
- Confidence, understanding, coverage and execution remain distinct. No unvalidated pass probability or blended readiness ring.
- Calendar protects real-life commitments. Changes and trade-offs are previewed and confirmed.
- No Materials/Sources navigation or mandatory upload. No new Weekly Review tab.
- Preserve the approved warm editorial design direction. This is a hierarchy and behaviour correction, not another unrelated visual redesign.

## 3. Current problems: observed facts and code findings

| Priority | Finding | Impact and proposed correction |
|---|---|---|
| P0 | Home says no roadmap; Curriculum shows a draft; Calendar uses that roadmap and says about three weeks behind. | One draft/accepted lifecycle across pages. Label drafts and do not judge execution against an unaccepted plan. A proposed timeline may describe future pressure, explicitly as a proposal. |
| P0 | Settings says no exam selected; exam edit has February 2027 and a booked date; Home has a countdown. | Resolve all exam displays from the same canonical window/date model. Do not let missing denormalised fields erase saved context. |
| P0 | `OperatingState` fetches only active cycles, then derives `closure_ready` from a non-active status. The bridge enables closure without updating that state. | Derive closure from the actual weekly-review gate, pending logs and paper state. The Home review CTA must be reachable after a paper. |
| P0 | Next-action eligibility excludes class consolidation and can include skipped/deferred tasks. Today counts skipped work in its “done” total. | Share explicit task eligibility and completion semantics. Skipped is not completed; a deferred task is not today's actionable work unless explicitly re-placed. |
| P0 | Today queries are date-based without active-revision filtering; destinations usually point to generic Calendar Agenda. | Test cancelled/superseded/orphan scenarios. Scope today's work to the accepted plan plus valid independent logs; deep-link to the actual task. |
| P1 | Weekly capacity sums availability without subtracting commitments. “Observed” effort uses planned block durations; prior completion rates are always empty. | Calculate usable windows consistently; derive actual pace from deduplicated execution events. Until sufficient observations exist, label estimates provisional. Week two must actually consume week-one evidence. |
| P1 | Home displays four empty progress cards, two setup prompts and evidence-free Coach advice. | A contextual baseline state replaces repetitive empty panels; one setup action. Detailed signals remain accessible. |
| P1 | Home offers “Log a class” to a self-study user. | Use “Log learning”; class capture is contextual, not the universal primary action. |
| P1 | Roadmap declares “Still recoverable” without demonstrated pace. | Show assumptions, confidence and choices; do not promise recoverability. |
| P1 | Tests exposes reviewed-gold/verifier tiers, repeats empty scope and repeats the Home metrics. | One paper state, one scope summary, student language. Reviewer/bank operations belong in an operational surface. |
| P1 | Settings describes three topic self-reports as three modules. | Use the actual entity and evidence source: “3 topics with a starting-point estimate.” |
| P2 | On mobile the giant next-action card and zero cards dominate the first viewport. | Compact action card; show a useful Today preview without scrolling through empty metrics. |
| P2 | Long policy explanations appear repeatedly across Calendar, Tests, Coach and Home. | Explain rules at first use or in help; leave the daily surface for decisions. |

**Bank correction:** The live Tests page showed 19 human-reviewed items and 243 verifier-passed items. These are not 262 interchangeable, fully approved diagnostic items. Eligibility must follow the actual approval policy and scope. Do not repeat the earlier shorthand “262 approved.”

## 4. The proposed Home

### Its job

Within a few seconds, answer: **What should I do now? What else is due today? Is there a decision I need to make?** Home is not the whole syllabus, the whole dashboard or a second Tests page.

### Default layout

```text
Today · Friday, 2 October             February 2027 · booked / tentative

[ ONE NEXT ACTION                                      ]
[ Specific task · estimate · one-line reason            ]
[ Start session / Resume paper / Review proposed week   ]

Today                          View calendar
Up to 3 compact rows; remaining rows behind “View all”

This week: 4 completed · 1 partial · paper on Sunday
[ Only the decision that needs attention, if any ]

See progress     View roadmap     Help me adjust this week
Log learning
```

Illustrative counts above are examples, never placeholder production values. Desktop can place Today alongside the action; mobile stacks it. Keep one dominant CTA, at most one secondary action on that card and short copy. Do not hide critical warnings in a drawer.

### Remove, move, edit and add

| Change | Proposal |
|---|---|
| Remove from default view | Four large empty cards, duplicate setup/roadmap warnings, recurring non-teaching disclaimers and backend terminology. Do not remove their underlying data. |
| Move behind “See progress” | Four transparent signals, sample sizes, recency and confidence details. Loaded on demand with a clear loading/error state. This changes the earlier visible-four-card decision and requires approval. |
| Move to Curriculum | Full roadmap phases, subject-level trajectory and outcome lists. Home retains one relevant milestone or pressure decision only. |
| Edit next action | Replace “Start Action” with the real verb. Include scope, estimated duration and why it is selected; avoid “before you can start studying.” |
| Edit Today | Three rows by default, with title/time/status. Open a task for objective and approach. Show one primary control; put Partial/Reschedule/Skip in an accessible menu. |
| Add quick capture | “Log learning” from Home and Calendar, sharing the same module/LOS mapping and persistence. Select relevant class capture for class-led users. |
| Add conditional weekly strip | Next paper, unresolved log or ready review, not three competing banners. Link to the exact destination. |
| Add one recovery decision | “Two tasks need a new place” → preview choices. Do not add a red backlog wall or automatically inflate tomorrow. |

### Home state coverage

| State | What the student sees and does |
|---|---|
| Setup complete, draft awaiting acceptance | “Your first week is ready to review.” → precise draft review in Calendar. No “behind” status from unaccepted tasks. |
| No draft / failed activation | One explanatory recovery action; retry safely. Preserve onboarding answers; no circular setup links. |
| Baseline week, no evidence | “This week will help us understand your pace.” Today remains useful; signals show their separate unknown states on request. |
| Accepted task available | Next specific task; estimated time, purpose, Start. Actual duration remains optional and labelled, never inferred as actual from the estimate. |
| Paper in progress | Resume the reserved attempt. A genuinely time-critical commitment can still surface separately; no second competing paper-start action. |
| Paper due, scope incomplete | Reconcile the relevant unreported learning first, without inventing completion. A pending log and a missed block are different. |
| Bank cannot cover completed scope | Explain the scope limitation and available supported checks. Unassessed scope stays unassessed; no misleading full-week score. |
| Paper scored | Short result takeaway → full result. If closure conditions are satisfied, “Review this week” opens the quick weekly review. |
| Repair due | Named weak area, reason and re-check connection → accepted repair block. A wrong answer is evidence, not automatically proof of an enduring weakness. |
| Nothing due / rest day | “Nothing scheduled for today.” Show next planned action. Optional work must be opted into, not manufactured as guilt. |
| Revision / mock / final week | Same compact Home; its next action changes with phase. No return to a first-pass dashboard or new wall of metrics. |
| Data failed or stale | Which section could not load, last verified update and Retry. Never fabricate zeros or “no roadmap.” |

## 5. Plain wording contract

| Current wording | Proposed wording |
|---|---|
| Start Action | Review my week / Start session / Resume paper / Review this week |
| We need to build your week plan before you can start studying | Review a proposed week, then adjust it to what fits. |
| Position / Calibration | Syllabus progress / Confidence and accuracy |
| Verification / Repair / Recheck | Check understanding / Focus on a weak area / Check again |
| Move on | Reschedule, if selecting a new place; Defer, if leaving it unplaced. Never imply placement occurred when it did not. |
| No roadmap yet | Your roadmap is a draft, if one exists. Otherwise explain the actual missing context or error. |
| About 3 weeks behind | Your accepted plan needs an adjustment, with a specific gap and options. Only use a quantified gap when the model supports it. |
| Still recoverable without touching the exam date | Here are the available adjustments, with their assumptions and trade-offs. |
| Reviewed gold / verifier-passed | Do not expose tiers on the student dashboard. Show “Not enough eligible questions for this scope” when relevant. |

Keep technical identifiers in code, not labels. Keep curriculum names and LOS references available where they help locate work. No unsupported statements about borderline CFA results, guaranteed readiness or superiority.

## 6. Page-by-page ownership and experience

| Page | Keep and improve | Remove or defer | Connections |
|---|---|---|---|
| Landing `/` | One clear promise: “Know what to study next, around your real week.” Show a labelled example of plan → check → adjustment. CTA Create account; secondary Sign in. | Repeated negative positioning, opaque readiness demos and claims of exact time needs before evidence. | `/signup`, `/login`, `/terms`, `/privacy`; returning users enter the guarded workspace. |
| Auth | Short Sign in/Create account titles; consistent email/Google return behaviour, visible pending confirmation and recovery. | Feature-heavy side copy; “optional context” wording when setup is mandatory. | `/check-email`, `/auth/callback`, `/auth/confirm`, `/auth/error`, `/forgot-password`, `/update-password`. Test real provider/email flows separately. |
| Onboarding | Keep five steps: exam, learning route, starting position, real week, review. Taps/presets, autosave indication, clear Back and conditional inputs. Show why each input matters. | Uploads, essay fields, arbitrary study-hours targets, extra checkpoint step. Do not add questions without a downstream use. | `/onboarding/{exam,route,position,week,plan}`; final confirmation persists setup and proposed first week coherently. |
| Home `/app` | One action, short Today, weekly decision and quick log. | Default analytical wall. | Exact Calendar task/draft, paper attempt/result, review or contextual Coach destination. |
| Calendar `/app/calendar` | Proper week time grid on desktop, day/agenda-first on mobile; classes and commitments visibly distinct. Task drawer: objective, scope, approach, estimate, actual log, completion and reschedule. | Long permanent rules paragraph, 0% rings for empty weeks, pressure against unaccepted drafts. | Task/commitment mutation APIs, class log, Tests, Curriculum reading and Coach preview. |
| Curriculum `/app/curriculum` | Compact subjects with separate studied/tested status. Existing Overview, Readiness and Roadmap views; reading detail for exact coverage/LOS. | Long overview summaries; every milestone expanded by default. Auto-generated teaching content is not the product. | Learning log updates coverage; completed coverage feeds tests; gaps/revision feed Calendar. |
| Tests `/app/tests` | One current paper card: kind, completed scope, count/time, eligibility, Start/Resume. Result: evidence, confidence/time patterns, scoped SWOT and repair proposal. | Repeated empty panels and all optional assessment cards at once; operational review controls. | Attempt/result routes; scope confirmation; valid evidence → repair → accepted Calendar changes → re-check. |
| Coach `/app/coach` | Chat first, with two or three state-valid suggestions. Small “Using your current week” context disclosure; concise options and confirmation previews. | Large evidence preamble, irrelevant suggestions about repeated mistakes before any test, generic repeated policy text. | Same authoritative state as Home; proposal endpoint applies validated calendar changes after confirmation. Never claims a write succeeded before it did. |
| Settings `/app/settings` | Accurate exam/route/week summaries, section Edit, notifications if implemented, account controls. Show impact of changing setup before replacing accepted work. | Raw internal counts and misleading approximate-hour labels. | Existing onboarding edit links with safe `returnTo`; profile and commitment writes trigger the same planning reconciliation. |
| Weekly review `/app/review-week` | Quick reconciliation, paper summary, capacity observations, proposed next-week differences and Confirm. | New permanent tab or retrospective questionnaire. | Home opens after paper and necessary logs; accepted changes refresh Calendar, Home and roadmap. |

**Optional feature decisions:** Notes and flashcards already exist. Do not expand them into a teaching product. Decide whether to retain user-authored memory aids on reading detail or defer their student entry points; this proposal does not silently delete them.

## 7. Routes and the connected loop

All routes below already exist unless explicitly marked **proposed**. Method, validation and response-contract behaviour must be verified before wiring; route existence alone is insufficient.

| User operation | Page / API chain | Required consequence |
|---|---|---|
| Complete setup | Onboarding → `/api/onboarding/state`, `/api/onboarding/[step]`, `/api/onboarding/plan/preview`, `/api/onboarding/plan/confirm` | Persist inputs; one idempotent completion/activation result; accurate Home draft/accepted state. |
| Start, partially finish, complete or move work | Home/Calendar → `/api/tasks/[id]` (and existing `/api/tasks` contract) | Revision-guarded update; refresh Today, execution, curriculum implications and completed test scope. Undo must reverse effects safely. |
| Protect or change life time | Calendar → `/api/commitments`, `/api/commitments/[id]` | Recalculate usable windows; preview conflicts, affected tasks and pressure. Preserve completed evidence. |
| Log external learning | Home/Calendar/Curriculum → `/app/log`, `/api/log-learning` | Confirm scope; deduplicate against planned work; update coverage and eligible test scope. Logging attendance alone must not imply mastery. |
| Log class | `/app/calendar/log-class` → `/api/class-log/context`, `/preview`, `/confirm` | Actual class coverage informs consolidation, cycle/check timing and a reviewable calendar update. Unknown next-class scope remains unknown. |
| Review/start paper | `/app/tests` → `/api/tests/scope`, `/scope/quick-study`, `/scope/confirm`, `/api/tests/start` | Completed-scope snapshot, bank sufficiency, deterministic allocation and reserved attempt. No scope silently omitted to fit the bank. |
| Answer/finish paper | `/app/tests/[attemptId]` → `/api/tests/attempt/[id]/{answer,progress,pause,submit,result}` | Confidence requirement, timing integrity, idempotent scoring and authoritative evidence. Pause policy remains explicit for practice vs mock. |
| Analyse and repair | `/app/tests/[attemptId]/result` → existing repair/proposal services, including `/api/diagnostic/repair` where applicable | Trace evidence to one active repair thread, placement preview, accepted task and re-check. Challenge handling invalidates affected evidence without erasing audit history. |
| Adjust via Coach | `/app/coach?q=…` → `/api/coach`, `/api/coach/history`, `/api/coach/proposals/[id]` | Grounded advice; validated change preview; explicit confirmation; refreshed state across pages. |
| Close the week | `/app/review-week` → `/api/weekly-review/state`, `/api/weekly-review/accept` | Resolve required logs; apply valid paper result; next-week draft consumes actual week observations and preserves unresolved work explicitly. |
| Inspect trajectory/evidence | `/app/curriculum?view=roadmap` / `?view=readiness`; `/api/roadmap`, `/api/signals` | Same accepted roadmap, estimates, evidence validity and confidence everywhere. |

**Proposed deep links:** `/app/calendar?view=agenda&task=<id>` for a task drawer, and `/app/calendar?draft=<id>` for draft review. These query contracts are not established merely because the page route exists. Implement ownership validation, missing-item fallback and back-navigation. Extend the central registry with dynamic attempt/result, class-log, review and reading builders rather than spreading string concatenation across components.

Preserve legacy `/app/week` and `/app/syllabus` redirects for old links. Password recovery and authentication error routes may legitimately lack ordinary navigation links; the route audit's orphan label does not justify deleting them. Audit legacy `/api/diagnostic/*` versus `/api/tests/*` ownership before retiring either; avoid two independent scoring pipelines.

```text
Verified account → mandatory setup → review/accept proposed week
                                 ↓
Home ↔ Calendar ↔ Curriculum coverage / learning capture
                     ↓ completed scope
                 Weekly paper → valid result → repair proposal
                     ↓                         ↓ confirm
                 Quick review ← logs       Calendar repair → re-check
                     ↓
              next-week draft → student acceptance → Home

Coach reads this same loop; it proposes changes, not alternate truth.
```

## 8. Improvements from first week to exam week

- **Baseline:** Treat onboarding coverage as self-reported. Observe actual durations, completion, interruptions and test confidence without prematurely declaring a stable pace.
- **Ongoing learning:** Respect classes, travel, work and unexpectedly faster progress. A moved block changes placement, not demonstrated understanding. Completed extra learning updates the roadmap without duplicate calendar work.
- **First pass complete:** Switch to evidence-led revision: stale or weak scope, spaced retrieval, mixed revisionary papers and re-checks. Re-reading does not reset mastery automatically; no automatic “start syllabus again.”
- **Final preparation:** Show mock appointments, review of errors and targeted repairs. Protect the agreed final-preparation period; late starters receive explicit compressed-plan choices, not an impossible silent promise of eight weeks.
- **Last week:** Fewer decisions, limited new scope, realistic mock review and recovery/rest commitments. No escalating backlog dumped into the last days. Exam logistics can be optional reminders, not assumed requirements.
- **Exam change/deferral:** Preview the revised horizon, retain valid evidence with age labels and retire superseded future work. Do not reset the student's history.
- **After the exam:** Stop study nudges when confirmed; archive the plan, let the user retain/export their history and choose the next goal. Do not imply Level II is supported before it is.

## 9. Research and practical differentiation

Use progressive disclosure: keep frequent actions visible and defer infrequent detail behind clearly labelled controls. This supports the Home split, not hiding basic task completion. [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

Personalised planners, recommendations and progress tracking are already in CFA Institute's ecosystem. Its official page also describes practice questions, flashcards and mocks; these are not unique Roadmap inventions. [CFA Institute: Learning Ecosystem](https://www.cfainstitute.org/programs/cfa-program/learning-ecosystem).

UWorld describes day/week/month calendars, missed-session redistribution, LOS sequencing and performance analytics. “AI calendar” or “adaptive schedule” alone is therefore weak differentiation. Roadmap should complement the student's chosen teaching provider rather than compete on lectures. These are provider descriptions, not independently tested performance claims. [UWorld: CFA Study Planner](https://finance.uworld.com/cfa/study-planner/).

### Distinctive ideas worth testing—not claims nobody else offers them

| Idea | Useful student experience | Practical boundary / priority |
|---|---|---|
| Explain every adjustment | “This task moved because your class changed; your Sunday paper scope changed too.” Open a compact before/after summary. | Deterministic change log from accepted revisions, not an invented LLM narrative. Build after state consistency. |
| “I have 20 minutes” | Find an appropriate chunk of accepted work, with a clear stopping point. | Reuse task scope; do not mark a whole reading complete or silently replace the week. Pilot after task semantics are reliable. |
| Non-panic recovery | Compare Keep essentials / Reduce new scope / Redistribute, showing what each protects and defers. | Preview and confirmation; no hidden increase in hours or protected-time encroachment. High priority. |
| Evidence-to-action trace | From a weak area see the valid missed evidence, repair task and next check. | No diagnosis from one ambiguous item; challenged items update the trace. High priority. |
| Calibration guidance | Distinguish correct-but-unsure, confidently incorrect and slow-but-correct patterns. | Adequate sample sizes and scope labels; timing is a planning signal, not intelligence grading. |
| Provider-independent class loop | Class attendance and covered scope produce a usable consolidation week, no uploads required. | Structured module matching and user confirmation when uncertain. No restricted portal scraping. |
| External mock summary | Record topic scores and timing from an external mock to inform revision. | Label self-reported external evidence; do not treat it as equivalent item-level validated evidence. Later, not Home V1. |

Do not add a social feed, punitive streaks, another chat widget, a huge leaderboard or an opaque readiness number to create apparent novelty. Validate these ideas with both working candidates and full-time students, class-led and self-study, early and late starters.

## 10. Phases and acceptance checks

| Phase | Deliverable | Exit criteria |
|---|---|---|
| A — One truthful state | Canonical exam, draft/accepted roadmap, today eligibility, closure, repair states, actual-capacity inputs and explicit loading/stale status. | Same saved exam and lifecycle on all pages; skipped never counts done; closure is reachable; no render-triggered writes; baseline is not judged against an unaccepted plan. |
| B — Home simplification | Compact next action, three Today rows, conditional weekly strip, quick learning capture and progressive signal detail using approved tokens. | At 390px the action and useful Today context are visible early; labels describe exact actions; no empty metric wall, duplicated CTA or self-study class-only prompt. |
| C — Page ownership and wording | Calendar controls/deep links, compact Tests, Curriculum drill-down, chat-first Coach and accurate Settings. | Every action lands on the relevant object; return navigation works; identical status definitions; staff tooling is separated from ordinary student navigation. |
| D — Full loop | Class/log → completed scope → paper → valid result → repair → acceptance → re-check → review → next week. Revision/mock transitions included. | Browser scenarios and service tests prove cross-page effects, retries, undo, scope changes, insufficient bank, invalidated items and simultaneous edits. |
| E — Differentiation pilot | Recovery comparison, change explanation and limited-time work selector. | Usability observations show faster decisions and understandable adjustments; no duplicated work or speculative progress claims. |

Test fresh and returning accounts; incomplete and complete setup; tentative and booked exams; self-study/fixed/variable/mixed classes; no free time; draft/active/failed/stale states; partial/missed/extra learning; Sunday papers; class-boundary papers; exhausted banks; interrupted attempts; challenge invalidation; revision; final week; changed exam and after-exam state.

Accessibility: native radio semantics for exclusive choices, keyboard-operable grid alternatives, visible focus, labelled statuses, non-colour-only distinctions, reduced motion and concise live save/error announcements. Desktop and mobile should support the same actions without hover dependence.

Measure **time to identify the next action, successful action completion, capture friction, cross-page disagreement, rescheduling comprehension and weekly-loop completion**. Do not optimise merely for dashboard clicks or time spent in the app. Establish baselines before claiming improvements.

## 11. Decisions needed before implementation

1. **Home signals:** approve moving the four signals into “See progress,” with a compact summary only when meaningful? Recommended; this deliberately revises the earlier four-visible-cards direction.
2. **Capture:** approve “Log learning” as the universal quick action, with class capture contextual to route? Recommended.
3. **Learning aids:** keep user-authored notes/flashcards inside readings, or defer them to concentrate on planning and assessment? Do not expand teaching functionality.
4. **Reviewer tooling:** approve moving item-review access to a separate operational surface, retaining role checks? Recommended; ordinary students should not see bank production details.

Start with Phase A, then B. Do not begin another visual rewrite while the page status models disagree. This plan proposes changes for review; it does not change the founder decisions automatically.
