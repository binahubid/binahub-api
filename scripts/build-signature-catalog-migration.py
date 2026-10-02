"""Build the self-contained public catalog migration from the CEO's DOCX.

Usage: python scripts/build-signature-catalog-migration.py CEO_CATALOG.docx
The input document is read locally. Prices are never included in public_content.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "supabase" / "migrations" / "0059_publish_signature_solutions_details.sql"
TRANSLATIONS = ROOT / "scripts" / "signature-catalog-id.json"


def read_modules(path: Path) -> list[dict]:
    document = Document(path)
    modules: list[dict] = []
    current: dict | None = None

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            text = paragraph.text.strip()
            match = re.match(r"^(SS-\d{2})\s*\|\s*(.+)$", text)
            if match:
                current = {"code": match.group(1), "name": match.group(2), "paragraphs": [], "tables": []}
                modules.append(current)
            elif current and text and (
                len(current["paragraphs"]) == 0
                or paragraph.style.name == "List Bullet"
                or text.startswith(("Best For:", "Service Brand:", "Notes:", "OUTPUT / DELIVERABLES"))
            ):
                current["paragraphs"].append(text)
        elif child.tag == qn("w:tbl") and current:
            table = Table(child, document)
            current["tables"].append([[cell.text for cell in row.cells] for row in table.rows])

    if [module["code"] for module in modules] != [f"SS-{index:02}" for index in range(1, 28)]:
        raise ValueError("Expected exactly SS-01 through SS-27 in the CEO document")

    result: list[dict] = []
    for module in modules:
        paragraphs = module["paragraphs"]
        tables = module["tables"]
        if len(tables) != 2 or len(tables[0]) != 2 or len(tables[1]) != 1:
            raise ValueError(f"Unexpected table structure in {module['code']}")
        if "OUTPUT / DELIVERABLES" not in paragraphs:
            raise ValueError(f"Missing outputs in {module['code']}")
        outputs_start = paragraphs.index("OUTPUT / DELIVERABLES") + 1
        outputs_end = next(i for i, value in enumerate(paragraphs) if value.startswith("Best For:"))
        objectives, content = tables[1][0]
        if not objectives.startswith("TUJUAN PEMBELAJARAN\n") or not content.startswith("OVERVIEW / KONTEN\n"):
            raise ValueError(f"Unexpected objective/content headings in {module['code']}")
        row = tables[0][1]
        fields = {
            "tagline": paragraphs[0],
            "learningObjectives": objectives.splitlines()[1:],
            "contentOutline": content.splitlines()[1:],
            "outputs": paragraphs[outputs_start:outputs_end],
            "bestFor": paragraphs[outputs_end].removeprefix("Best For: "),
            "engagementFormat": row[0],
            "duration": row[1],
            "capacity": row[2],
            "serviceBrand": next(value.removeprefix("Service Brand: ") for value in paragraphs if value.startswith("Service Brand:")),
        }
        notes = [value.removeprefix("Notes: ") for value in paragraphs if value.startswith("Notes:")]
        if notes and module["code"] != "SS-22":
            fields["notes"] = notes[0]
        if not all(fields[key] for key in ("learningObjectives", "contentOutline", "outputs", "bestFor")):
            raise ValueError(f"Incomplete public detail in {module['code']}")
        result.append({"code": module["code"], "name": module["name"], "public_content": fields})
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Pass the CEO catalog DOCX path")
    modules = read_modules(Path(sys.argv[1]))
    translated = json.loads(TRANSLATIONS.read_text(encoding="utf-8"))
    if set(translated) != {module["code"] for module in modules}:
        raise ValueError("Indonesian translation must contain exactly SS-01 through SS-27")
    for module in modules:
        english = module["public_content"]
        indonesian = translated[module["code"]]
        if set(indonesian) != set(english) - {"serviceBrand"}:
            raise ValueError(f"Indonesian fields differ from source for {module['code']}")
        for key in ("learningObjectives", "contentOutline", "outputs"):
            if len(indonesian[key]) != len(english[key]) or not all(indonesian[key]):
                raise ValueError(f"Indonesian {key} does not match source count for {module['code']}")
        for key, value in indonesian.items():
            if isinstance(value, str) and not value.strip():
                raise ValueError(f"Empty Indonesian {key} for {module['code']}")
        module["public_content_id"] = indonesian | {"serviceBrand": english["serviceBrand"]}
    payload = json.dumps(modules, ensure_ascii=False, indent=2)
    sql = f"""-- CEO Signature Solutions Detailed Product & Commercial Catalog 2026.
-- Publish the 27 catalog entries after loading the CEO's complete non-commercial text.
-- Existing base_price, pricing_unit and metadata.commercial are retained for internal proposals.
-- Deploy the updated public API and website before running this migration in production.
begin;

do $validate$
begin
  if (select count(*) from public.catalog_modules
      where module_code ~ '^SS-[0-9]{{2}}$'
        and catalog_version = 'signature-2026-ceo-v1'
        and is_mock = false) <> 27 then
    raise exception 'Expected all 27 Signature Solutions from migration 0057 before publishing';
  end if;
end
$validate$;

with source as (
  select * from jsonb_to_recordset($catalog${payload}$catalog$::jsonb)
    as entry(code text, name text, public_content jsonb, public_content_id jsonb)
)
update public.catalog_modules module
set metadata = coalesce(module.metadata, '{{}}'::jsonb) || jsonb_build_object(
      'localized', coalesce(module.metadata->'localized', '{{}}'::jsonb)
        || jsonb_build_object('en', coalesce(module.metadata->'localized'->'en', '{{}}'::jsonb)
          || jsonb_build_object('name', source.name, 'summary', source.public_content->>'tagline')
          || source.public_content,
          'id', coalesce(module.metadata->'localized'->'id', '{{}}'::jsonb)
          || jsonb_build_object('summary', source.public_content_id->>'tagline')
          || source.public_content_id)
    ),
    standard_scope = array_to_string(
      array(select jsonb_array_elements_text(source.public_content_id->'contentOutline')), E'\\n'
    ),
    deliverables = array_to_string(
      array(select jsonb_array_elements_text(source.public_content_id->'outputs')), E'\\n'
    ),
    duration_label = source.public_content_id->>'duration',
    readiness_status = 'ready',
    active = true,
    public_visible = true,
    published_at = coalesce(module.published_at, now())
from source
where module.module_code = source.code
  and module.catalog_version = 'signature-2026-ceo-v1'
  and module.is_mock = false;

update public.catalog_products product
set status = 'ready',
    public_visible = true,
    published_at = coalesce(product.published_at, now())
where product.product_key in (
  'signature-self', 'signature-team', 'signature-organization', 'signature-specialized'
);

commit;
"""
    OUTPUT.write_text(sql, encoding="utf-8")
    print(f"Wrote {OUTPUT} from {len(modules)} CEO solutions")


if __name__ == "__main__":
    main()
