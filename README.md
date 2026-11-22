# PrepPlan — CFA Level I study-planning and accountability system

A competitive-exam study planner: it plans each week around the student's real life, tests what they have actually completed, shows what the evidence says, and re-cuts the next week. It does not teach the curriculum.

**Start here:** [`docs/MASTER-STATUS-AND-COMPLETION-PLAN.md`](docs/MASTER-STATUS-AND-COMPLETION-PLAN.md) — what is built, what is broken, what is left, in what order.
Product authority: [`docs/FOUNDER-PRODUCT-DECISIONS.md`](docs/FOUNDER-PRODUCT-DECISIONS.md). Vision: [`docs/VISION-CONTEXT.md`](docs/VISION-CONTEXT.md), [`docs/PRD-v1.md`](docs/PRD-v1.md).

## Stack
Next.js 16 (App Router) · Supabase (Auth + Postgres + RLS) · Zod · NVIDIA-hosted model via the OpenAI SDK for constrained drafting and Coach wording. Planning, scoring and evidence are deterministic; the model never changes the calendar or evidence on its own.

## Run
```bash
cp .env.example .env.local   # fill in Supabase + NVIDIA keys; never commit .env.local
npm install
npm run dev                  # http://localhost:3000
```

## Check
```bash
npm run verify   # typecheck + ~25 offline domain suites + route audit (no database needed)
npm run build
npm run foundation:db:test  # disposable loopback-only Postgres; requires local Postgres binaries
```
`npm run e2e:*` scripts drive a **real Supabase project** and can reset data (`E2E_ALLOW_RESET`). Point them only at a disposable project.

Synthetic banks are excluded from normal assessments and from capacity reports. For a fixture-backed browser run, start a separate development server on loopback with `ROADMAP_FIXTURE_BANK=1` and use the test's recorded bank. Production builds ignore that setting.

```sh
ROADMAP_FIXTURE_BANK=1 npm run dev:isolated -- .next-fixture dev -H 127.0.0.1 -p 3185
```

## Database changes

The migration command requires an explicit environment and mode. It never falls back to another target's credentials or shell environment variables:

| Target | Credentials file | Required binding |
| --- | --- | --- |
| `local` | `.env.local` | `MIGRATION_DATABASE_URL` (loopback only), `MIGRATION_EXPECTED_DATABASE` |
| `staging` | `.env.staging.local` | `NEXT_PUBLIC_SUPABASE_URL`, matching `MIGRATION_EXPECTED_PROJECT_REF`, `SUPABASE_DB_PASSWORD` |
| `production` | `.env.production.local` | Same bindings, specific to production |

```bash
npm run migrate -- --env=staging --dry-run
```

Dry-run is a read-only history/checksum preview, not a rehearsal of executing the pending SQL. Apply additionally requires `--apply --confirm-target=<exact-project-ref>` (or `local:<database>`). Remote TLS certificates are verified; use `MIGRATION_SSL_CA_FILE` for a trusted CA bundle if required. Each file commits with its checksum; failed files roll back. Previously committed files stay committed and are skipped on retry.

An existing schema without a populated migration ledger is refused on apply. **The full fresh-install/upgrade baseline is still unresolved**; do not initialise history by marking old migrations applied without reconciling the real schema. `supabase/schema.sql` alone is not a current installation baseline.

Task execution requires `20261028_atomic_task_execution.sql`; shared-scope splits and confirmations additionally require `20261028_task_scope_and_split.sql`. Apply and verify both in a reconciled staging environment **before deploying the changed task/calendar code**; there is no unsafe fallback to separate writes. Both are applied to the user-confirmed disposable development project. The isolated database suite proves the commands' dependencies and failure behaviour, not installation of the entire app or production schema parity.

Splitting conserves planned time and curriculum mapping. Its second sitting stays unplaced; all sittings share one learning scope. Completing one sitting does not silently complete its entire LOS while another remains. Tests can include the outcomes the student explicitly confirms, and deduplicates a scope when all sittings finish. Weekly rollover/carry-forward is still a separate unfinished slice; see the master plan before treating this as a complete calendar lifecycle.

Weekly continuity requires `20261029_weekly_continuity.sql` (continuation tasks, saved review drafts and the single guarded closure command). It is applied to the app's database (the same project `.env.local` and `.env.staging.local` both name). If you rebuild or clone the database, apply it before running code that selects `continued_from_task_id`. `npm run continuity:db:test` proves it in a disposable loopback Postgres; like the other isolated suites it needs local Postgres binaries and is not part of `verify`. `npm run continuity:schema:rehearse -- --confirm-target=<ref>` runs the migration and one full closure against the user-confirmed disposable development project inside a transaction that is always rolled back (reads only `.env.staging.local`). What is still unverified: `docs/WEEKLY-CONTINUITY-W0.md` §10.

Two additional checks are available for a user-confirmed disposable development project:

- `npm run task:development:test -- --confirm-target=PROJECTREF` uses the named staging configuration and requires `E2E_CONFIRMED_DISPOSABLE_PROJECT_REF` to match. It tests the real database command and RLS with all fixture writes rolled back.
- `npm run task:http:test -- --confirm-target=PROJECTREF --base-url=http://127.0.0.1:3101` additionally requires a running build of this app on that loopback address and matching app/project configuration. It creates one dedicated dummy Auth identity, verifies the real cookie/API/RPC path, and removes that identity and its task/history/receipts in cleanup. It does not reset an existing account or send email.

Replace `PROJECTREF` with the exact confirmed project reference. Neither hosted check is part of the ordinary offline `verify` command. Development activation results are recorded in the master completion document; they do not certify production or a fresh installation.

## Layout
- `src/app` — pages and API routes (`/app/*` is the signed-in product; `/onboarding/*` is setup)
- `src/lib` — domain logic: `planning/`, `curriculum/`, `tests/`, `diagnostic/`, `signals/`, `state/`, `coach/`, `onboarding/`
- `supabase/migrations` — schema history (see the master doc on baseline/runner issues before applying anywhere)
- `data/curriculum-2027` — the 102-reading / 10-subject curriculum spine seed
- `scripts` — domain tests, E2E drivers, bank loaders and audits
- `docs` — active documentation; `docs/archive` — superseded plans (indexed)
