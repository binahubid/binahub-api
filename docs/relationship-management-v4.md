# Relationship Management v4 preparation

## Owner update29October2026

The user confirms27SR/13SJTas the authoritative count and authorizes provisional
module50:50combination while retaining separate methods. API0.44.0 adds an
explicit required-all completion mode for the internal40question trial.
SRmodule total requires all27responses and normalizes their mean1–5to0–100;
SJTmodule total requires all13responses and normalizes private0–3credits to
0–100. Composite is the mean of the two displayed method totals; either absent
method makes it null. No source version/key is overwritten. Module score policy
is separately versioned rm-module-50-50-owner-2026-10-29-v1.

This supersedes only the older module-composite/count-confirmation boundary
below. It does not supply SJTcompetency weights, interpretation bands or public
paid delivery. Competency rows keep SRmeans but do not spread credits across
tags. Source validation remains private; no new SQL is needed after complete75.

CEO sources: `BinaInsights_Laporan_Relationship_Management_v4.docx` and
`BinaInsights_Relationship_Management_Bank_Soal_V4.xlsx`. These are private inputs,
not repository assets. Do not commit question content, option keys or anchors.

## What is implemented

- Nine competencies,27self-report items,13SJT cases, original1–5scale and0–3credits
  imported with source hashes and version4.0.0-draft.1. No new items/keys invented.
- Conditional catalog candidates preserve source Core/Secondary/context wording.
- Only admin-authenticated, rate-limited endpoints can read a question-only DTO or
  request a transient report preview. No attempt table, email or checkout exists.
- Complete3-item self-report means can be displayed0–100. Missing evidence isnull,
  not zero. SJT/composite/interpretation staynull because weights are not approved.
- A30-day action structure follows the supplied report, without inventing findings.

## Installation

Run the importer with the bundled workspace Python and a private output folder:

```powershell
python scripts/prepare-relationship-management.py --source-dir "CEO-source-folder" --output-dir "private/relationship-management-v4"
```

Use the generated `private/relationship-management-v4/SQL75_RM_COMPLETE.private.sql`
in the Supabase SQL editor for the API project. This **complete** file includes
schema and private source in one transaction. The committed migration contains
schema only and will not load the bank. Reapplying the identical complete file
preserves data; different content under the same version is rejected. Keep it
private. No credentials are required for generation and no DB/network call occurs.

The admin page is `/admin/assessments/individual/relationship-management`. With no
SQL75 source, it shows missing installation. Installing SQL75 does not enable sales.

## Remaining CEO decisions and release gates

The report internally says Prototipe Revisi v2 and24self-report items; the bank
has27. The bank is the import authority for the40questions, not a claim of approval.
Confirm the count and provide approved item-to-competency SJT weights, valid-response
minimums, interpretation/priority rules and commercial delivery policies. PE's
temporary50:50display weighting does not transfer to RM. No tag averaging/default
weight is permitted. Program candidates need role/context review, not score alone.

Public access, paid entitlements, payment, results/email delivery and validated RM
interpretation remain disabled/unimplemented until those gates are completed.

## Local evidence

Ten targeted RM/copy tests and29PE/SPINregression tests passed, with source hashes
reconciled against the private import and explicit tests for admin rejection, rate
limits, DTO secrecy, missing-vs-zero and unknown/invalid responses. API build has
125routes. This is bounded local evidence, not a penetration test, live DB proof,
production deployment or psychometric validation.
