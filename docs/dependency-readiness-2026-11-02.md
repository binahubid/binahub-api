# Dependency readiness - API0.47.3

2 November2026. Completes the API remainder of readiness item R01. This is a
dependency patch and local regression record, not a live deployment or pentest.

- Before:16 moderate development advisories, all propagated from minimatch
  below11.0.1. Runtime audit already had0 advisories.
- After:full and runtime npm audits both report0. The official advisory is
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
- Pin the official registry matcher11.0.1; preserve ESLint9/Next16.4.3 and
  their rules. Only the lint process uses a callable compatibility facade.
  Its makeRe consumers use the patched engine's matcher, not the old regex
  compiler. No dependency files or lifecycle hooks are modified.
- Three Node contracts verify all locked matcher versions, consumer resolution,
  and actual valid/invalid glob-dependent lint rules.859 synthetic Vitest tests
  pass; two existing visual checks are skipped. Live/private tests are excluded.
- Lint/typecheck/build pass. The existing unused ProposalPDF warning is unchanged.
  CI audits development dependencies too, not just production packages.

No production SQL, emails, AI requests, retention cleanup, scheduler activation
or customer data is involved. AMS is a separate pnpm workspace and release;
app/website matcher patches were completed previously.0 npm advisories does not
establish exploitability or the absence of other security issues. Strix was not
run against production, and no new Strix verification is claimed here.
