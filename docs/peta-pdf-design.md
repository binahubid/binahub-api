# PETA PDF layout - API0.47.1

1 November2026. Owner asks for clearer hierarchy, consistent leading and balanced
spacing, original BinaHub branding, and no “laporan internal admin pendamping”
label in group PDFs. This is a Read refinement; report data and permission policy
remain unchanged. It does not authorize employer distribution or public access.

## Composition and typography

- A4,42pt side margins,38pt top,58pt bottom. Original wordmark116×33pt at the
  same position on each page. Primary title22pt, continuation20pt, section14pt,
  subhead11pt, body10.5pt, table9.5pt, notes8.5pt, footer8pt.
- Use existing local Inter Regular/SemiBold. No remote font or image request.
  Fixed layout uses native font metrics. The installed PDF engine resolves
  styles repeatedly during pagination; explicit lineHeight compounds, even on
  body text. Do not reintroduce it without the layout regression tests.
- Related text is grouped with4/6/8/10/12pt spacing; major sections20pt apart.
  Single-line main titles retain content width for charts/tables on page one.
  Exact data is unchanged; numeric columns are right-aligned.
- Group pattern table has two columns. Its interpretation is explained once
  below, not repeated in every row. Matrix headers repeat after page breaks.
- Individual reflection prompts have real ruled writing space, not underscore
  text. Footers separate privacy label and page count through layout, not spaces.

## Original assets and deployment

`public/brand/binahub-wordmark.png` is a byte-identical copy of the app's existing
`public/full-logo.png`, not the API's similarly named square mark and not a new
generated/reconstructed logo. SHA256:
`b5c2d29be695d4df48669f3295596eeaa4684a53d2e8ddfa309ea4d8c597004a`.
Embed its PNG bytes; a Windows absolute filename passed as an Image URI was
treated as a network URL by this renderer. Missing images must not silently ship.
PETA outputFileTracingIncludes explicitly includes this PNG and the two local
font files so they remain available in the deployed function.

## Wording and unchanged boundaries

Group headings/metadata and footer no longer label the document as an admin-
companion/internal report. Keep “Rahasia | PETA - BinaHub” and the note against
unauthorized distribution. The endpoint still requires verified admin access,
optional participant review consent, submitted status and original retention.
No AI, new score interpretation, SQL, environment variable or frontend change.

## Verification

Synthetic individual and four-member group examples are two pages each. All four
pages were rasterized and inspected after the correction batch. Layout tests
assert original logo bytes on every page, visible numbered footers, no unwanted
group label, stable text leading, repeated matrix headers, presence of all37
long-name synthetic members and row bounds. These checks are not production
verification, psychometric validation or a security certification.

All89 PETA API tests, typecheck and production build pass. The PETA route's built
NFT trace includes the wordmark plus both Inter files. Source lint has no new
findings; the pre-existing unused `ProposalPDF` warning is unrelated and unchanged.
