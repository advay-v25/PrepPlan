# Roadmap CFA Level I — implementation guide

## What the demo proves

The browser prototype runs without external services and persists to local storage. One candidate record connects the weekly plan, syllabus readiness, diagnostic history, materials, coach conversation, exam date and Preparedness Index. Accepting a diagnostic result changes readiness, creates an evidence record, identifies a weakest module and turns the protected Sunday buffer into a repair block.

## Production services

### Required

1. **Supabase** — authentication, Postgres, row-level security, private Storage and scheduled Edge Functions. Create a project and provide `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
2. **OpenAI API** — coach responses, constrained diagnostic assembly, short-answer grading and misconception extraction. Provide the server-only `OPENAI_API_KEY` plus model aliases in `OPENAI_COACH_MODEL` and `OPENAI_DIAGNOSTIC_MODEL`.
3. **A server boundary** — a small API service, Supabase Edge Functions or a migration to Next.js. The Vite client must never receive OpenAI or Supabase service-role secrets.

### Recommended

- **Resend:** email verification, missed-session nudges and weekly evidence summaries (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`).
- **PostHog:** consented product analytics and funnel measurement (`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`).
- **Sentry:** client and server error reporting (`VITE_SENTRY_DSN` plus a server DSN in deployment settings).
- **Cron secret:** protects scheduled weekly-plan recalculation and retention-review jobs (`CRON_SECRET`).

Google Calendar is intentionally optional. Roadmap owns its week model; calendar export should be a later convenience layer, not a planning dependency.

## Core production tables

- `profiles`, `exam_attempts`, `availability_rules`, `class_events`
- `curriculum_topics`, `learning_outcomes`, `prerequisite_edges`
- `study_blocks`, `block_completions`, `material_pointers`
- `question_bank`, `diagnostic_sessions`, `responses`, `misconception_signals`
- `mastery_snapshots`, `review_queue`, `plan_proposals`, `coach_events`

Every user-owned table should carry `user_id` and row-level security. Question-bank items and marking rubrics remain server-side. Store material references and small personal excerpts only when licensed; do not build a shared copy of a commercial curriculum.

## AI boundaries

The model may select from an approved question bank or draft items into a review queue. It should not invent curriculum coverage, silently change the plan, or grade calculations without a deterministic check. Store the evidence used, confidence, rubric version and resulting plan diff. A student explicitly accepts material schedule changes.

## Next product layers

1. Full CFA Level I curriculum graph and prerequisite mapping.
2. Human-reviewed diagnostic bank with unseen-item controls and psychometric telemetry.
3. Explanation-based checks, numerical working capture and case-study grading.
4. Spaced review queue driven by retrieval strength and forgetting risk.
5. Coaching-centre lecture ingestion with explicit topic/LOS confirmation.
6. Weekly plan diff, overload detection, recovery rules and audit history.
7. Privacy, moderation, observability, rate limits and evaluation suites before public launch.
