# Roadmap Authentication and Onboarding — Implementation Context

> Historical document, superseded on 4 September 2026 by [the v4 context and product-flow map](./ONBOARDING-V4-AND-PRODUCT-FLOW.md). The assigned-workload, mandatory-onboarding and feasibility assumptions below no longer describe the current implementation. Retained only for historical context.

**Document type:** Current-state context  
**Product scope:** Roadmap for CFA Level I candidates preparing for 2027 exam windows  
**Last updated:** 1 September 2026  
**Implementation:** Next.js, Supabase Auth/Postgres, NVIDIA-compatible AI endpoint, optional Resend email delivery

## Purpose of this document

This document records what currently exists in Roadmap's authentication and onboarding experience, how the pieces connect, and the product reasoning embedded in the implementation. It is intended to give a designer, developer, founder, or future AI working on the codebase enough context to continue without reconstructing earlier decisions.

This is not a PRD. It does not define a proposed feature set, acceptance criteria, commercial scope, or launch commitment. Where unfinished work is mentioned, it is identified as a current limitation rather than a requirement.

## The experience in one sentence

A new CFA Level I candidate creates and verifies an account, gives Roadmap only the minimum constraints needed to understand their situation, optionally maps personal study material, reviews an algorithm-selected provisional workload, and enters a dashboard whose plan is expected to change as diagnostic evidence accumulates.

## Central product decision

The student does not choose how many hours they want to study each week.

Roadmap treats weekly study load as a calculated output. The candidate supplies constraints and context:

- the intended CFA Level I 2027 exam window;
- whether preparation is through coaching, self-study, or both;
- recurring class days when applicable;
- days on which a study sitting is realistically possible;
- the maximum length of one focused sitting;
- the candidate's broad starting stage;
- material source and topics already encountered.

Roadmap uses those inputs to generate a provisional load. Later versions of the plan are intended to respond to class coverage, diagnostic results, high-confidence errors, confidence calibration, recency, incomplete work, and exam proximity. Weekly hours are therefore shown as an assigned amount, never as an editable goal.

## End-to-end journey

The current journey is:

1. The visitor reaches the Roadmap login page.
2. They sign in with Google or email/password, or create a new account.
3. Email sign-up users see a verification state and follow the Supabase confirmation link.
4. The callback exchanges or verifies the authentication token and establishes the session.
5. A signed-in user without completed onboarding is routed to `/onboarding`.
6. The candidate completes the four onboarding steps.
7. The final onboarding action validates and saves the account-scoped setup.
8. The completed setup is also placed in local browser state for the current interactive prototype.
9. The candidate is redirected to `/app`.
10. Future visits to `/app` check authentication and onboarding completion before showing the product.

The route protection exists in two layers. The Next.js proxy refreshes Supabase sessions and prevents anonymous access to protected routes. The onboarding and product server pages repeat the relevant checks before rendering, including the onboarding-completion check.

## Authentication experience

### Login

The root route and `/login` render the same login experience. The page has two visual areas:

- a focused sign-in panel containing Google and email/password options;
- a product-explanation panel introducing the cycle of class or self-study, diagnostic, repair, and re-verification.

The explanatory panel is deliberately present before account entry. It tells the candidate that Roadmap is evidence-driven and that signing in is not simply access to another static planner.

Email/password login uses Supabase `signInWithPassword`. The UI returns a generic “email or password is incorrect” response rather than exposing whether a particular email exists.

### Account creation

The sign-up screen collects:

- full name;
- email address;
- password;
- acceptance of the current Terms and Privacy placeholders.

Passwords must contain at least eight characters in the client experience. Supabase remains the authority for account creation and can enforce additional project-level password rules.

The full name is placed into Supabase user metadata. A database trigger creates the corresponding `profiles` record when the Auth user is inserted. If no name is available, the implementation derives a temporary display name from the email prefix.

The current Terms and Privacy pages clearly identify themselves as MVP placeholders. They describe the learning-support purpose, non-affiliation with CFA Institute, material ownership expectations, academic-integrity boundary, categories of stored data, and the intended account-scoped treatment of uploaded material. They are not production legal documents.

### Google authentication

Google authentication is initiated through Supabase OAuth. The callback URL is generated from the active site origin and points to:

`/auth/callback?next=/app`

Supabase must have Google enabled and the deployed callback URL must be present in its redirect allowlist. Google client credentials are configured inside Supabase; they are not exposed to the browser through Roadmap environment variables.

At present, a first-time Google user is sent toward `/app`; the product route detects that onboarding is incomplete and redirects them to `/onboarding`. This keeps onboarding enforcement in one place.

### Email verification

After email sign-up, the user is sent to `/check-email`. The page tells the user to verify the address and avoids claiming that a message was definitely delivered beyond the configured email provider.

Two server routes support Supabase email link formats:

- `/auth/callback` exchanges a PKCE authorization code for a session;
- `/auth/confirm` verifies a `token_hash` and email OTP type, supporting custom Supabase email templates.

Both routes validate the requested next path before redirecting.

### Password recovery

The recovery journey is:

1. The candidate opens `/forgot-password`.
2. They submit an email address.
3. Supabase sends a single-use recovery link pointing through `/auth/callback?next=/update-password`.
4. The UI always shows a neutral “if an account exists” confirmation to reduce account enumeration.
5. The recovery session opens `/update-password`.
6. The candidate enters and confirms a new password.
7. After the update, other sessions are signed out and the user returns to login.

The browser UI prevents submission when the passwords differ or contain fewer than eight characters. Supabase rejects expired or invalid recovery sessions.

### Redirect protection

Authentication callbacks do not accept arbitrary redirect destinations. `safeNextPath` permits only paths on the Roadmap origin and rejects missing values, external origins, and protocol-relative paths such as `//example.com`. This prevents an authentication link from becoming an open redirect.

### Sign-out

The product sidebar contains an account-scoped sign-out action. It ends the Supabase browser session and returns the candidate to `/login`.

## Onboarding philosophy

The onboarding is intentionally short and operational. It avoids asking questions that the diagnostic engine should answer later.

The candidate is not asked to self-rate every subject, predict their exam score, choose a readiness percentage, select a preferred weekly workload, or create a detailed timetable. Self-reported confidence is not treated as verified ability. The purpose of onboarding is to create a usable first plan and reach diagnostic evidence quickly.

The four-step format provides enough context without turning first entry into a questionnaire.

## Step 1 — Exam target

The first screen asks when the candidate intends to sit CFA Level I. The implemented 2027 windows are:

- February 2027;
- May 2027;
- August 2027;
- November 2027.

The candidate also confirms a timezone. India, the United Kingdom, and US Eastern are provided as common options, and the browser-detected timezone is retained when it differs.

The exam window affects the planning pressure calculation. The interface explains that it can be changed later, because early candidates may not yet be formally registered.

The current implementation maps each window to a representative target date for planning. Those dates are application defaults and must not be presented as confirmed CFA Institute appointment dates without validating the official schedule.

## Step 2 — Preparation and constraints

The second screen establishes how learning enters the candidate's week and what a feasible sitting looks like.

Preparation mode has three choices:

- coaching/classes;
- self-study;
- both.

When coaching or both is selected, at least one recurring class day is required. Self-study candidates are not shown the class-day requirement.

The candidate selects every weekday on which a study sitting is possible. At least one day is required. These selections do not promise that Roadmap will fill every selected day; they define the available scheduling surface.

Maximum sitting length is selected from:

- 30 minutes;
- 45 minutes;
- 60 minutes;
- 90 minutes.

This is the longest focused block the candidate believes they can realistically complete before needing a break. It is not the number of hours available in the week.

## Step 3 — Starting point and material

The third screen asks for broad context about what the candidate has already encountered.

Starting stage has three choices:

- starting from zero;
- already studying;
- in revision.

This stage changes the provisional demand calculation. It does not establish preparedness.

Material source has three choices:

- Schweser 2027, the current default provider mapping;
- CFAI Learning Ecosystem;
- imported personal material.

The default Schweser selection is currently a provider reference and chapter-mapping choice. The application does not silently load or reproduce the user's uploaded Schweser books during every session.

Candidates can optionally mark broad topics already encountered across the full CFA Level I topic list. This establishes possible coverage, not verified mastery. A relevant imported file can add detected topics to this selection.

### Personal material import

The onboarding accepts PDF and plain-text files up to 15 MB. The user must explicitly authorize private AI analysis before the file is submitted.

The current analysis process:

1. authenticates the request, except for the development-only demo path;
2. rejects unsupported formats and oversized files;
3. extracts text from up to the first 25 PDF pages, or reads plain text;
4. rejects files with insufficient readable content;
5. calculates a conservative CFA relevance and topic signal;
6. optionally asks the configured NVIDIA model for a structured relevance classification;
7. treats all extracted document text as untrusted content rather than instructions;
8. filters returned topic labels to the approved CFA Level I topic list;
9. falls back to the conservative classifier if the AI provider is unavailable;
10. returns only relevance, confidence, mapped topics, summary, and cautions.

The extracted source text is not written to the current database by this endpoint. The onboarding record stores the file name and classification result, while `user_materials` stores the source type, display name, mapping, relevance status, confidence, and summary. The schema includes a future `storage_path`, but the current onboarding analysis does not upload the source file to persistent storage.

The UI explicitly states that imported material is not added to a shared question bank. Diagnostic generation is expected to create original questions aligned to concepts rather than reproduce provider text.

## Step 4 — Review and handoff

The final screen summarizes:

- exam window;
- preparation mode and class-day count;
- the provisional weekly study load selected by Roadmap;
- the number of sittings;
- maximum sitting duration;
- active material source;
- expectation of a first diagnostic within 48 hours.

Each major row can return the candidate to the relevant earlier step.

The copy deliberately labels the workload as provisional. The first diagnostic is intended to calibrate topic priority and future workload. The screen also explains that subsequent changes are expected to depend on class coverage, diagnostic results, confidence calibration, recency, and exam pressure.

Selecting “Enter Roadmap” validates the complete payload on the server, stores the setup, removes the local onboarding draft, writes the current prototype handoff state, and redirects to `/app`.

## Provisional workload calculation

The first weekly load is produced by `computeInitialStudyLoad`. The current calculation contains four demand components:

- **Starting-stage demand:** 210 minutes when not started, 270 minutes when in progress, or 330 minutes during revision.
- **Class pressure:** 35 minutes for each recurring class day when the candidate uses coaching.
- **Exam pressure:** an additional 45, 90, or 150 minutes as the exam moves within 240, 150, or 90 days.
- **Coverage calibration:** eight minutes for each broadly encountered topic, capped at 60 minutes; candidates with no selected coverage receive a 30-minute initial calibration allocation.

Demand is limited by an onboarding capacity guardrail:

`available study days × maximum sitting length × two sittings per day`

The output cannot fall below 120 minutes per week. The number of sittings is at least three and otherwise equals the weekly minutes divided by the maximum sitting length, rounded upward.

This formula is an initial bootstrap mechanism, not the full adaptive scheduling system. At onboarding there are no candidate-specific diagnostic results yet. The resulting minutes are stored as `provisional_weekly_minutes` so the distinction remains explicit.

## Data written when onboarding completes

The onboarding API validates the payload with a strict server-side schema before any database write. The authenticated user ID comes from the Supabase session, never from the submitted form.

The write sequence is:

| Storage area | Current purpose |
|---|---|
| `profiles` | Display name, timezone, onboarding completion, maximum sitting length, and preparation mode |
| `onboarding_sessions` | Versioned snapshot of the submitted answers and completion time |
| `exam_attempts` | CFA Level I, curriculum year, exam window/date, starting stage, status, and provisional weekly minutes |
| `availability_rules` | Feasible weekdays and maximum sitting length |
| `class_schedules` | Recurring class weekdays when applicable |
| `user_materials` | Provider or imported-material mapping and relevance metadata |

Availability and recurring class rows are replaced with the latest onboarding selection. The active exam attempt is upserted on the combination of user, curriculum year, and level.

The current API performs these operations sequentially and returns a targeted user-facing error when one fails. They are not yet wrapped in one database transaction, so a late failure can leave earlier records saved. This is a known implementation characteristic.

## Browser-side continuity

Onboarding uses two local-storage records:

- `roadmap-onboarding-draft-v1` preserves the active step and answers while the candidate moves through onboarding;
- `roadmap-onboarding-v1` passes the completed prototype setup into the current client-side dashboard state.

The completed dashboard profile uses the stored display name, exam date, preparation mode, maximum sitting length, and provisional weekly minutes. Existing prototype state is normalized against defaults so earlier saved versions do not remove new fields.

The database is the durable account record. Local storage is currently a bridge for the interactive dashboard prototype and should not be interpreted as the final production source of truth.

## Route map

| Route | Role |
|---|---|
| `/` | Primary login entry |
| `/login` | Explicit login route |
| `/signup` | Account creation |
| `/check-email` | Email-verification instruction state |
| `/forgot-password` | Initiates password recovery |
| `/update-password` | Sets a new password inside a valid recovery session |
| `/auth/callback` | Exchanges a Supabase authorization code and redirects safely |
| `/auth/confirm` | Verifies token-hash email links |
| `/auth/error` | Friendly invalid/expired authentication-link state |
| `/onboarding` | Authenticated four-step setup |
| `/app` | Authenticated product shell; incomplete users return to onboarding |
| `/terms` | MVP terms notice |
| `/privacy` | MVP privacy notice |
| `/api/materials/analyze` | Authenticated relevance and topic analysis |
| `/api/onboarding` | Validates and persists completed onboarding |

In development only, `?demo=1` permits the guided setup and product shell to be previewed without creating an account. The bypass checks `NODE_ENV` and is not active in production.

## Database ownership and security

Supabase Auth owns identity and session management. Application records reference `auth.users` through `profiles.id`, with cascading deletion configured for associated Roadmap data.

Row Level Security is enabled on profiles, onboarding sessions, exam attempts, availability, classes, materials, metrics, plan blocks, and test records. Policies compare the authenticated Supabase user ID to the row owner. User-ID foreign keys are indexed.

The profile-creation trigger runs as `security definer` with an empty search path and explicitly references `public.profiles`. This narrows object-resolution risk in the privileged function.

Client-visible code receives only the Supabase project URL and anonymous key. The Supabase service-role key, NVIDIA key, and Resend key remain server-side.

The current security boundaries include:

- authentication checks on protected pages and APIs;
- server-derived user ownership;
- strict onboarding input validation and field limits;
- file type and 15 MB size limits;
- limited PDF extraction;
- untrusted-document prompt handling;
- approved-topic filtering on AI results;
- safe callback redirects;
- generic login and recovery messaging;
- production-disabled demo bypass;
- account-scoped RLS for stored records.

## Visual and interaction language

Authentication uses a clean white and deep-navy split layout with electric blue as the primary action color. The visual system is intentionally more like a serious learning-control product than a gamified education app.

The login explanation uses a linear visual cycle, while the underlying product meaning is iterative: learn, verify, repair, and re-verify. On mobile, the explanatory panel is removed so authentication remains focused.

Onboarding uses:

- a persistent four-step progress header;
- large, explicit choice cards;
- short supporting descriptions;
- one primary action at a time;
- editable summary rows before final submission;
- inline validation rather than disabled choices with no explanation;
- reduced-motion handling for users who request it.

The generated visual concept is stored at `design/auth-onboarding-concept.png`. The implementation deliberately corrected the concept's sample 2025 diagnostic date and does not invent an exact appointment time during onboarding.

## Environment and external configuration

The implementation recognizes these environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
SUPABASE_SERVICE_ROLE_KEY
NVIDIA_API_KEY
NVIDIA_BASE_URL
NVIDIA_MODEL
RESEND_API_KEY
RESEND_FROM_EMAIL
```

The service-role key is reserved for future server-controlled administration and background work; the onboarding endpoint uses the authenticated user's Supabase session and RLS.

Supabase also requires dashboard configuration outside the repository:

- the production site URL;
- allowed callback and confirmation redirect URLs;
- Google provider credentials when Google login is enabled;
- email templates aligned with `/auth/callback` or `/auth/confirm`;
- production SMTP configuration, such as Resend, when Roadmap is ready to deliver authentication email reliably.

## Current AI-provider condition

The material-analysis endpoint has a non-AI relevance fallback, so onboarding can still classify a document conservatively when NVIDIA is unavailable. The configured NVIDIA key encountered retired or account-inaccessible model endpoints during implementation testing. A key with access to the chosen `NVIDIA_MODEL` is needed for dependable provider-backed analysis.

This provider condition does not change authentication, route protection, onboarding validation, workload calculation, or Supabase persistence. It affects only the optional AI enhancement to material classification.

## Current verification state

At the time of this document:

- the TypeScript check passes;
- the optimized Next.js production build passes;
- all authentication, onboarding, legal, product, and API routes compile;
- login, onboarding, and dashboard pages returned successful responses during local route checks;
- material analysis correctly classified a synthetic CFA-related text fixture;
- the coach and material endpoints degrade safely when the configured AI model is unavailable;
- the codebase contains no remaining editable `weeklyHours` or “weekly capacity” field.

The in-app browser's URL safety policy blocked the localhost visual walkthrough during the last verification pass. Consequently, responsive behavior is implemented in CSS and build-verified, but the final desktop/mobile visual click-through was not completed on that browser surface.

## Known implementation boundaries

These are descriptions of the current state, not new requirements:

- Terms and Privacy pages are placeholders and are not production legal text.
- Resend variables exist, but custom production email delivery is not yet wired as an application-owned email service; Supabase Auth remains the sender unless custom SMTP is configured.
- Password strength beyond the eight-character UI minimum depends on Supabase project settings.
- There is no MFA, device/session-management screen, account deletion journey, or personal-data export journey yet.
- The onboarding API is not currently wrapped in a single database transaction.
- The selected exam dates are planning defaults rather than live official appointment data.
- Uploaded source files are analyzed transiently and not persistently stored by the onboarding endpoint.
- The full dashboard still uses local prototype state for immediate interaction after onboarding; durable plan hydration from Supabase is a later architectural step.
- The initial workload formula is a bootstrap calculation. It does not yet incorporate prior-week diagnostics because a new candidate has no such evidence.
- Development demo mode is deliberately unavailable in production.

## File map

The main implementation files are:

- `src/components/auth/AuthForm.tsx` — login, account creation, Google OAuth initiation, and primary account UI.
- `src/components/auth/RecoveryForms.tsx` — forgot-password, update-password, email-verification, and shared account-state card.
- `src/app/auth/callback/route.ts` — PKCE code exchange.
- `src/app/auth/confirm/route.ts` — token-hash verification.
- `src/lib/auth/redirect.ts` — safe same-origin next-path validation.
- `src/lib/supabase/proxy.ts` and `src/proxy.ts` — session refresh and protected-route enforcement.
- `src/app/onboarding/page.tsx` — server-side onboarding gate and display-name loading.
- `src/components/onboarding/OnboardingFlow.tsx` — all four onboarding screens and local draft continuity.
- `src/lib/planning/initialLoad.ts` — provisional weekly-load calculation.
- `src/app/api/materials/analyze/route.ts` — material extraction, relevance analysis, and fallback.
- `src/app/api/onboarding/route.ts` — server validation and database persistence.
- `src/app/app/page.tsx` — product access and onboarding-completion gate.
- `src/state/AppState.tsx` — current prototype handoff into the dashboard.
- `supabase/schema.sql` — profile trigger, application tables, indexes, and RLS.
- `src/styles.css` — authentication, onboarding, responsive, reduced-motion, and product styling.
- `.env.example` — expected public and server-only configuration names.

## Context to preserve in future work

Future changes should preserve the distinction between constraints and recommendations. A candidate may tell Roadmap when a sitting is possible and how long one sitting can be; they should not be asked to design the weekly learning load that Roadmap is supposed to calculate.

Onboarding coverage answers are provisional. Readiness should move because of retrieved, explained, and applied knowledge—particularly diagnostic results and confidence-weighted errors—not because the candidate marked a subject as familiar.

Imported material should remain private and account-scoped. It can help locate concepts and generate original practice, but it should never become a shared reproduction source.

Finally, onboarding should continue to lead quickly into the product's core loop. Its job is to establish enough context for the first credible plan and diagnostic, not to make a new candidate describe everything the system is intended to discover.
