import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "@/data/competency-catalog-2026.json";

const migration = readFileSync("supabase/migrations/0063_competency_dictionary.sql", "utf8");
const db = new PGlite();
const setup = async (database: PGlite, missingLast = false) => {
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(), module_code text unique,
      is_mock boolean default false, catalog_version text default 'signature-2026-ceo-v1',
      base_price numeric default 25000000, metadata jsonb default '{"preserve":true}');`);
  for (const solution of manifest.solutions.slice(0, missingLast ? -1 : undefined)) {
    await database.query("insert into catalog_modules(module_code) values($1)", [solution.moduleCode]);
  }
};
beforeAll(async () => { await setup(db); await db.exec(migration); }, 30_000);
afterAll(async () => { await db.close(); });

describe("CEO competency source manifest", () => {
  it("contains all 26 names and 27 solutions without invented scoring or indicators", () => {
    expect(new Set(manifest.competencies.map(c => c.code)).size).toBe(26);
    expect(new Set(manifest.competencies.map(c => c.name)).size).toBe(26);
    expect(manifest.solutions.map(s => s.moduleCode)).toEqual(Array.from({ length: 27 }, (_, i) => `SS-${String(i + 1).padStart(2, "0")}`));
    expect(manifest.measurementStatus).toBe("awaiting_ceo_kpi_and_questions");
    expect(JSON.stringify(manifest)).not.toMatch(/"weight"|"score"|"behavioralIndicators"/);
    const codes = new Set(manifest.competencies.map(c => c.code));
    for (const solution of manifest.solutions) {
      expect(solution.core).toHaveLength(3);
      const all = [...solution.core, ...solution.secondary];
      expect(new Set(all).size).toBe(all.length);
      expect(all.every(code => codes.has(code))).toBe(true);
    }
  });
  it("keeps the SQL seed identical to the reviewed source manifest", () => {
    const seed = migration.split("$competency_catalog$")[1];
    expect(JSON.parse(seed)).toEqual(manifest);
    expect(manifest.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("competency foundation migration", () => {
  it("seeds exact relationships and leaves definitions pending CEO", async () => {
    const rows = (await db.query<{ code: string; name: string }>("select code,name from competency_dictionary order by code")).rows;
    expect(rows).toEqual(manifest.competencies);
    const links = (await db.query<{ module_code: string; competency_code: string; role: string; display_order: number }>(`
      select m.module_code,c.competency_code,c.role,c.display_order
      from catalog_module_competencies c join catalog_modules m on m.id=c.module_id
      order by m.module_code,c.role,c.display_order`)).rows;
    expect(links).toHaveLength(189);
    for (const solution of manifest.solutions) for (const role of ["core", "secondary"] as const) {
      expect(links.filter(l => l.module_code === solution.moduleCode && l.role === role).map(l => l.competency_code)).toEqual(solution[role]);
    }
    expect((await db.query("select * from competency_dictionary where definition is not null or behavioral_indicators <> '[]'::jsonb or content_status <> 'awaiting_ceo'")).rows).toHaveLength(0);
    expect((await db.query("select * from catalog_modules where base_price<>25000000 or metadata<>'{\"preserve\":true}'::jsonb or catalog_version<>'signature-2026-ceo-v1'")).rows).toHaveLength(0);
  });
  it("denies browser roles all dictionary access and enables RLS", async () => {
    for (const table of ["competency_frameworks", "competency_dictionary", "catalog_module_competencies"]) {
      for (const role of ["anon", "authenticated"]) {
        expect((await db.query(`select has_table_privilege('${role}','${table}','select,insert,update,delete') as allowed`)).rows).toEqual([{ allowed: false }]);
      }
      expect((await db.query("select relrowsecurity from pg_class where relname=$1", [table])).rows).toEqual([{ relrowsecurity: true }]);
      expect((await db.query(`select has_table_privilege('service_role','${table}','select') as allowed`)).rows).toEqual([{ allowed: true }]);
    }
  });
  it("prevents duplicate roles, orphans, and unsupported content approval", async () => {
    await expect(db.exec("update competency_dictionary set content_status='approved' where code='COMP-001'")).rejects.toThrow();
    await expect(db.exec("update competency_dictionary set behavioral_indicators='[{}]'::jsonb where code='COMP-001'")).rejects.toThrow();
    await expect(db.exec("update catalog_module_competencies set competency_code='COMP-999' where competency_code='COMP-001'")).rejects.toThrow();
    await expect(db.exec("delete from catalog_modules where module_code='SS-01'")).rejects.toThrow();
  });
  it("is repeatable without overwriting later CEO content", async () => {
    await db.exec("update competency_dictionary set definition='CEO supplied definition',behavioral_indicators='[\"CEO indicator\"]',kpi_source_version='KPI-test',content_status='approved' where code='COMP-001'");
    await db.exec(migration);
    expect((await db.query("select definition,content_status from competency_dictionary where code='COMP-001'")).rows)
      .toEqual([{ definition: "CEO supplied definition", content_status: "approved" }]);
    expect((await db.query("select * from catalog_module_competencies")).rows).toHaveLength(189);
  });
  it("rejects a conflicting source version without overwriting it", async () => {
    await db.exec("update competency_frameworks set source_sha256=repeat('0',64)");
    await expect(db.exec(migration)).rejects.toThrow("COMPETENCY_SOURCE_CONFLICT");
    await db.exec("rollback");
    expect((await db.query("select source_sha256 from competency_frameworks")).rows).toEqual([{ source_sha256: "0".repeat(64) }]);
  });
  it("rolls back the entire migration if an expected catalog module is missing", async () => {
    const incomplete = new PGlite();
    try {
      await setup(incomplete, true);
      await expect(incomplete.exec(migration)).rejects.toThrow("COMPETENCY_CATALOG_PREREQUISITE");
      await incomplete.exec("rollback");
      expect((await incomplete.query("select to_regclass('public.competency_dictionary') as relation")).rows).toEqual([{ relation: null }]);
    } finally { await incomplete.close(); }
  }, 30_000);
});
