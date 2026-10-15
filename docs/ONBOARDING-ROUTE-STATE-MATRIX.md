# Onboarding Route and State Matrix

This document defines the ownership of authentication, access gating, progress/resume, normalized answers, preview generation, preview acceptance, and downstream edits.

## 1. Authentication and Identity
- **Owner**: `supabase/server` (Supabase Auth).
- **Enforcement**: All API endpoints and page server components (`src/app/onboarding/layout.tsx`, `src/app/onboarding/[step]/page.tsx`, `src/app/api/onboarding/*`) derive `auth.uid()` securely. No client-supplied IDs are trusted.

## 2. Access Gating
- **Owner**: Server Layouts (`src/app/app/layout.tsx`).
- **Enforcement**: Users with incomplete onboarding (derived from `profiles.onboarding_status`) cannot load any `/app/*` routes. They are intercepted and redirected to `/onboarding`.

## 3. Progress and Resume
- **Owner**: Server Resume Resolver (`src/app/onboarding/page.tsx`).
- **Enforcement**: The resolver determines the first incomplete required step based on the strict presence and validity of answers in the database (via `service.ts`), not merely the `onboarding_step` metadata flag.

## 4. Normalized Answers
- **Owner**: `src/lib/onboarding/service.ts`.
- **Enforcement**: Uses `src/lib/onboarding/schema.ts` (Zod contracts) to validate and normalize step submissions. Idempotently writes to `profiles`, `calendar_commitments`, `user_topic_exposure`, and `availability_windows`. Triggers an increment to `onboarding_context_version` upon material changes.

## 5. Preview Generation
- **Owner**: `src/lib/onboarding/previewService.ts` and `src/app/api/onboarding/plan/preview/route.ts`.
- **Enforcement**: Evaluates the normalized setup, constructs the deterministic first-week plan, and transactionally persists the roadmap draft, milestones, and plan draft (with a `context_fingerprint`) into the database. Cannot be regenerated silently during confirmation.

## 6. Preview Acceptance
- **Owner**: PostgreSQL RPC `accept_onboarding_preview` (called via `src/app/api/onboarding/plan/confirm/route.ts`).
- **Enforcement**: An atomic transaction executing inside Postgres. Verifies the user, fingerprint, and Ready state. Transfers the locked server-owned JSON into an active cycle and active tasks. Mutates `onboarding_status` to `complete`. Completely rolls back if any step fails.

## 7. Downstream Edits (Settings)
- **Owner**: `src/app/app/settings/*` routes calling updated core services.
- **Enforcement**: Edits to planning-relevant fields (exam date, commitments, availability) increment `onboarding_context_version`. They do not silently rewrite historical tasks or accepted weeks; they generate change proposals for the current/future cycle.
