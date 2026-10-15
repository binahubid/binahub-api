import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const db = new PGlite();
const sql = readFileSync("supabase/migrations/0068_ai_provider_settings.sql", "utf8");
const actor = randomUUID();
beforeAll(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(sql);
}, 30_000);
afterAll(async () => { await db.close(); });
const save = (primary: string, enabled: (string | null)[], version: number) => db.query(
  "select save_ai_provider_settings($1,$2::text[],$3,$4::uuid) as value", [primary, enabled, version, actor]);
describe("SQL 68 AI routing controls", () => {
  it("preserves the previous routing until the first explicit save", async () => {
    expect((await db.query("select primary_provider,enabled_providers,version from ai_provider_settings")).rows)
      .toEqual([{ primary_provider: null, enabled_providers: [], version: 0 }]);
  });
  it("validates primary, allowlist, uniqueness and null entries atomically", async () => {
    for (const [primary, enabled] of [["bad", ["bad"]], ["codecraft", ["lapakvip"]],
      ["lapakvip", ["lapakvip", "lapakvip"]], ["lapakvip", ["lapakvip", null]]] as [string, (string | null)[]][]) {
      await expect(save(primary, enabled, 0)).rejects.toThrow("AI_SETTINGS_INVALID");
    }
    expect((await db.query("select * from ai_provider_settings_audit")).rows).toHaveLength(0);
  });
  it("uses compare-and-swap, records the actor, and survives migration reruns", async () => {
    await save("codecraft", ["codecraft", "openrouter"], 0);
    await expect(save("lapakvip", ["lapakvip"], 0)).rejects.toThrow("AI_SETTINGS_CONFLICT");
    await db.exec(sql);
    expect((await db.query("select primary_provider,version from ai_provider_settings")).rows)
      .toEqual([{ primary_provider: "codecraft", version: 1 }]);
    expect((await db.query("select actor_id from ai_provider_settings_audit")).rows).toEqual([{ actor_id: actor }]);
  });
  it("denies browsers and requires service role to mutate through the audited RPC", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.exec("select * from ai_provider_settings")).rejects.toThrow("permission denied");
        await expect(save("lapakvip", ["lapakvip"], 1)).rejects.toThrow("permission denied");
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try {
      await expect(db.exec("update ai_provider_settings set primary_provider='lapakvip'")).rejects.toThrow("permission denied");
      await save("lapakvip", ["lapakvip"], 1);
    } finally { await db.exec("reset role"); }
  });
});
