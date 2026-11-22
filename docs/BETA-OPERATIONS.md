# Roadmap private beta — operations

Status: prepared and rehearsed locally; **hosted beta project pending** (see "Hosted checks still needed"). Secrets are named here, never shown.

## 1. Environments

| Environment | Project | Purpose | Env file |
|---|---|---|---|
| Development / staging | `asylsxszdhlnzewhwtga` (user-confirmed disposable) | Development, fixtures, e2e. **Both `.env.local` and `.env.staging.local` point here, so they do not establish separation.** | `.env.local`, `.env.staging.local` |
| Local rehearsal | throwaway Postgres on loopback | Installation, restore, admission tests | none (scripts create and remove it) |
| **Beta** | **a distinct Supabase project — not created yet** | The invited cohort | `.env.production.local` (migration CLI) + the host's runtime variables |

Test accounts (`integ+…@example.com`), synthetic reviewed items (provenance `fixture-bank`) and unconfirmed-rights batches stay in development. The beta baseline carries **no accounts, attempts, items, batches or concepts**.

## 2. Variables (names only)

See [Security and authentication setup](AUTHENTICATION-SETUP.md) for host variables, credentials, auth providers and email templates. Set `RELEASE_REVISION` and `EXPECTED_SCHEMA_VERSION` to identify the deployed build and its expected schema. An optional `NVIDIA_API_KEY` with `NVIDIA_BASE_URL` and `NVIDIA_MODEL` enables Coach wording.
Migration CLI only (`.env.production.local`): `NEXT_PUBLIC_SUPABASE_URL`, `MIGRATION_EXPECTED_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, optional `MIGRATION_SSL_CA_FILE`. Never in the app runtime.

## 3. Installation order (fresh beta project)

1. Create the Supabase project (region per owner; PG 17). Note its ref. Create `.env.production.local` from `.env.example` (migration block only).
2. Auth settings (Supabase dashboard → Authentication): Site URL = the beta origin; Redirect URLs allow-list = `<origin>/auth/callback`, `<origin>/auth/confirm`, `<origin>/update-password` only; email provider SMTP configured; email templates use `{{ .SiteURL }}` links; "Confirm email" ON; Google OAuth OFF unless the owner enables it (the invite gate also applies to it).
3. `node scripts/beta/install-hosted.cjs --confirm-target=<beta-ref>` (preflight; refuses the development project, refuses a non-empty database), then the same with `--apply`. `--apply` installs the pinned baseline **and every later migration** through the checksum runner (the baseline is intentionally historical), and refuses to finish unless the runner then reports 0 pending. `npm run beta:install:rehearse` runs exactly these steps on a throwaway local Postgres and compares the result with the source project object by object; `beta:upgrade:rehearse` additionally requires the baseline to be older than the checkout.
4. `npm run migrate -- --env=production --dry-run` → confirm **0 pending** independently; future migrations apply with `--apply --confirm-target=<ref>`.
5. `node scripts/beta/invite.cjs --env=production --confirm-target=<ref> --mode=invite_only`.
6. Deploy the app with its runtime variables. Use `GET /api/health` for liveness. Use `GET /api/health?ready=1` with `Authorization: Bearer <HEALTHCHECK_SECRET>` to confirm the database and schema are ready, admission is `invite_only`, and the features enabled for this rollout have their config present.
7. Schedule the reminder worker: `POST /api/reminders/run` with `Authorization: Bearer $CRON_SECRET` every 10 minutes.
8. Owner invites reviewers first (`invite.cjs … --role=reviewer`), verifies reviewer access, then opens the cohort. **No external invitation is sent by any script**: `invite.cjs` writes records only.

What the baseline is: `supabase/baseline/schema-snapshot.sql` (public schema, policies, triggers, explicit grants, taken from the development project at migration `20261115`, hash-checked against `baseline-manifest.json`), `reference-data.sql` (topics, exam windows, curriculum structure: 10 topics, 102 readings, 343 outcomes). The ledger is filled with each covered migration's checksum, so the migration runner sees a consistent history and later migrations apply normally. Regenerate with `npm run beta:baseline -- --confirm-target=<dev-ref>` only when migrations are added and the owner decides to re-baseline.

## 4. Deployment and release revision

Build with `npm ci && npm run verify && npm run build`. Dry-run migrations, apply them, deploy the compatible app revision, then check protected readiness. For migrations that narrow grants, coordinate the release with the matching new application writers. In particular, older builds that write notes through the student session are incompatible with `20270127_private_assessment_metadata`. For a rollback, use an app revision compatible with the installed schema. Keep applied migrations and their checksums intact.

## 5. Observability

`/api/health` is public liveness. Monitor the authenticated readiness variant separately. Authentication events record the action and provider outcome without credentials or raw provider messages. Use paper, reminder and account events for operational monitoring and the item-batch records for authoring jobs. Keep sensitive headers, auth request bodies and callback query strings out of host logs.

## 6. Backup and recovery

Use Supabase's automated backups (and Point-in-Time Recovery if the plan includes it) on the beta project. Rehearsed locally (`npm run beta:restore:rehearse`): dump → restore into a separate database → records, schema, privileges and row security identical and working together. Recovery: restore into a **new** project, run `npm run migrate -- --env=production --dry-run` against it (0 pending), run `/api/health`, switch the app's variables, then tell invited students. Deleted accounts must not be resurrected from a backup: after any restore, re-run deletions recorded in `account_deletions` (hashes only; compare `sha256(user id)`).

## 7. Support checklist

* **Assessment unavailable:** read the reason on Tests ("View assessment availability"). It is the bank, not a fault: zero approved held-out questions means no full rehearsal; a thin reading means no paper for it. Do not promote items to fix it. Offer external-mock planning and the no-paper weekly closure.
* **Invitation problems:** `node scripts/beta/invite.cjs … --list`. Expired → re-invite (creates a fresh one). Used by a different identity → `--revoke` then re-invite. Wrong address → invite the address they will sign in with.
* **Account operations:** export is self-service (Settings). Deletion needs the typed email and a sign-in within 10 minutes; if it fails nothing is removed and the student is told. Check `account_deletions` (hash + outcome) when asked to confirm.
* **Item challenges:** the item is set aside from the student's evidence immediately; reviewers resolve in the workspace (`/app/tests/review/challenges`). Tell the student the result of the review, not the key.
* **Reminders:** `reminder_jobs` shows pending / sent / cancelled / uncertain / failed with the reason; an `uncertain` job is never retried automatically.

## 8. Release checklist (owner)

- [ ] Create the distinct beta Supabase project and share its ref; fill `.env.production.local`.
- [ ] **Rotate the database credential** reported earlier as committed in the deleted `scripts/legacy/test-db.cjs` (confirm rotation without showing the secret) **before** the repository is shared or deployed.
- [ ] Set `NEXT_PUBLIC_SUPPORT_EMAIL` to a monitored address (`/api/health` flags it when unset).
- [ ] Review and approve the **Privacy** and **Terms** beta drafts (`src/app/privacy`, `src/app/terms`); confirm provider names, regions and retention wording.
- [ ] Configure SMTP/Resend sender domain; verify real delivery of sign-up, verification and reset emails on authorised test addresses.
- [ ] Decide what bank content is authorised for the beta (default: none; students see the unavailable-assessment states).
- [ ] Confirm approved invitation and landing wording matches actual assessment capability.
- [ ] Open the cohort (owner action; nothing here sends invitations).
