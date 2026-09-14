# Production closeout evidence — 13 September 2026

This record contains non-secret evidence for the Phase 19 remediation and the
internal observability deployment. Times are Asia/Jakarta unless explicitly UTC.

## Deployment evidence

- API source: `binahubid/binahub-api@40aa6f90e820`
- API deployment provider: Vercel
- GitHub deployment status: `success` (`Deployment has completed`)
- Production verification: `GET https://api.binahub.id/api/health` returned HTTP
  200, version `0.24.0`, revision `40aa6f90e820`, and observability provider
  `supabase`.
- Admin application source pushed to both configured GitHub remotes:
  `app-binahub@d28a088`. After the site owner completed the Hostinger deployment
  and cache flush, an authenticated browser verification confirmed the runtime
  observability panel was present in the production admin workspace.
- Supabase migrations applied over verified TLS: `0045`, `0046`, and `0047`.

## Verification evidence

- API unit/integration gate: 161 passed, 2 skipped; lint passed; production build
  generated 93 routes.
- Admin application gate: 95 passed; lint passed; production build generated 81
  pages.
- Production-domain E2E against the currently published Hostinger build: 43
  passed and 1 intentionally skipped across desktop and mobile projects,
  including authenticated admin navigation and anonymous access boundaries.
- Authenticated Hostinger UI verification passed: admin login succeeded, the
  runtime observability panel rendered, a UI-origin synthetic event persisted
  through the production API, and no uncaught browser page error was observed.
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
workflow. A new non-mock release named `Final Acceptance Pilot - 5 Internal
Accounts` was created with release key
`pilot-final-acceptance-20260914-0800`, an exact five-address allowlist, and a
window of 14 September 2026, 08:00–09:00 WIB. It is approved for rehearsal only.

Three eligible workflow preflights completed successfully in effective
`dry_run`: Transformation Event Worker, Client Operations Daily, and Acquisition
Batch Processor. Follow-up Scheduler evidence must be captured during its Monday
business window. After preparation, Phase 19 production smoke still passed,
production readiness remained 389/389, open non-synthetic runtime errors remained
zero, every runtime control remained effective `dry_run`, and both master switches
remained off.

The restricted pilot still requires fresh Follow-up Scheduler evidence, a healthy
snapshot, rehearsal/acceptance, and a human go/conditional-go decision before any
runtime or environment activation.

## Final acceptance control-plane — 14 September 2026

At 08:00 WIB the remaining Follow-up Scheduler evidence was executed in effective
`dry_run` and returned zero sends. Replaying the same idempotency key returned
`duplicate: true` without a second execution. The final state is:

- 8/8 required rehearsal steps passed with production evidence;
- monitoring snapshot `739aa232-6e79-4118-95da-9992ca1be7ab` is real, fresh,
  `healthy`, and has no blocker;
- acceptance decision is `accepted`;
- Operational Assurance decision is `go`;
- release `pilot-final-acceptance-20260914-0800` is `scheduled` with an exact
  five-address internal allowlist;
- all four runtime controls request `pilot` for that release but remain effective
  `dry_run` because the environment guard and pilot master switch are closed;
- Phase 19 still passes, readiness remains 389/389, open non-synthetic runtime
  errors remain zero, and the pilot incident backlog remains zero.

No outbound was sent during this control-plane completion. The next step is the
separate Vercel environment deployment that opens only the scheduled pilot window.
