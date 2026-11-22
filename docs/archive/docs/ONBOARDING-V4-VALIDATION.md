# Onboarding v4 validation

4 September 2026. Scope: the context-first setup and entry changes, not a full security audit or production certification.

## Executed checks

- `npm run lint`: passed (TypeScript).
- `npm run build`: passed; production routes compiled and generated.
- `node scripts/test-study-context.cjs`: passed; optional defaults, input bounds, timezone/month validation, unknown-field stripping, legacy defaults and v4 round-trip.
- `node scripts/test-onboarding.cjs`: passed using the existing development server on localhost:3000 and an isolated Playwright Chromium profile.
- Browser plugin was not available in this session; regular Playwright was used under the frontend-testing skill's fallback.
- Browser suite covered blank optional completion, selections, local-draft reload, successful save/clear, simulated cloud failure and escape, invalid timezone and escape, unreadable/irrelevant material continuation, mobile horizontal overflow, and no runtime page errors.
- Verified that none of the tested onboarding interactions requested `/api/plan`.
- Real unauthenticated route checks: app and onboarding paths redirect to sign-in; context GET/POST require authentication; conflicting Origin is rejected; retired feasibility API returns 410; plan API requires authentication.
- Browser save/material responses were explicitly stubbed. The suite does NOT prove live authenticated Supabase persistence, actual AI file analysis, email/Google flows or signed-in redirect behaviour.

## Visual review / fidelity ledger

Generated reference: `design/onboarding-context-v4-concept.png`. Actual desktop and mobile screenshots were opened and visually inspected, not merely saved.

| Reference anchor | Implemented result | Disposition |
| --- | --- | --- |
| White canvas, navy text, blue actions | Same palette and restrained treatment | Matched |
| Left rail with brand and five numbered steps | 300px desktop rail, current step highlighted | Matched |
| Large contextual heading and short introduction | Clear hierarchy and roomy form content | Matched |
| Seven-day, three-part availability grid | Distinct toggle states and no implied study-hour arithmetic | Matched |
| Persistent skip and Back/Continue flow | Top-right skip, bottom actions, explicit access reassurance | Matched |
| Fixed-commitments disclosure | Native keyboard-operable disclosure with optional text context | Matched; avoids premature calendar interpretation |
| Broad choice cards | Smaller wrapping choices | Intentional: text determines width and adapts cleanly to mobile |
| Mobile adaptation | Compact numbered navigation, stacked inputs, wrapping choices, full readable review | Verified at 390px; no horizontal overflow |

Screenshots in `artifacts/onboarding/`: desktop-start, desktop-learning, desktop-real-life, mobile-real-life, mobile-practice and mobile-review. The small Next.js development indicator is development tooling, not product UI.

## Before deployment

1. Apply/review `supabase/migrations/20260904_retire_onboarding_screening.sql`; it was not executed remotely. Confirm all context/profile RLS policies match the repository schema.
2. Test two genuine accounts: save/reload/reopen context, skip directly to Home, isolate records across accounts, inspect failure handling with expired sessions. Do not use real customer credentials in automated fixtures.
3. Test Google sign-in, email verification and reset links on the deployed domain and configured SMTP provider. Those integrations were not exercised here.
4. Test cross-device editing, keyboard/screen-reader behaviour and private-browsing/storage failure. Basic focus styles/semantics exist; a full accessibility audit is not claimed.
5. Rebuild the real-data weekly loop before removing the explicit prototype notice on downstream tools. No real student readiness or study-hour assignment should be inferred from the current seeded local state.

No source books were ingested or redistributed in this phase. No existing remote plan, material or commitment rows were deleted. Legacy Home UI was retained as a local backup; retired routing and screening code was intentionally removed.
