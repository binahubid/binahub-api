# PETA pilot activation

31 October 2026. API0.46.3 / app0.50.1 add retained history and manual status (SQL78).
The earlier standalone invitation pilot remains available for legacy records.
Do not advertise psychometric validation, automatic employer access, selection
decisions or a paid product. No production SQL or real invitations are executed
by the preparation/test scripts.

## Apply in this order

### Current increment: shared admin access (SQL79)

For an installation already running SQL78, apply only
`supabase/migrations/0079_peta_admin_team_access.sql` before deploying the updated
PETA API and frontend. Do not rerun SQL76B, rotate keys, or recreate workspaces.
SQL79 adds service-role-only team RPCs; every HTTP entry still calls requireAdmin
and uses the authenticated actor, never a caller-provided owner ID. All verified
admins can see the same active/history progress and manage setup/invitations.
Consented, submitted and unexpired reports are reviewable by any admin; declined
consent is still denied. Existing creator/reviewer snapshots are preserved, and
audit records identify the actual admin performing each action. Facilitators,
participants and anonymous browser roles receive no new access. No environment
variable, participant backfill, source reinstall or retention change is required.

Situation14 also has an owner-approved display correction: “antartim” → “antar
tim”. The validated public DTO corrects the text without altering the immutable
encrypted source/fingerprint, IDs or scoring. This applies on both new and resumed
sessions after the API update.

The SQL78 release instructions below are historical; its creator-only RPCs remain
for compatibility, but the updated admin HTTP routes use the new `peta_team_*` RPCs.

### Previous increment (SQL78)

For an existing SQL77 installation, apply only
`supabase/migrations/0078_peta_history_program_status.sql`, then deploy API0.46.3
and app0.50.1. No new env, source installation, consent or retention change.
Owner reported SQL78 succeeded on31 October2026; verify production deployment
separately. Existing statuses remain automatic until an explicit manual edit.
The new dashboard RPC is service-role-only and keeps owner/result permission checks.
History remains accessible after a program ends, within the original one-year
retention; active participant entry keeps its original date/membership gates.
Program deletion is refused when PETA workspaces exist; archive instead.

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
4. Run **SQL77**, `supabase/migrations/0077_peta_program_module.sql`, before
   deploying **API0.46.0**, then **app0.49.0**. Existing SQL76/76B need not be
   rerun. SQL77 adds bindings, service-only functions and the PETA module key;
   it enables no program, relinks no old record and deletes no operational data.
   No new environment variable is needed: keep the original matching encryption
   key and existing cron secret. Retain the app's same-origin `/api/:path*` rewrite.
   Production requests are restricted to `https://app.binahub.id` by default.
   A separately approved staging app may use API-only `PETA_APP_ORIGIN` with its
   exact HTTPS origin. Verify cookies through that real app origin, not directly
   through the API origin.
5. Set `CRON_SECRET` (a separately generated random secret of at least32characters)
   in the API project's **Production** environment, then deploy the API. If an
   approved secret already exists and meets that minimum, keep it; do not rotate
   a shared scheduler secret casually. Never use `PETA_ENCRYPTION_KEY` for cron.
   To generate a separate new secret offline, run `node scripts/prepare-peta-cron-secret.mjs`.
   Copy only the value after `CRON_SECRET=` from ignored
   `private/peta-v1/CRON_RUNTIME.private.env` into the API Production variable.
   The generator never prints the secret, reads other credentials or overwrites
   an existing generated file. Do not commit the output or reuse the encryption key.
   The committed `vercel.json` registers the monthly PETA worker automatically on
   the production deployment, provided project Cron Jobs are enabled. See below
   to verify its first invocation; a Git push alone is not proof it has run.
6. Admin creates/selects a program and enables its PETA module, then opens
   `/admin/peta?program_id=<program UUID>`. `sourceReady` requires source decryption,
   integrity checks and the pinned source/version. A missing source/key keeps
   new participation disabled. Record the approved internal privacy reference,
   content-rights confirmation and pilot acceptance. The workspace is derived
   from that existing program, not a second activity. Share its existing QR/link/
   program code. Participants register with their name or return with their
   personal participant code, then open the module at `/client/program/peta`.
   Program QR is only entry; it never grants access to another person's report.
7. Before inviting real participants, complete the checklist below.

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
the worker runs. Program sessions also require live membership, active personal
access, enabled/configured PETA and the program's existing status/date gates.
One-year retention does not override those access gates. Legacy initial unused
invitations expire after seven days. Session
credentials expire after eight hours or 30 minutes idle. Verified recovery
grants expire after 30 minutes and replace old credentials on redemption.
Program participants resume using their personal program access, which replaces
PETA credentials but never restarts retention or changes consent/final answers.

API 0.45.2 follows the owner's monthly schedule in `vercel.json`:
`0 0 1 * *` (first day of each month, 00:00 UTC / 07:00 WIB),
path `/api/cron/peta-retention`.
Vercel invokes **GET** and supplies `Authorization: Bearer <CRON_SECRET>` from
the Production environment. **POST** remains available for authenticated operator
retries. HEAD is explicitly rejected, and User-Agent/query strings are never
authentication. Responses are no-store. No extra scheduler service is needed.
The supplied schedule does not alter existing email, SPIN or follow-up workers.

Each invocation processes at most10batches of100expired PETA sessions. It stops
at the first partial batch, or between batches after a20second soft budget; the
function itself has a60second maximum. `mayHaveMore:true` conservatively signals
the last batch was full when the run stopped, not an exact remaining count. Use
an authenticated manual invocation to drain backlog, or let a later monthly run
continue. Successful batches are committed; failure returns a non-2xx status and
the known committed counts, so retries do not recreate or re-delete those sessions.
SQL row locks with SKIP LOCKED protect deletion when invocations overlap.
Only PETA's existing service-only purge RPC is called. No encryption-key access,
AI call, email sending or unrelated-table cleanup is added.

### Verify activation and monitor

1. Deploy API 0.45.2+ after SQL76 and the Production secret are installed. In the
   API project's **Settings → Cron Jobs**, confirm the PETA path/schedule appears
   and Cron Jobs are enabled. Preview deployments do not activate this schedule.
2. Use **Run** on that job for an authorized controlled check, or wait for its
   first scheduled invocation. This performs real expiration cleanup; test the
   production-equivalent setup with synthetic records before real participants.
3. Open **View Logs**. A completed response contains `success`, `erased`, `batches`,
   `mayHaveMore` and elapsed time. Logs contain counts only, not participant IDs,
   tokens, answer contents or source keys. A zero deletion count is normal when
   no session has reached one year.
4. Investigate401(secret missing/wrong/too short),503(SQL/setup/database error),
   504(function timeout), missing executions and backlog warnings. Vercel does
   not automatically retry failed cron invocations; use an authenticated operator
   retry after fixing the cause. The next monthly run also resumes eligible data.
5. Monitor logs and configure an approved platform alert for failures/missed runs
   according to operations policy; this release does not install notifications.

On Hobby, invocation may occur anywhere in the scheduled hour (07:00–07:59 WIB);
other plans schedule within the specified minute. Access still expires at the
database timestamp, not at cron time. With the owner-approved monthly schedule,
physical deletion can normally follow up to 31 days after that timestamp; a
failure/backlog can delay it further. This does not extend participant access
or the one-year session retention timestamp. Backups remain separate.
An authorized DB worker may alternatively call `peta_purge_expired(100)` directly;
never grant that RPC to anon/authenticated users.

References: [Vercel Cron](https://vercel.com/docs/cron-jobs),
[secrets, logs, timing and error handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

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
- New program start takes no caller-supplied owner/program/participant identity:
  the verified existing access supplies them. Each program-bound PETA request
  checks a fresh bearer against the cookie's program/participant/access scope;
  writes additionally require CSRF and revision. Disabled membership/module,
  revoked personal access or expired program/session is denied.
- The public participant screen leads with instructions and a plain disclaimer;
  an expandable disclosure explains data use and one-year retention. Internal
  policy references/consent version IDs are not rendered, but remain recorded.
- Legacy invitation URLs carry a 256-bit random token in the fragment. The app removes
  it from the address bar before further navigation. DB stores only its hash.
  Tokens are private bearer capabilities: send individually via an agreed channel.
- Legacy recovery and erasure require an explicit admin verification acknowledgement.
  The admin must actually verify identity out of band; a participant code alone
  is not verification. There is no automatic recovery email in this release.
- Program recovery uses existing participant-code management, not legacy PETA
  recovery grants. Restrictive SQL77 foreign keys intentionally do not silently
  cascade private records when a program, participant or access row is deleted.
  Any such deletion needs a reviewed data-handling sequence. Existing standalone
  PETA data is retained without guessed automatic program linkage.
- Next/Back navigate immediately. Serial background saves preserve revision and
  latest edits; retry reconciles a lost acknowledgement and does not blindly
  overwrite another tab. Final submit waits for confirmed saves. No unsaved
  answers are stored in localStorage; closing before acknowledgement can lose them.
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
