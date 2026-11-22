# PrepPlan security and authentication setup

The application code and the Supabase development project have the new controls. Use this checklist to connect the public app, mail and Google accounts. The project `asylsxszdhlnzewhwtga` is disposable development, even when a local script calls it staging. Use a separate Supabase project before enrolling real students.

The examples use `https://app.YOUR_DOMAIN`. Substitute the real origin everywhere. Local development uses `http://localhost:3000`. Keep the hostname consistent because browser sessions are scoped to it.

## 1. Secure the owner accounts and credentials

- Rotate the database password before pushing or sharing the repository. An earlier commit contains a credential-like database URL in `scripts/legacy/test-db.cjs`, even though the file is absent from the current tree. Update only the affected private connection settings after rotation and check that a migration dry run can connect. Review any collaborators or backups that may already have had access. [Supabase development project](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga) · [Supabase database connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
- Enable MFA for the people who administer Supabase, Google Cloud, the hosting account, Resend and the DNS registrar. Use named accounts, grant reviewer access only to the people who need it, and check Security Advisor on the actual project before opening the beta. The in-app reviewer role currently checks authentication and the database role. The app has no reviewer TOTP enrollment or AAL2 requirement. [Supabase production security checklist](https://supabase.com/docs/guides/security/production-checklist)
- Add secrets through the relevant dashboard or a private local environment file. Keep production, development and testing keys separate. If you open a GitHub repository, enable the secret-scanning and push-protection options available to that repository. [GitHub secret scanning](https://docs.github.com/en/code-security/secret-scanning)

## 2. Set up the site and Supabase Auth

1. Connect the app hostname at your host and DNS provider and check that HTTPS works on the canonical hostname. Set `NEXT_PUBLIC_SITE_URL` to that exact HTTPS origin in the host's build and runtime environments. If using Vercel, add and verify it under the project's Domains settings. [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain) · [Vercel environment variables](https://vercel.com/docs/environment-variables)
2. Install PrepPlan's schema on the separate Supabase project or apply the pending migrations through the checksum runner before using this build. Both `20270126_auth_security` and `20270127_private_assessment_metadata` are already applied on development. The newer notes writer is required after the second migration because it removes direct student writes. Coordinate that migration with the app release if a host already serves an older build.
3. In Supabase **Authentication → URL Configuration**, set **Site URL** to the same origin. Keep allowed redirects on explicit hosts and paths. Add `https://app.YOUR_DOMAIN/auth/callback` for Google and `https://app.YOUR_DOMAIN/auth/verify` for email. The app sends a fragment on the recovery redirect. On the canonical Site URL host, Supabase accepts that same host. For separate local or preview use, set that project's Site URL to the exact test origin and use its own templates and keys. Avoid a production wildcard over previews. Remove any old callback allowlist entries you no longer use. [URL Configuration](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/auth/url-configuration) · [Supabase redirect URL rules](https://supabase.com/docs/guides/auth/redirect-urls)
4. Keep the email provider and email confirmation enabled. Align the provider's minimum password length to 12 characters, turn on leaked-password protection if the project plan supports it, and disable Auth methods you do not offer. Review rate limits for mail, verification and token exchange. A 30-minute JWT lifetime is a reasonable initial setting. Test an uninterrupted 90-minute paper and continued use after refresh before choosing a shorter lifetime. An issued JWT can remain valid until expiration even after refresh is revoked. Account deletion and password recovery also check the underlying session record. [Providers](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/auth/providers) · [Rate Limits](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/auth/rate-limits) · [Password security](https://supabase.com/docs/guides/auth/password-security) · [User sessions](https://supabase.com/docs/guides/auth/sessions)
5. Keep the private beta admission mode and invitations under owner control. Check that a verified invited user completes setup before entering Calendar or Tests. The account and data controls are available to signed-in users before they finish setup.

## 3. Connect account emails

1. In Resend, add the sending domain or subdomain. Publish the DNS records it provides and wait for verification. Choose a sender on that verified domain and a separate monitored support address if needed. Disable click tracking on the authentication sending domain so the links are delivered intact. [Resend domains](https://resend.com/domains) · [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
2. Create a sending-only Resend API key for the authentication domain. In **Supabase → Authentication → Emails → SMTP settings**, enable custom SMTP. Enter host `smtp.resend.com`, port `465`, username `resend`, the new key as the SMTP password, and your verified sender. Supabase sends the verification and reset mail. PrepPlan's optional reminder worker uses its own Resend key and sender. [Resend API keys](https://resend.com/api-keys) · [Resend SMTP settings](https://resend.com/changelog/smtp-service) · [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
3. In **Authentication → Emails → Templates**, edit the two email links below. Keep the link markup and variables intact. PrepPlan’s beta invitation record is separate from the Supabase “Invite User” mail template. The app does not send magic-link mail as a sign-in option. [Email templates](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/auth/templates)

**Confirm sign up**

```html
<h2>Verify your PrepPlan email</h2>
<p>Open PrepPlan and select Continue to verify your email.</p>
<p><a href="{{ .SiteURL }}/auth/verify#type=signup&amp;token_hash={{ .TokenHash }}">Verify email</a></p>
```

**Reset password**

```html
<h2>Reset your PrepPlan password</h2>
<p>Open PrepPlan and select Continue to choose a new password. If you did not ask for this, you can ignore this email.</p>
<p><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}">Reset password</a></p>
```

PrepPlan supplies the signed recovery intent in `RedirectTo`. Keep that variable for reset mail. The email link opens a confirmation screen and uses the token only when clicked there. Once verified, the chosen browser has ten minutes to set a new password. Request a fresh reset email when changing over from the older reset link format.

## 4. Turn on the bot check

1. Create a Managed Turnstile widget with your precise app hostname. Use a different widget for any development environment you want to test. [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) · [Configure Turnstile](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)
2. Put the widget **site key** in the app host as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and rebuild. In Supabase **Authentication → Attack Protection**, enable CAPTCHA, choose Turnstile and paste the widget **secret** there. Enable the app and provider sides together before public signups. Hosted Supabase validates the proof for its endpoints. [Supabase CAPTCHA setup](https://supabase.com/docs/guides/auth/auth-captcha)
3. Open the published sign-in, signup, resend and reset forms. Verify that a legitimate challenge works, an expired one asks for a fresh challenge, and the email paths still work. On hosts other than Vercel, use a trusted ingress limit per client address too. PrepPlan uses Vercel's trusted forwarded address only on Vercel and has a shared ceiling elsewhere. Supabase's separate rate limits still apply. [Vercel request headers](https://vercel.com/docs/headers/request-headers) · [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits)

## 5. Connect Google if you want it in the beta

1. In a dedicated PrepPlan project, configure Google Auth Platform Branding, Audience and Clients. Use External with named testers for the private beta. Enter the live homepage and privacy and terms URLs where required. The only requested scopes are `openid email profile`. [Google Auth Platform](https://console.cloud.google.com/auth/overview) · [Google setup guide](https://support.google.com/cloud/answer/15544987)
2. Create a **Web application** client. For the disposable development project, Google's authorized redirect URI is exactly `https://asylsxszdhlnzewhwtga.supabase.co/auth/v1/callback`. For production, copy that project's callback from its Supabase Google provider. The Google callback ends at Supabase. Supabase then redirects to PrepPlan's `/auth/callback`. [Google OAuth clients](https://console.cloud.google.com/auth/clients) · [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google)
3. Put the Google Client ID and Client Secret in the **Google** provider in Supabase. Keep verification checks enabled. Turn on the PrepPlan button with `NEXT_PUBLIC_GOOGLE_SIGN_IN=1` and rebuild. Keep it at `0` until the provider is ready. [Supabase providers](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/auth/providers)
4. Test cancel and retry, an invited new Google user, and an existing verified email user with the same address. The latter should open the same PrepPlan account and regain its study history. [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

### Google accounts and passwords

A first Google sign-in has no password, so PrepPlan sends that person to `/set-password` before onboarding and before every `/app` page. They choose a password once (12 or more characters), and from then on the same email works with Google or with the password. An account that already has a password cannot change it there; it uses the reset email.

## 6. Put the right values in the right place

| Value | Where it goes |
|---|---|
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL` | App host and matching local environment. Use the canonical origin and a monitored support address. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App host and matching local environment. Use the project URL and public client key from that project. |
| `SUPABASE_SERVICE_ROLE_KEY` | App host server environment only. Use the key for the same project. |
| `APP_SECURITY_SECRET` | App host server environment. Generate a distinct random 32-byte hex value, for example with `openssl rand -hex 32`. It is optional while using the existing server credential as a fallback. Rotation invalidates outstanding recovery links. |
| `NEXT_PUBLIC_GOOGLE_SIGN_IN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | App host before build, when enabling those features. Set up the corresponding provider before sending users through. |
| Google client credentials, Turnstile secret, Auth SMTP settings | Supabase Authentication dashboard only. |
| `MIGRATION_DATABASE_URL` or the environment-specific migration connection settings | Private migration environment only. The running app does not use this connection. |
| `HEALTHCHECK_SECRET` | App host server environment and the monitoring service. Choose a distinct random secret if using protected readiness. |
| `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | App host server environment if enabling reminders. The scheduler gets the cron credential only. Use a separate sending credential from Auth SMTP. |
| `RELEASE_REVISION`, `EXPECTED_SCHEMA_VERSION` | App server environment if enabling release reporting and schema readiness. Use the inspected build and migration versions. |

Find project values under the project's [API Keys](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga/settings/api-keys) and the connection dialog offered by your [Supabase project](https://supabase.com/dashboard/project/asylsxszdhlnzewhwtga). Use the intended project's dashboard when connecting production.

## 7. Set up monitoring and verify the release

- Public `GET /api/health` checks that PrepPlan is reachable without calling Supabase. For database and schema readiness, call `GET /api/health?ready=1` with `Authorization: Bearer <HEALTHCHECK_SECRET>`. Keep credential headers, OAuth codes, request bodies and older token-bearing query strings out of host logs. Reduce or redact auth route URLs at the host when it supports it.
- If enabling reminders, use a scheduler that can send `POST /api/reminders/run` with `Authorization: Bearer <CRON_SECRET>`. Keep the scheduler off until the environment is ready to send the notifications students have requested.
- Run a walkthrough on a test account and actual browser. Sign up, get the email, view it before confirming, then confirm and complete onboarding. Sign out from one of two browsers. Test password reset in the other browser, check that the old password is refused, and confirm the user can sign back into their own week. Verify Google and Turnstile when enabled. Download the student's own data and delete only the disposable account. Check that server logs contain no credentials from the walkthrough. Existing session cookies from an older build get the new flags on refresh or the next sign-in. A fresh sign-in is the simplest way to check the rollout on an existing browser.
- Confirm completed app routes still require verification, admission and setup. Confirm a new student cannot see someone else's work or paper, and can update their own note while signed in. Test on phone width and desktop.

### Rate limits in PrepPlan

| Operation | Budget |
|---|---|
| Password and Google starts | 25 per trusted IP per 5 min, or 480 per 5 min shared when no trusted client IP is available |
| Signup, resend and reset email requests | 25 per trusted IP per 10 min or 120 per 10 min shared, plus 6 per address per hour |
| Email-link verification | 50 per trusted IP per 5 min or 300 per 5 min shared |
| Setup recovery | 25 per student per 5 min |
| Paper preflight and starts | 90 preflights and 40 starts per student per 5 min. Rehearsals use the start budget. |
| Data export and deletion | 12 exports per student per 10 min and 8 confirmed deletion requests per student per 15 min |

These are app budgets. Supabase has separate provider controls for direct Auth calls and may throttle earlier. The database stores keyed hashes of the identifiers rather than raw email addresses or IPs. The account-email limits keep the outward response neutral. Coach and note-to-card drafting keep their existing independent quotas. Answer saves and progress heartbeats are outside the new paper-start budget.

## Local verification commands

- `npm run verify` and `npm run auth:security:db:test`
- `npm run e2e:auth` against localhost and the confirmed disposable development project
- `E2E_BASE_URL=http://localhost:3196 npx playwright test -c playwright.lifecycle.config.ts auth-security --trace off` against a locally served production build
- `npm run migrate -- --env=staging --dry-run` and `npm run beta:upgrade:rehearse`

The auth tests use one-time links generated for synthetic accounts. They do not deliver mail. The production connection checks in this guide are separate and require real project, sender, OAuth and bot-protection settings.

## Development verification record

Codex Security scan `4d33b36d-ff66-4fde-bdf1-6d2abdfde25b` recorded six source findings on the earlier snapshot. The review covered first-party account, authentication, access, diagnostic entry and operational route boundaries. During verification I also closed the public assessment metadata grants and updated the packages flagged by the dependency audit. The review did not assess any provider console or certify every unrelated app route.

| Check | Evidence |
|---|---|
| Production compile and project verification | Next.js 16.4.5 build and `npm run verify` passed. The installed production dependency audit reported zero known vulnerabilities. |
| Browser | Desktop and 390px passed the protected entry, explicit email verification, password recovery in a separate browser context, password sign-in and device sign-out journey on a local production build. The browser checked the script policy, private cache header and session cookie flags. |
| Authentication and ownership | 29 auth checks, 91 onboarding checks, 51 access-matrix checks and 38 notes/flashcards checks passed with disposable accounts. |
| PostgreSQL | 20 isolated security checks passed. The live command grants were inspected. The install/upgrade rehearsal matched the development schema at 145 migrations, and the restore rehearsal passed 32 checks. |
| Assessment integration | 10 actual-bank shortage checks passed with fixture items excluded. A separate fixture-enabled development run passed 49 checks through paper reservation, scoring, repair, re-check and challenge. |
| Operations | Public liveness, refused readiness/reminder requests and an authenticated readiness check against the development schema passed. |
| Provider boundaries | Google start generated PKCE with the expected callback and HttpOnly temporary cookies. Live Google consent, inbox delivery, the real Turnstile challenge, and deployed HTTPS still need the steps above. |

The production security headers use a per-request script nonce. PrepPlan therefore renders pages per request under this policy. Keep the auth and private app responses out of any shared cache. The rollout also retires the old diagnostic start command. The supported app path is Tests preflight and start.
