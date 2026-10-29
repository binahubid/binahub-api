# PETA pilot activation

29 October 2026. This release implements an isolated invitation-only PETA pilot.
Do not advertise psychometric validation, automatic employer access, selection
decisions or a paid product. No production SQL or real invitations are executed
by the preparation/test scripts.

## Apply in this order

1. Back up/review the target project. Run
   `supabase/migrations/0076_peta_invitation_pilot.sql` in the intended Supabase
   project's SQL editor as its migration owner. SQL 75 is RM and is unrelated.
   SQL 76 creates only `peta_*` objects; it does not alter PE/RM/SPIN/TBOS data.
2. Run the locally prepared `private/peta-v1/SQL76B_PETA_SOURCE.private.sql`
   against the same project. It contains the public statements and an encrypted
   scoring envelope, not the plaintext mapping or its decryption key.
3. Privately set `PETA_ENCRYPTION_KEY` on API hosting to the exact value from
   `private/peta-v1/PETA_RUNTIME.private.env`. It is a separate randomly generated
   32-byte hex key, not an AI key or Supabase credential. Never put it in
   `NEXT_PUBLIC_*`, GitHub, chat, logs or the frontend. Keep an access-controlled
   backup; losing the matching key prevents source use. Do not rotate it by
   rerunning preparation or replacing the immutable row silently.
4. Deploy API and app, retaining the app's same-origin `/api/:path*` rewrite.
   Production requests are restricted to `https://app.binahub.id` by default.
   A separately approved staging app may use API-only `PETA_APP_ORIGIN` with its
   exact HTTPS origin. Verify cookies through that real app origin, not directly
   through the API origin.
5. Admin opens `/admin/peta`. `sourceReady` requires successful source decryption,
   integrity checks and the pinned source/version. A missing source/key keeps
   new invitations disabled. Creating a workspace separately requires a written
   approved privacy reference, content-rights confirmation and pilot acceptance.
6. Before inviting real participants, complete the checklist below.

## Preparing private source again on a new secured workstation

Run `node scripts/prepare-peta.mjs <absolute CEO pack directory>` from this repo.
The script verifies the supplied SHA256 manifest, public hash, 24 blocks, 96
statements, option mappings, 24 permutations and positional balance. It runs
offline and does not read project `.env` files or existing provider secrets.
It refuses to overwrite an existing SQL/key file; preserve the original pair.
The `private/` output, private tests and CEO sources are ignored by Git.

Never publish the CEO pack, plaintext key map, generated private SQL, runtime
key, personal responses or real invitation links to a public repository.

## Retention worker (required for physical deletion)

The owner approved **one calendar year from initial consent/session creation**.
The database sets `retention_until` at creation; recovery never extends it.
Every participant/result/consultant read denies expired sessions even before
the worker runs. Initial unused invitations expire after seven days. Session
credentials expire after eight hours or 30 minutes idle. Verified recovery
grants expire after 30 minutes and replace old credentials on redemption.

Configure an authorized scheduler to send a **POST** to
`https://api.binahub.id/api/cron/peta-retention` with
`Authorization: Bearer <CRON_SECRET>`. Use the server's approved secret of at
least 32 characters and never include it in a URL. No scheduler or secret is
installed automatically. Each call deletes up to 100 expired PETA sessions;
schedule at least daily and repeat bounded calls when a batch returns 100.
Also monitor failures. An authorized DB worker can instead call the service-only
`peta_purge_expired(100)` RPC. Do not expose it to anon/authenticated users.

Deletion cascades through this PETA session's answers/results/credentials and
recovery grants. Audit logs retain event metadata without answer contents or
tokens, then expire after one year. Unused stale invitation rows are also
purged after their housekeeping period. Session erasure does not erase the
workspace. Backups/logs need an independently enforced retention/restore policy.

## Authorization and daily operation

- Admin authentication uses the existing `requireAdmin` verifier; the API, not
  the caller body, supplies the actor UUID. All workspace access checks are
  enforced inside service-only SQL RPCs. Each admin sees only owned workspaces.
- Current reviewing consultant is the workspace owner's account, if assigned
  during setup, and is snapshotted when the participant consents. Results are
  available only with separate participant permission. There is no super-admin
  bypass, company dashboard or group export in this release.
- Invitation URLs carry a 256-bit random token in the fragment. The app removes
  it from the address bar before further navigation. DB stores only its hash.
  Tokens are private bearer capabilities: send individually via an agreed channel.
- Recovery and erasure require an explicit admin verification acknowledgement.
  The admin must actually verify identity out of band; a participant code alone
  is not verification. There is no automatic recovery email in this release.
- Final submission uses row locking, a revision precondition and idempotency
  hash. All 24 distinct pairs are required. Submitted choices/results and source
  content cannot be silently updated. Corrections require a documented new run.
- No PETA prompt, answer, key or result is sent to an AI provider. No AI credits,
  email automation, payment, catalogs, rankings or PE/RM scoring are involved.
- Admin sees instrument/consent version, consent timestamp, review permission,
  progress and a bounded owner-scoped audit history. It never receives plaintext
  mappings, raw tokens, answer contents in audit events or private quality flags.

## Pre-live checklist and verification limits

- Confirm content provenance/license, approved notice, controller/processor
  responsibilities, hosting/backup policy and actual intended pilot population.
- Verify production table RLS/revokes and helper-function grants; no direct
  anon/authenticated source, answer or report read should work.
- Verify real cross-origin rewrite cookie path `/api/peta`, HttpOnly/Secure/
  SameSite=Strict, CSRF, no-store/no-referrer headers and origin allowlist.
- Test two independent admin identities, uninvited/expired links, consultant
  consent denied, recovery replay, lost response/idempotent resubmission,
  multi-tab stale writes, session expiration and retention deletion.
- Schedule/monitor the worker, test a synthetic expiring session and backup policy.
- Run an explicitly scoped production-equivalent security review before real use.

Local tests exercise the real migration/RPCs in PGlite, encrypted source
tampering, access boundaries and route validation. An ignored offline test
compares SQL results to all three CEO golden vectors. Browser tests are synthetic
and mock API transport; they do not prove production integration or deployment.
Private quality flags remain stored for later properly authorized research review;
no participant invalidation is inferred. PDF/group reporting and validated public
release are separate future decisions, not implied by a successful build.
