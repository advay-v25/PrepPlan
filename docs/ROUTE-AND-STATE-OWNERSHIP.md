# Route and State Ownership

## 1. Golden Rules of State

1. **State lives on the server.** The source of truth is the Postgres database.
2. **Page renders are read-only.** Visiting a page (`GET` request) must **never** mutate state.
3. **`OperatingState` is the unified read model.** All student-facing views derive their context from `src/lib/state/operatingState.ts`.
4. **Mutations happen via API endpoints or Server Actions.** They must be explicitly triggered by user intent or scheduled background jobs, never as a side-effect of navigation.

## 2. Canonical Routes

All application routes are defined in `src/lib/routing/registry.ts`.

- `/login` - Authentication entry point.
- `/onboarding/*` - The mandatory setup phase. Users cannot enter `/app` until `onboarding_status === 'complete'`.
- `/app` - Action-first Home and the student's operating console.
- `/app/calendar` - The weekly tactical view. Read-only projection of `plan_blocks`.
- `/app/curriculum` - The long-term strategic view. Read-only projection of `study_roadmaps` and `user_module_state`.
- `/app/tests` - The evidence and repair view.
- `/app/coach` - The advisory view. Derives advice from `OperatingState`.

Completed users edit exam, route, classes, availability, and other setup inputs through Settings-owned editors. They are not sent back through the gated first-time onboarding journey.

## 3. The End of AppState

The legacy `AppState` Context provider has been removed. Client-side state is restricted to ephemeral UI state (e.g. "is the drawer open", "what is typed in this input"). Persistent state is exclusively fetched server-side and passed down as props to Client Components where interactivity is required.

## 4. End-to-End Testing

End-to-end tests must protect real user identities. Destructive tests (`--reset`) must use the `E2E_EMAIL` and `E2E_ALLOW_RESET=1` guards. Tests must assert that navigating the app does not produce side effects (e.g. the "Render Purity" test in `e2e-calendar.ts`).
