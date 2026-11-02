# Generated PDF inventory and print standard

2 November 2026 - API0.47.6 / AMS0.11.4 (web0.10.4).

## Inventory verified in source

| Family | Generator and access | Variations |
| --- | --- | --- |
| Organization diagnosis | `generatePDFBuffer` / `assessment-report-enterprise.tsx`; assessment worker and authorized admin assessment export | Indonesian, English |
| Solution proposal | `generateProposalPDFBuffer` / `signature-proposal-report.tsx`; admin preview and protected proposal view | Commercial, preliminary, visibly marked simulation |
| Program recommendation | `renderSpinPDF` / `spin/pdf.tsx`; private result action and report worker | Catalog matches, consultation options, no program yet |
| T-BOS | `tbos-report-document.tsx`; authorized `/api/tbos/export` | Group, batch, team |
| Program questionnaires | `program-questionnaire-report-document.tsx`; admin export | Pre-test, post-test, BinaInsight Program |
| PETA | `peta/pdf.tsx`; admin-only PETA routes | Individual, group with participant review consent |
| AMS associate CV | `binahub-platform/apps/web/src/app/admin/associates/[id]/cv/cv-document.tsx`; existing protected admin page and browser print | Short and multi-page CV |

The app's PDF buttons fetch the API output; they do not have a second PDF engine.
Personal Effectiveness / RM results currently use protected HTML/report delivery,
not a native PDF generator. Their evaluation export is JSON, not PDF. AMS admin
summary exports are CSV/JSON. Uploaded CVs, certificates and portfolio PDFs are
source files, not generated documents: they must not be rewritten. `pdf-parse`
extracts CV text; it is not a PDF generator. No generator was found in the bounded
website-prod source search. This inventory is not a search of private source
document packs, production storage, or unrelated sibling repositories.

Codebase Memory was checked for app export call sites and freshness; API and AMS
were not indexed, so their inventory was verified through bounded source searches.

## Shared print identity

- PETA remains the approved reference and its layout is unchanged.
- A4; 42pt side margins, 38pt top and 58pt bottom; local Inter; original wordmark
  116x33pt. Main titles about22pt, section headings14pt, body10.5pt, table9-9.5pt,
  notes8.5pt, footer8pt. Dense charts have labels appropriate to their space.
- Shared assets/primitives are in `src/lib/pdf-brand.tsx`. Logo SHA256 remains
  `b5c2d29be695d4df48669f3295596eeaa4684a53d2e8ddfa309ea4d8c597004a`.
  Assets are local, embedded without remote requests, and explicitly traced for
  generation routes, including assessment/SPIN workers and admin retries.
- No explicit React PDF `lineHeight`: this engine compounds it on repeated layout.
  Use native font metrics plus margins/padding. Layout tests guard line leading.
- Footer labels and page counts are separate layout elements, not padded spaces.
  Long answers/notes may continue; short cards and table rows remain together.
  T-BOS comparison heatmaps use landscape so English names remain readable.
- The historical organization renderer selector is retired; all generation now
  uses the current organization layout. The old unused proposal renderer is gone.

AMS uses browser print rather than React PDF. Its existing data fetching and
protected photo resolver stay in place. A repeating table header carries the
original logo; native page-margin counters add a confidentiality footer. Use a
current Chrome/Edge, A4 and browser headers/footers disabled to avoid duplicated
URL/date/page labels. A tooltip on the print button gives these instructions.

## Verification and boundaries

`npm run test:pdf` checks actual renderer output, all source text sentinels,
numbered footers, logo presence and stable font metrics. With
`PDF_LAYOUT_QA_DIR=output/pdf/refresh`, ten synthetic variants are written for
raster review, including a short-note page-boundary case. Existing PETA, T-BOS
and proposal/organization preview suites cover
ordinary-size reports. Large T-BOS coverage includes16 teams and long notes.

Representative pages were rasterized with Poppler and reviewed, including every
page of the large synthetic group. Extracted text was also checked against safe
page bounds; this supplements rather than replaces visual inspection. The AMS
short/long CV examples were rendered from its actual component and print CSS,
with no production profile/photo/API requests. `pnpm test:pdf` guards the admin
fetch, original asset, print layout, counters and hidden navigation in CI.

No scoring, AI prompt/model, catalog matching, commercial arithmetic, approval,
retention, consent, permission, database or delivery behavior changes. PETA PDF
export remains admin-only. No real participant data, email, worker run, production
migration, or paid AI call was used. No SQL/env is required. Scheduler remains
paused for the separately planned Vercel migration.

Previously frozen/sent PDFs keep their original bytes and design. This release
changes newly generated output; it does not rewrite audit-history attachments.
Local render/build success is not verification of the deployed production site.
