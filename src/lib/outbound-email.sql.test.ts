import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real PostgreSQL/PLpgSQL in memory; no connection to Supabase or email providers.
const db = new PGlite();
const migration = readFileSync("supabase/migrations/0060_outbound_email_queue.sql", "utf8");
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.acquisition_campaigns(id uuid primary key);
    create table public.acquisition_prospects(id uuid primary key);
    create table public.outbound_campaign_links(id uuid primary key default gen_random_uuid());
  `);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });

async function fixture() {
  const campaignId = randomUUID(), prospectId = randomUUID();
  await db.query("insert into acquisition_campaigns values ($1)", [campaignId]);
  await db.query("insert into acquisition_prospects values ($1)", [prospectId]);
  return { campaignId, prospectId };
}
async function queue(campaignId: string, prospectId: string | null, requestKey = randomUUID(), kind = "initial", email = "target@example.com") {
  const result = await db.query<{ result: { jobId: string; queued: number; duplicate: boolean; alreadyQueued?: number } }>(
    "select queue_outbound_email($1,$2,$3,'id','v1','hash','subject','html','admin@example.com',$4::jsonb) as result",
    [campaignId, requestKey, kind, JSON.stringify([{ prospectId, email, name: "Bapak/Ibu", company: null }])],
  );
  return result.rows[0].result;
}

describe("outbound queue SQL contracts", () => {
  it("can safely reapply the migration without replacing queue data", async () => {
    const { campaignId, prospectId } = await fixture();
    const job = await queue(campaignId, prospectId);
    await db.exec(migration);
    expect((await db.query("select id from outbound_email_jobs where id=$1", [job.jobId])).rows).toHaveLength(1);
  });
  it("deduplicates request retries and a new import of the same email in one campaign", async () => {
    const { campaignId, prospectId } = await fixture(), requestKey = randomUUID();
    const first = await queue(campaignId, prospectId, requestKey, "initial", " TARGET@EXAMPLE.COM ");
    expect(first.queued).toBe(1);
    expect(await queue(campaignId, prospectId, requestKey)).toMatchObject({ jobId: first.jobId, queued: 0, duplicate: true });
    const anotherProspect = randomUUID();
    await db.query("insert into acquisition_prospects values ($1)", [anotherProspect]);
    expect(await queue(campaignId, anotherProspect)).toMatchObject({ queued: 0, alreadyQueued: 1 });
    const rows = await db.query("select email from outbound_email_deliveries where campaign_id=$1", [campaignId]);
    expect(rows.rows).toEqual([{ email: "target@example.com" }]);
  });
  it("claims each queued recipient once and respects campaign scope", async () => {
    const a = await fixture(), b = await fixture();
    await queue(a.campaignId, a.prospectId); await queue(b.campaignId, b.prospectId);
    const claimed = await db.query("select * from claim_outbound_email(null,10,$1)", [a.campaignId]);
    expect(claimed.rows).toHaveLength(1); expect(claimed.rows[0]).toMatchObject({ status: "processing", campaign_id: a.campaignId });
    expect((await db.query("select * from claim_outbound_email(null,10,$1)", [a.campaignId])).rows).toHaveLength(0);
    expect((await db.query("select status from outbound_email_deliveries where campaign_id=$1", [b.campaignId])).rows).toEqual([{ status: "queued" }]);
  });
  it("holds interrupted sends for reconciliation and never automatically reclaims them", async () => {
    const { campaignId, prospectId } = await fixture(); await queue(campaignId, prospectId);
    await db.query("select * from claim_outbound_email(null,10,$1)", [campaignId]);
    await db.query("update outbound_email_deliveries set updated_at=now()-interval '11 minutes' where campaign_id=$1", [campaignId]);
    expect((await db.query("select * from claim_outbound_email(null,10,$1)", [campaignId])).rows).toHaveLength(0);
    expect((await db.query("select status from outbound_email_deliveries where campaign_id=$1", [campaignId])).rows).toEqual([{ status: "uncertain" }]);
  });
  it("rolls back the whole job if any recipient violates a database constraint", async () => {
    const { campaignId } = await fixture(), requestKey = randomUUID();
    await expect(queue(campaignId, null, requestKey)).rejects.toThrow();
    expect((await db.query("select id from outbound_email_jobs where request_key=$1", [requestKey])).rows).toHaveLength(0);
  });
  it("enables RLS and denies public/browser-role queue access", async () => {
    const result = await db.query<{ table_name: string; relrowsecurity: boolean }>("select relname as table_name,relrowsecurity from pg_class where relname in ('outbound_email_jobs','outbound_email_deliveries')");
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
    expect((await db.query("select has_function_privilege('anon','queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb)','execute') as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select has_table_privilege('authenticated','outbound_email_deliveries','select') as allowed")).rows).toEqual([{ allowed: false }]);
  });
});
