# Production closeout evidence — 13 September 2026

This record contains non-secret evidence for the Phase 19 remediation and the
internal observability deployment. Times are Asia/Jakarta unless explicitly UTC.

## Deployment evidence

- API source: `binahubid/binahub-api@ec1122ed933e`
- API deployment provider: Vercel
- GitHub deployment status: `success` (`Deployment has completed`)
- Production verification: `GET https://api.binahub.id/api/health` returned HTTP
  200, version `0.24.0`, revision `ec1122ed933e`, and observability provider
  `supabase` at 21:10 WIB.
- Admin application source pushed to both configured GitHub remotes:
  `app-binahub@d28a088`. Hostinger deployment/cache publication remains managed
  by the site owner and was not yet visible in public assets at final verification.
- Supabase migrations applied over verified TLS: `0045`, `0046`, and `0047`.

## Verification evidence

- API unit/integration gate: 161 passed, 2 skipped; lint passed; production build
  generated 93 routes.
- Admin application gate: 95 passed; lint passed; production build generated 81
  pages.
- Production-domain E2E against the currently published Hostinger build: 43
  passed and 1 intentionally skipped across desktop and mobile projects,
  including authenticated admin navigation and anonymous access boundaries.
- Phase 19 production smoke: all checks passed, including canonical release
  audiences, safe effective modes, and closed pilot/live master switches.
- Full production readiness SQL after incident closure: 389/389 boolean checks
  true; all issue and pending counters zero.
- Internal observability production check:
  - anonymous admin access returned HTTP 401;
  - an authenticated synthetic event was persisted as
    `d6814413-c53f-4086-825c-05d9b9f7ab48`;
  - the event was read back as trusted and synthetic;
  - open non-synthetic error groups at verification time: 0;
  - no outbound action was triggered.

## Pilot incident reconciliation

The 8 September controlled run was stopped and the release remains rolled back.
The overwritten automation-run summary cannot be reconstructed as an immutable
historical row. Surviving `follow_up_events`, provider records, and webhook
evidence were reconciled instead:

- 5 provider attempts were identified;
- 2 reached delivered status;
- 3 reached bounced status;
- runtime controls are back in `dry_run` with no attached release;
- all four environment guards report dry-run;
- pilot and live master switches are false;
- both stopped releases have fresh real monitoring snapshots and fresh `no_go`
  decisions dated 13 September 2026.

Permanent prevention is deployed in the API: idempotency keys are pre-claimed
before side effects, duplicate replays are immutable, pilot audiences are checked
against the exact approved allowlist, and runtime errors are persisted in
Supabase with redaction, grouping, rate limits, access controls, and admin review.

All three incident records were transitioned to `resolved` only after this
deployment evidence was published. A post-transition query returned zero open
pilot incidents.

## Current release decision

This evidence closes the historical defects; it does not authorize a live
workflow. There is no active release. A new restricted pilot needs a new release,
fresh dry-run evidence, a healthy snapshot, rehearsal/acceptance, and a human
go/conditional-go decision before its scheduled change window.
