# Roadmap — Working prototype build phases and master prompts

**Date:** 4 September 2026.  
**Revision:** study approach, life balance and evidence-based confidence integrated into the product flow, phase prompts and acceptance criteria.  
**Status:** proposed execution plan; this turn creates the design package, not application changes.  
**Scope:** CFA Level I initially; a weekly study planner with diagnostics, accountability, progress evidence and an action-capable Coach.  
**Companion:** [verified onboarding and weekly-loop design](<./ONBOARDING-FINAL-DESIGN-AND-VERIFICATION.md>).

## 1. The product we are building

Roadmap helps a student answer: **What should I work on next, how should I study it, where should I learn it, how can it fit into my life, and what evidence can give me confidence in my understanding?**

The three connected responsibilities are **study with a method → organise around real life → build confidence through evidence**. They belong throughout the existing pages, not in three additional tabs. These are product objectives, not a guarantee of confidence, wellbeing or exam success.

It must work whether the student studies from books, large PDFs, Google Drive, a coaching portal, live classes or a combination. Uploading material is an optional enhancement—not admission to the product and not its only source of intelligence.

The prototype is complete only when a real account can enter context, accept relevant work with an understandable study approach, protect non-study commitments, record actual learning, take an eligible diagnostic, review specific gaps and accept a revised or second week. A collection of interactive pages is not that prototype.

### Navigation

- **Home:** next useful action and a manageable way to begin, quick capture, relevant attention items and weekly checkpoint.
- **My Week:** calendar and task list, both showing the same accepted work; protected life commitments, explicit trade-offs, draft review and safe adjustments.
- **Curriculum:** topic/module/LOS structure, prerequisite links, reported exposure and diagnostic evidence that makes specific progress visible.
- **Practice:** diagnostics, saved attempts, reasoning feedback, confidence calibration, focused re-checks and later broader reviews.
- **Coach:** a first-class destination with conversation/action history, also available as a contextual side panel throughout the app.
- **Settings:** secondary navigation for context, account, notifications and a Study Sources manager.

There is **no Materials primary tab**. Source controls appear inside onboarding, module detail, task detail and learning capture. Settings provides one place to find, edit, remove or reconnect sources. Removing a tab does not mean scattering records with no central management.

## 2. Resolve the materials problem correctly

### Three independent layers

**A. Curriculum and assessment foundation — what Roadmap knows**

A versioned, verified CFA topic/module/LOS structure, reviewed relationships, authorised reference support, and original validated assessment items/rubrics. This is shared product infrastructure, independent of whether a student uploads anything.

A list of LOS titles is not sufficient grounding for accurate questions. We need rights-cleared reference support and/or original expert-reviewed specifications and items for the supported scope. The existence of the uploaded Schweser books is not proof of permitted production ingestion or redistribution. Verify content provenance before using it operationally; do not invent identifiers or claim provider endorsement.

**B. Personal learning context — what the student is using**

Provider/course names, portal or Drive links, book edition, lesson title, user-entered page/section references, class coverage and confirmed curriculum mappings. These can be useful without reading the underlying document.

**C. Optional source content — what Roadmap can actually read**

User-authorised uploaded/extracted text and permitted connected content. Only this layer supports a claim that an output was grounded in that personal file. It remains account-scoped and does not automatically become shared-bank content.

### Source-access decision table

| Student's source | Supported experience | What Roadmap must not imply |
| --- | --- | --- |
| Printed book | Save provider/edition and student-entered chapter/page pointer; confirm relevant module/LOS | That the app has read that edition or verified the exact page |
| Downloadable PDF/text | Optional private upload, extraction and mapping; source-pointer mode remains available | That upload success means extraction, mapping and retrieval all succeeded |
| Large PDF | Resumable direct-to-storage upload and bounded background processing; prioritise the needed sections | Unlimited size, immediate ingestion or all pages already analysed |
| Google Drive file | Save a link immediately; optionally authorise access to a selected file and import only if allowed | That Google sign-in grants Drive permission or a link exposes its content |
| Download-restricted Drive file | Keep an external pointer and ask for topic/lesson metadata or permitted personal notes | That an OAuth connection overrides download restrictions |
| Non-downloadable coaching portal | Open the portal externally; save a lesson title/location and user-confirmed LOS mapping | That Roadmap can log in, scrape it, monitor attendance or read hidden lessons |
| Live class without material | Quick log of what was covered; confirm curriculum mapping; propose consolidation/checks | That class attendance proves understanding |
| No source selected | Recommend a curriculum-grounded starting scope and ask where the student will study it | A fabricated book page, portal lesson or free substitute course |

### The 15 MB issue

The current limit is explicitly coded in `src/app/api/materials/analyze/route.ts`; extraction/classification occurs in the request and PDFs are limited to the first 25 pages. Changing that number alone does not solve large-file processing.

Proposed upload architecture: authenticate and create a private upload intent → upload directly to storage with resumable progress → verify object ownership, size and actual file type → enqueue extraction → process bounded segments → suggest mapping → confirm mapping → mark eligible sections available for retrieval. Large objects must not travel through a single long-running Next.js analysis request.

Supabase supports TUS resumable uploads, including interruption recovery and progress tracking, and recommends this route for larger files. Actual project/bucket limits still apply. [Supabase resumable upload documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

Set a tested product cap, page/processing quota and retention policy during implementation—not “unlimited.” Test a file larger than 15 MB, an interrupted upload, unreadable/encrypted/scanned content, retry, cancellation and deletion. If a file exceeds the supported cap, offer source-pointer mode or a permitted smaller section; do not make the student split a book just to receive a plan.

### Drive and portal boundaries

Google documents that download/export availability depends on file permissions, including `capabilities.canDownload`. File selection and least-privilege access should be explicit; a private link alone is insufficient. Prefer narrowly scoped selected-file access where it meets the implementation needs. [Drive download/export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [Drive OAuth scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Do not build generic authenticated portal scraping or ask students for portal passwords. Do not use screenshots, browser extensions or automated extraction to bypass restrictions. A provider integration requires an authorised integration route and a separate scope decision. For the first version, external pointers and student-confirmed lesson/LOS associations are the stable solution.

### Viability without reading a student's source

Example: a student uses a locked coaching portal. They select the lesson they covered and confirm the suggested LOS. Roadmap proposes consolidation, points them back to that lesson and offers an original diagnostic grounded in Roadmap's own supported reference/assessment foundation. Results identify the relevant gap and recommend returning to the confirmed lesson.

The app is **curriculum-grounded and personally mapped**, but not grounded in the inaccessible portal's exact text. Say this plainly. If the portal teaches a different scope or edition, ask the student to correct the mapping. If Roadmap lacks reliable assessment support for that LOS, mark the diagnostic unavailable rather than hallucinating it.

This solves the dependency on collecting every student's content. It does not eliminate the need for an accurate, authorised curriculum/assessment foundation. That dependency is Phase 0.

## 3. The user experience we want

### First arrival

The student answers only questions that change their next week. They can select a source link without uploading anything. Roadmap proposes a small coherent priority with source/LOS mapping status, study approach and suggested timing. Optional questions about comfortable sittings, test comfort and this week's constraints must change those suggestions, not simply fill a profile. The student accepts, lightens, splits or floats tasks. Home immediately reflects their accepted decision.

### Daily use

Home leads with the next accepted action. “Log learning” is always available for a class or study that happened outside the plan. A task explains its scope, rationale, source pointer, suggested study approach and completion meaning. Work can be partial; actual time is optional. Completion does not falsely increase understanding. The student need not complete a timer, written reflection or every suggested substep merely to log useful work.

### How to study: a method attached to the task

Each learning task should answer: **What am I trying to understand? What should I do with my source? What should I pay attention to? How will I check whether it helped?** A calendar label such as “Study inventories, 45 minutes” is insufficient.

Suggested approaches depend on the learning situation:

| Situation | Suggested approach | Useful evidence or next step |
| --- | --- | --- |
| First exposure | Understand the section's purpose, study a bounded part, then attempt a short recall/application check | A scoped first attempt, not a whole-topic mastery verdict |
| After class | Reconstruct the main relationships before reopening notes; compare against the source | Check what was actually covered and revisit omissions |
| Repeated misconception | Identify the failed reasoning step and revisit the specific source/LOS distinction | An unseen question that tests that distinction |
| Correct but uncertain | Explain why the chosen approach applies; attempt a different example | Check whether correct performance holds beyond one item |
| Revisiting older material | Try retrieval/application before deciding how much to reread | Target revision using current evidence rather than rereading everything |

These are editable guidance patterns, not guaranteed learning prescriptions or a mandatory ritual. Their selection should use the task's purpose and relevant evidence. Do not label a person with a fixed “learning style” or prescribe the same method everywhere.

**Illustrative task experience:**

> **Goal:** distinguish the financial-statement effects associated with the inventory-accounting choices in this section.  
> **Where:** your confirmed source reference and verified associated LOS.  
> **Approach:** study the bounded section, close the source and describe the relationship in your own words; then try an unfamiliar application question.  
> **Focus:** revisit the specific distinction identified in your previous attempt, if such evidence exists.  
> **Next:** use the diagnostic to decide whether a focused review or the next section is useful.

Do not invent a prior mistake, exact source location or LOS identifier to populate this template. The app guides the process; the student's source supplies the lesson. Feedback may explain a specific error without becoming a replacement chapter.

### Life balance: protected commitments and visible choices

Planning starts with what the student wants to protect and achieve, not all the hours a calendar appears empty. Work, sleep, family, exercise, rest and other personal goals can be protected like any other commitment. A generic label such as “personal time” is sufficient; private details are unnecessary. Missing commitments do not imply unrestricted availability.

Offer a contextual choice such as “Maintain continuity this week” when life is busy. Recommend a meaningful smaller scope, identify what is deferred and let the student decide. Do not automatically recover the deferred work by doubling the following week's load. A day without study is not itself an alert.

Show trade-offs concretely: “Keeping these two commitments means this task remains floating or moves to next week.” The student can accept, change the scope or choose another time. Do not silently displace protected commitments, declare their priorities wrong or add a life-balance score. Roadmap supports organisation; it does not prescribe sleep, exercise or mental-health treatment.

### Practice and follow-through

A diagnostic follows relevant covered material or a deliberately chosen scope. The result explains the specific miss, gives the relevant LOS and points to a verified or clearly user-provided learning source. The student can add a review/re-check proposal to their week. They are not asked to read a generated textbook chapter.

### Confidence: three distinct signals

1. **Self-reported confidence:** how sure the student feels about a particular answer or concept. Optional, contextual and never proof of mastery.
2. **Demonstrated understanding:** performance and reasoning on eligible assessments, including relevant later or unseen checks. Report scope, recency and limitations.
3. **Trust in the study process:** being able to start, make realistic commitments, recognise progress and return after disruption. Support this through the experience, not an invented psychological score.

Show specific evidence: “You corrected the reasoning step that caused the earlier miss and answered a new variation correctly.” If only one attempt exists, say so. A correct low-confidence answer suggests a useful follow-up, not an automatic misunderstanding. A high-confidence error warrants targeted feedback, not shaming. Uncertainty in explanation grading must remain visible.

Avoid generic praise, readiness percentages without justification and promises that a technique will eliminate fear. Make change visible through concept-level history: first attempt → identified gap → source-directed review → later check. Optional check-ins may ask whether the approach felt useful or manageable; that feedback informs support, not learning scores. Do not infer anxiety or confidence from time spent, missed tasks or chat engagement.

### Changed week

“I have work travel Thursday and Friday” produces a preview of affected sessions and alternatives. Completed work and protected commitments are preserved. The student confirms the adjustment. Availability preferences do not silently become booked hours. A restart action helps choose the next manageable priority without requiring the student to clear an entire backlog first.

### Weekly return

A diagnostic-led checkpoint reviews actual coverage, understanding and changed constraints. It can also ask whether the study approach worked and whether the accepted scope fitted life, without making a long reflection form mandatory. Missing evidence stays unknown. The next draft adapts priorities, suggested methods and scoped tasks; it does not automatically penalise misses or increase workload after success.

## 4. Coach: a product operator, not a generic tutor

The Coach is the same system whether opened from its page, a calendar task or a result. It shares canonical application data and action services with the UI; it must not maintain a separate fictional schedule in chat.

### What the Coach can do

| Intent | Response/action | Control boundary |
| --- | --- | --- |
| “What should I do now?” | Explain the best next accepted action and why it matters | Read current plan and evidence; do not silently add work |
| “How should I study this?” | Suggest a task-specific method, source/LOS focus and a way to check understanding | Guide the learning process; no whole-topic lesson or one-size-fits-all method |
| “How do I balance this with everything else?” | Identify protected commitments and current priorities; show scope/placement trade-offs | Ask only for relevant context; no prescribed lifestyle or use of every free hour |
| “I don't feel confident about this” | Distinguish perceived uncertainty from available evidence; offer a scoped, lower-pressure check or source-directed review | No diagnosis, empty reassurance, pass prediction or inference that uncertainty means inability |
| “Plot my week” | Draft relevant tasks and feasible placements using confirmed constraints | Preview first; user accepts publication |
| “Move this to Saturday” | Identify the task and a feasible placement; ask if timing is ambiguous | Show the concrete change and confirm before applying |
| “My week is too much” | Distinguish less scope, shorter sittings and moved work; propose changes | Do not apply a hidden capacity multiplier |
| “Test me on this module” | Validate supported scope and start a diagnostic through the assessment service | Starting a requested test needs no redundant permission; display timed conditions before the timer starts |
| “How am I doing?” | Summarise reported activity, coverage, diagnostic evidence, uncertainty and recency | No invented score or pass probability |
| “Where am I weak?” | Identify supported patterns by concept/LOS and cite relevant attempts | Distinguish observation from inference and insufficient evidence |
| “Where should I study this?” | Point to confirmed source locations, or the LOS description when exact locations are unknown | Never invent a page or claim to have read a restricted portal |
| “What should I improve?” | Identify a useful opportunity: prerequisite repair, repeated error pattern, forgotten material or a schedule conflict | Offer actionable next steps, not an authoritative personality assessment |
| “Teach me all of FSA” | Briefly explain the scope boundary, offer an FSA study roadmap/source mapping and diagnostic-led priorities | No whole-topic replacement lessons |
| “I studied elsewhere” | Parse a proposed learning event and confirm its mapping | Do not claim knowledge of unobserved study |

Treat “threats” as concrete study risks—conflicting commitments, unverified sections, repeated high-confidence errors or stale evidence—not predictions of failure. Say what was observed and what action could help.

### Personalisation

Use current preparation mode, confirmed class coverage, current module, accepted priorities, optional sitting preference, actual study outcomes, diagnostic patterns, chosen practice format and temporary constraints. Adapt language and detail using explicit preferences, not inferred ability or stereotypes.

Do not infer anxiety from a wrong answer. If a student explicitly expresses test avoidance, offer smaller or untimed checks. Do not treat willingness to chat as evidence of learning. Long-term memory must be inspectable and editable; a temporary travel week must not permanently redefine capacity.

Personalise the recommended study method using first exposure, class consolidation, repeat errors, uncertain correct answers or older material. Use optional feedback about helpfulness to refine suggestions; declining a method is not noncompliance. Pair encouragement with actual evidence or a concrete next step. Protect non-study commitments unless the student explicitly changes them.

### Request pipeline

Intent → authenticated account/page context → required facts and capability checks → clarification if necessary → bounded service call or draft proposal → deterministic validation → confirmation where needed → atomic execution → receipt and UI refresh.

For a compound request, show the separate consequences. “Test me and rearrange my week” can start a diagnostic, but the calendar changes remain an independently reviewable proposal. A failed tool call must not be narrated as success.

### Coach service contracts

Read services: current cycle/tasks, confirmed constraints, coverage and attempt summaries, supported assessment scope, verified source/LOS pointers. Read only the current user's private data and authorised shared curriculum records.

Draft services: propose week, propose schedule changes, propose targeted review, propose source mapping or learning log. Return structured proposals with IDs, reasons, assumptions, changed fields and an expected revision.

Execution services: accept a draft, apply confirmed changes, record a confirmed learning event, create/start an assessment. These enforce ownership, valid state transitions, idempotency and concurrency rules independently of the model. Never permit arbitrary SQL or unrestricted remote fetching as a Coach tool.

Model prompts must not contain exam answer keys during an active attempt. Requests for results explanations must respect attempt state. Imported text and chat quotations are untrusted data, never system/tool instructions.

### Runtime Coach prompt skeleton

1. **Role and boundary:** weekly planning, task-specific study methods, life-aware trade-offs, diagnostic-guided feedback and source direction; no full-course tutoring, lifestyle prescriptions or outcome promises.
2. **Evidence hierarchy:** verified application records, validated assessment evidence, confirmed source mappings, self-report, then explicitly labelled inference.
3. **Fresh context:** account scope, page/task, cycle/revision, relevant LOS and source capabilities; retrieve rather than stuffing the entire history or book into every prompt.
4. **Intent and allowed tools:** only named services with typed inputs and current permissions.
5. **Confirmation policy:** read/explicitly requested practice may proceed; calendar publication and consequential changes require an actionable preview.
6. **Response contract:** concise answer; why; supporting record/LOS references; assumptions; suggested study approach or life trade-off where relevant; proposed action; execution status. Distinguish self-reported confidence from demonstrated understanding.
7. **Fallback:** acknowledge unavailable data/tools, preserve state and offer a working non-chat path.

The Coach cannot make the prototype viable by improvising around broken backend services. Build those services once and expose them to both UI and Coach.

## 5. Build phases at a glance

| Phase | Deliverable | User experience | Exit condition |
| --- | --- | --- | --- |
| 0 | Verified curriculum/source foundation and domain contracts | A source/LOS link means something real; unsupported scope is explicit | Reviewed seed slice, provenance, state ownership, safe migration plan |
| 1 | Connected shell, onboarding, source pointers and learning capture | “I can start without uploading or giving portal credentials” | Context/pointers persist across reload and accounts remain isolated |
| 2 | Real Home and weekly planner | “I know how to approach my tasks and fit them around my life” | Durable draft, task methods, protected commitments, calendar/list and real outcomes |
| 3 | Practice and Curriculum evidence | “I can see what supports my confidence and what needs another check” | Real attempt → scored evidence → LOS/source-linked follow-up and concept history |
| 4 | Weekly loop and action-capable Coach | “It helps me study, balance competing priorities and restart when needed” | Two-cycle and midweek journeys preserve history and adapt scope/methods without punishment |
| 5 | Optional large-file and selected-Drive ingestion | “Reading my permitted files improves detail, but is never required” | Resumable private uploads, durable processing, truthful access states |
| 6 | Full-scope hardening and release qualification | “This is reliable with real users and failures” | Coverage, quality, security, accessibility, operations and cost tests pass |

**First working prototype milestone: end of Phase 4**, for an explicitly disclosed, validated curriculum slice. A small internal pilot is acceptable; describing five topics as complete CFA L1 support is not. Phase 6 qualifies the full intended scope. Phase 5 is an enhancement, not a dependency for the no-upload core product.

The exact calendar is deliberately not guessed. Size each phase after Phase 0 inventories working services, deployed schema and source readiness. January remains a planning target, not a reason to ship ungrounded diagnostic claims.

## 6. Shared build instruction — prepend to every phase prompt

> Work in the Roadmap repository. Read AGENTS.md, applicable skills and relevant local Next.js documentation before coding. Read PRODUCT-BUILD-PHASES-AND-META-PROMPTS.md and the verified onboarding design. Current user instructions override older documents. Audit the current implementation and deployed contract where accessible; do not assume earlier summaries are current. Preserve unrelated user changes and do not reuse PlannrAI code or scripts.
>
> Implement only the named phase and its necessary dependencies. Do not repeat the entire rebuild. Separate account security/subscription controls from academic gating. No prescribed weekly-hours target, hidden fill ratio, assumed exam date or fabricated progress. Availability preferences are not durations. Students can use floating tasks and source pointers without uploading material.
>
> Integrate three product responsibilities: study with a method, organise around real life and build confidence through evidence. Learning tasks need a useful suggested approach, not only a title and duration. Protect confirmed non-study commitments and show trade-offs. Separate self-reported confidence, demonstrated understanding and supportive restart experiences; do not collapse them into one score. Methods and reflections are supportive options, not additional completion gates. No new tabs are required for these responsibilities.
>
> Use one account-scoped source of truth per domain. UI and Coach use the same validated services. Schema migrations must preserve data, define real RLS policies, be tested against legacy fixtures and be applied only with the required authority. Never run destructive SQL copied from old documents. Keep third-party keys server-side and do not expose private content in logs.
>
> Implement loading, empty, error, retry and unsupported-capability states. Use labelled deterministic fixtures in automated tests, not fake success in product UI. Validate the requested behaviour with unit/integration tests and rendered desktop/mobile checks. Report what was built, what was actually tested, remaining limits and the next phase's dependency contract. Do not claim production readiness from typecheck alone.

## 7. Phase-specific meta prompts

### Phase 0 — Verified foundation and contracts

> Establish the foundation for a source-independent CFA Level I planner. Inventory the complete repository SQL, actual applied schema if accessible, existing curriculum modules/LOS identifiers, source provenance, assessment support and duplicate state stores. Report repository declarations separately from deployed facts. Resolve contradictions using the verified product design.
>
> Define one canonical curriculum version and an honest capability registry for the initial supported slice. Use verified identifiers and reviewed relationships; do not invent a full curriculum or treat a LOS list as question-generation grounding. Prepare original reviewed task/assessment specifications backed by authorised source support. If that support is unavailable, name it as an assessment dependency; do not silently fill it with model recall.
>
> Specify context, sources/mappings, planning cycles, drafts, tasks, placements, activity events, attempts and Coach action proposals. Separate priority, placement and execution state. Prepare additive migration and compatibility tests, including v4 context; do not apply remote mutations without the appropriate authority.
>
> Add reviewed study-method patterns tied to task purpose and relevant LOS, not fixed student learning-style labels. Define task fields for learning objective, suggested approach, focus distinction and verification intent; optional method feedback; protected-commitment semantics; and confidence observations linked to specific attempts/concepts. Keep these separate from objective assessment evidence and avoid inferred mental-health data.
>
> Deliver a capability matrix, ownership/state contract, seed fixtures, migration plan and testable service interfaces. Exit only when a supported module can be traced from curriculum ID to a meaningful task and eligible diagnostic specification. Preserve the ability to plan with pointers alone.

**UX target:** the student sees specific, trustworthy next-step language—not impressive but unverifiable references.

### Phase 1 — Shell, connected context and source pointers

> Implement Home, My Week, Curriculum, Practice and Coach navigation, with Settings secondary. Remove Materials from primary navigation while preserving old links through a useful redirect or source-manager entry. Do not discard existing user source records.
>
> Connect adaptive onboarding to canonical context and source-pointer records. A student can select a book, paste a Drive/portal link, add a lesson/section reference or continue without a source. Source records distinguish student-provided pointers, suggested mapping and verified mapping. Do not fetch private links or imply their content was read. Detect provisional timezone without a standalone onboarding question; show local-time interpretation when scheduling matters.
>
> Build a persistent Log learning action for classes, planned or unplanned study, and external practice results. Confirm module/LOS mapping where uncertain. Reading/class exposure must not become mastery. Give every page an honest empty state and a return path to incomplete setup.
>
> Collect optional sitting/practice preferences and week-specific constraints only when they change the next task or draft. Allow private commitments to use generic labels. Preserve unknown confidence as unknown; no personality quiz, mandatory lifestyle questionnaire or added balance/confidence tab.
>
> Verify source-pointer mode for a printed book, private Drive link and locked portal; test undecided exam, skipped setup, edit/resume, save failure and two-account isolation. Do not show a fabricated week until Phase 2 produces one.

**UX target:** “Roadmap understands what I am working on even when it cannot access my course.”

### Phase 2 — A real week and action-first Home

> Build the deterministic weekly composer, persisted draft review and accepted-plan lifecycle. Inputs include confirmed context, supported curriculum/task patterns, current priority, sources, constraints and existing protected work. Propose a coherent task scope; do not fill a fixed percentage of availability or manufacture weekend slots.
>
> Support timed, day-preferred and floating tasks. Only confirmed intervals permit exact placement. Separate less work, shorter sittings and moving work. Every task has scope, completion meaning, rationale, LOS/mapping status, source pointer and a supported estimate or an explicit unknown. Commit acceptance atomically with revision checks and idempotency; preserve previous history.
>
> Home shows the next accepted action, quick learning capture and actionable attention items. My Week offers calendar and list views of the same records. Task detail supports partial completion, optional actual duration, deferral and source opening. Replace seeded personal metrics and global browser-state dependencies for these paths.
>
> Give each learning task a concise approach suited to its purpose: first exposure, class consolidation, misconception repair or retrieval of older material. Explain the goal, source/LOS focus, meaningful completion and follow-up check. Let students adapt or skip method substeps without blocking activity logging. Support protected non-study time and a continuity-focused lighter week. Show what defers and require approval for changes; never fill empty days or automatically recover backlog by increasing later workload.
>
> Test coaching, weekend self-study and variable-schedule users; reload/resume drafts, double acceptance, overlapping windows, long commitments, unknown sitting length, cancelled tasks and cross-device conflicts. No accepted plan may be replaced by deleting all historical blocks.

**UX target:** “I know what to do, how to approach it and where to study it, without sacrificing the commitments I chose to protect.”

### Phase 3 — Diagnostics, results and Curriculum

**First-build status:** mandatory USP phase. Phase 2 makes Roadmap usable as a planner; Phase 3 makes it a diagnostic accountability product. Use the complete single execution prompt in [PHASE-3-DIAGNOSTIC-ENGINE-FIRST-BUILD-META-PROMPT.md](./PHASE-3-DIAGNOSTIC-ENGINE-FIRST-BUILD-META-PROMPT.md). The summary below is retained only as a phase index and must not replace the full prompt.

> Connect Practice from capability discovery and scope selection through real attempt creation, delivery, submission, server-owned scoring, results and follow-up proposals. Use the supported, validated curriculum slice from Phase 0. Generate original CFA-style items on demand where validated generation is available; ground generation in eligible reference/specification data, enforce a module-size/evidence blueprint and validate calculations, distractors and scope. If checks fail, retry within bounds or use a clearly labelled reviewed-item fallback—not an unverified question dressed as success.
>
> Preserve attempts and item/rubric versions. Do not expose answer keys through normal pre-submission payloads. Support untimed entry, optional confidence signals and proportionate explanation checks with transparent rubrics and grading uncertainty. Never infer whole-subject mastery from a short attempt.
>
> Results identify the specific concept/LOS, relevant attempt evidence and where to revisit it. Exact page/lesson recommendations require an actual mapping. Add-to-week creates a proposal rather than silently publishing work. Curriculum shows exposure, practice evidence, recency and prerequisite relationships separately.
>
> Build concept-level history that connects an earlier miss, source-directed review and later eligible check. Distinguish self-reported confidence from scored performance and rubric uncertainty. Do not turn a correct low-confidence answer into a wrong answer or a wrong high-confidence answer into a personal judgment. Where evidence is insufficient, suggest an appropriate check and label the limitation. Test novel versus repeated-item evidence and ensure optional confidence answers do not block submission.
>
> Test unsupported topics, no model key, timeout, invalid generated item, interrupted attempt, duplicate submission, weak explanation evidence and external-score provenance. A locked-portal user must be able to take a supported curriculum-grounded diagnostic without uploading the portal's content.

**UX target:** “I can see what I have improved, what the evidence does not yet establish and what to revisit next.”

### Phase 4 — Week two and the operational Coach

> Implement the diagnostic-led checkpoint, expired-cycle/manual review triggers and midweek change proposals. Use observed completion, partial scope, eligible assessment evidence and refreshed commitments to create the next persisted draft. Missing logs stay unknown. Do not auto-raise workload after success, punish missed work, or carry every unfinished task into an accumulating backlog. Notifications require separate consent and delivery support.
>
> Build the Coach destination and contextual panel using the same account-scoped services as the UI. Implement intents for next action, calendar drafting/changes, supported diagnostic initiation, evidence-backed progress, specific weaknesses, opportunities/risks, source/LOS direction and confirmed learning capture. Retrieve fresh state; do not use chat history as the authoritative calendar.
>
> Also implement “How should I study this?”, “How do I balance this week?” and “I don't feel confident.” Return task-specific methods, reviewable trade-offs or evidence-linked support—not whole-topic lessons, motivational filler or psychological judgments. A checkpoint may ask whether the approach was useful and manageable; keep it brief and optional. Demonstrate a student expressing uncertainty despite correct answers, one with repeated reasoning errors and one restarting after a busy week. Preserve protected life commitments and adapt scope/methods without automatic workload penalties.
>
> Use typed tools with limited permissions. Calendar changes produce a diff and confirmation; execution uses revision/idempotency checks and an auditable receipt. Explicitly requested test creation can proceed through the normal assessment flow. Handle compound requests, ambiguous dates, stale proposals and tool failures truthfully. Redirect whole-chapter teaching requests into source guidance, a study roadmap or diagnostic-led priorities.
>
> Demonstrate two complete cycles and one midweek disruption for real test accounts. Test malicious imported instructions, cross-account references, stale-state actions, refusal to invent inaccessible source content and a failed tool call. Chat must never claim a calendar/test action happened unless the application confirms it.

**UX target:** “The Coach helps me choose a study approach, balance the real week and build justified confidence while acting through the app.”

### Phase 5 — Optional large files and selected Drive access

> Enhance Study Sources in context; do not restore a Materials primary tab. Replace the synchronous upload-as-analysis path with authenticated direct private storage upload, resumable progress, a durable job/status model and bounded extraction/mapping work. Set and display tested storage and processing limits. Support cancel, retry, resume, partial processing, deletion and account-scoped deduplication without exposing private-file existence across users.
>
> Add explicit selected-file Google Drive consent only when configured. Verify file download/export capability and honour revoked access/restrictions. A link-only source remains fully usable for pointer-based planning. Google sign-in is not Drive consent. Do not request broad Drive access merely for convenience, collect portal passwords or add scraping bypasses.
>
> Mark upload, extraction, suggested mapping, confirmed mapping and grounding eligibility separately. Preserve section/page anchors through extraction and retrieve only eligible relevant segments. A source update invalidates stale mappings until rechecked. Large-file failure must not remove the student's accepted plan or ability to practise against supported curriculum references.
>
> Test files above 15 MB, network interruption, cap exceeded, unreadable/scanned/encrypted files, cancelled jobs, revoked Drive access, restricted files, malicious document instructions and expired signed access. Document provider setup and limits; never claim arbitrary portals are integrated.

**UX target:** “I can connect permitted material when useful, and the app still works when I cannot.”

### Phase 6 — Full-scope release qualification

> Qualify the intended CFA Level I scope rather than declaring the pilot complete. Verify all advertised topic/module/LOS capabilities, generation/scoring quality, source provenance and meaningful fallback behaviour. Finish any missing supported-scope work before making full-coverage claims.
>
> Replace remaining seeded/global local state on production paths. Test authentication, Google/email signup and recovery on the deployed domain; two-account isolation, storage permissions, signed URLs, retention/deletion/export, rate limits, AI budgets, retry boundaries and redacted observability. Test mobile, keyboard/screen-reader use, slow/offline recovery, timezone/DST, multiple devices and concurrent Coach/UI edits. External source links must use safe navigation; arbitrary URL ingestion needs a separate controlled policy, not unrestricted server fetching.
>
> Validate that all Coach actions can also be completed through non-chat UI. Account protection and explicit paid entitlements must not become academic-readiness gates. No pass-probability claim should be shipped without a separately justified validation process.
>
> Qualify the three product responsibilities with observed usability checks: can a student explain how to begin a task, revise a week without losing protected commitments, and distinguish feeling confident from having assessment evidence? Verify no pressure to fill free time, no score for life balance and no false praise tied to missing evidence. Report usability findings as findings, not proof that the product improves wellbeing or guarantees exam outcomes.
>
> Deliver a release-readiness matrix with observed results, unresolved blockers, supported/unsupported source modes, operating limits and recovery procedures. Do not mark release-ready merely because the build compiles. Keep a clearly labelled internal pilot if content or operational requirements remain incomplete.

**UX target:** “The product behaves consistently and honestly when circumstances, devices or services fail.”

## 8. Architecture and scope guardrails

- **One task, many surfaces:** Home, calendar, Coach and Practice link to canonical IDs, not copied task descriptions with independent state.
- **Two independent grounding claims:** curriculum-supported diagnostic versus personal-document-grounded diagnostic. Show the appropriate provenance.
- **No-upload path is primary:** never put optional ingestion on the critical path to an accepted week.
- **Human-confirmed placement:** no exact timestamps from vague day-parts; no academic gate from missing answers.
- **Reviewable learning estimates:** effort estimates inform scope/placement and can improve with observations; they are not measured human capacity.
- **Diagnostics shape revision:** scheduling considers time/constraints; learning evidence determines what to revisit. Neither blindly becomes a weekly-hours multiplier.
- **Coach as a service client:** no privileged bypass around validation, permissions, assessment or confirmation.
- **Honest progression:** record effort and exposure separately from learning evidence. Keep unsupported capability visible rather than generating filler.
- **Study approach is part of the task:** objective, suggested method, source/LOS focus and verification intent travel with the canonical task across Home, Calendar and Coach. Methods guide, rather than gate, completion.
- **Life boundaries are real constraints:** protect confirmed personal commitments; an empty slot is not a study obligation. Temporary low-capacity weeks must not become permanent profile judgments.
- **Confidence is not a composite score:** optional perceived confidence, observed learning evidence and supportive restart behaviour remain distinct. Show specific progress and limitations, not unsupported reassurance.
- **Future curriculum years:** version taxonomy, sources and items; do not silently present 2027 mappings as verified for a later edition.

## 9. Scope exclusions for the first prototype

No whole-subject tutoring, portal scraping, generic browser extension, source marketplace, unverified massive corpus, predictive pass score, external-calendar synchronisation, unlimited file ingestion or full mock engine. Internal calendar management, original scoped diagnostics, LOS-linked guidance and the week-two loop are in scope.

External-calendar sync can follow separately; “Coach plots my calendar” initially means Roadmap's internal calendar, not unrequested writes to Google Calendar. Provider-native integrations are separately permissioned enhancements.

## 10. Prototype demonstration checklist

1. A new self-studier accepts a useful floating or timed week without an exam date or uploaded file.
2. A coaching student records class coverage through a locked-portal pointer and receives relevant consolidation and a supported diagnostic.
3. A task opens a real source pointer and explains the associated LOS/mapping certainty.
4. A diagnostic result creates a specific, reviewable revision proposal and updates the correct evidence view.
5. The Coach explains current progress using actual records and can start the requested eligible test.
6. The Coach previews and applies a confirmed calendar change; a concurrent edit cannot be overwritten silently.
7. A missed or partially completed week leads to a sensible next draft without a hidden workload penalty or loss of access.
8. The next cycle persists and survives reload; this is not a one-week wizard.
9. Material failure or unavailable personal content does not break the supported no-upload journey.
10. Two accounts cannot read or mutate each other's plans, sources, attempts or Coach actions.
11. A learning task tells a first-time student how to begin and how to check understanding without teaching the entire section or requiring every method substep.
12. A student protects personal time and chooses a continuity-focused week; the app shows deferred scope without filling empty slots or doubling next week's workload.
13. Correct-but-uncertain and incorrect-but-confident attempts produce different, evidence-grounded next steps without changing correctness based on confidence.
14. Concept history can show a specific earlier miss and a later eligible re-check, while clearly distinguishing repeated-item performance and insufficient evidence.
15. The Coach answers study-method, life-balance and confidence questions with concrete source-linked guidance or reviewable actions; no generic reassurance, personal diagnosis or fabricated mastery.
16. A student can restart after disruption without clearing the entire backlog, losing recorded evidence or being penalised for declining a reflection or suggested method.

**Next execution step:** Phase 0. Settle the real curriculum/assessment foundation and domain contracts, then build the first connected vertical slice. Do not begin with another round of disconnected page mockups or a larger upload field.
