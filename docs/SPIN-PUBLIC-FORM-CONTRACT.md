# Public SPIN form contract — standalone CI

The API public validation source `src/lib/spin/form.ts` and the browser source
`app-binahub/src/lib/spin-form.ts` intentionally match. Each repository now pins
the same versioned SHA-256 contract next to its own source. Normalize CRLF to LF
by removing carriage returns; otherwise hash the exact source, including types.

API `intake.test.ts` checks its local source against `form.contract.json` and
rejects server dependencies. App CI runs `node --test tools/spin-form-contract.test.mjs`
against its own `spin-form.contract.json`. Neither check fetches or requires an
adjacent repository. Missing/drifting source fails the test; it is not skipped.

The previous API test directly read `../app-binahub/src/lib/spin-form.ts`. It
passed on the maintainer's multi-repository laptop but failed ENOENT on a clean
GitHub API checkout. Adding a live/private GitHub dependency or skipping this
check in CI would not fix that isolation error properly.

For an intentional contract edit, coordinate both repositories: update both
public sources and both manifests together, verify their normalized source and
manifest equality locally, and run both CI checks. Do not regenerate the hash
automatically inside a test to make drift pass. The independent checks pin the
approved contract; they do not prove both deployed versions match at runtime.

This repair does not modify question/validation behavior, privacy notice,
scoring, scheduler SQL, database, environment or sending. SQL89 is unchanged.

Validation on 4 November: a Git-index source-only API copy contains no sibling
app checkout, production .env or private tests. Dependency modules were reused
locally. With the GitHub exclusions/maxWorkers=2, the complete public rerun passed
1163 tests/151 files (3 tests/1 file skipped); types, lint, matcher contracts and
a production build with synthetic env passed. App's four Node contract checks
passed. This is a Windows local reproduction, not a claim of a green remote run.
An initial full local run had one intermittent loopback provider-fixture failure;
that file passed separately and on the complete rerun. No live provider was used
and no provider-routing change is claimed by this repair.
