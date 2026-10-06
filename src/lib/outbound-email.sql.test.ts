import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real PostgreSQL/PLpgSQL in memory; no connection to Supabase or email providers.
const db = new PGlite();
const migration = readFileSync("supabase/migrations/0060_outbound_email_queue.sql", "utf8");
const settingsMigration = readFileSync("supabase/migrations/0061_outbound_campaign_settings.sql", "utf8");
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.acquisition_campaigns(id uuid primary key);
    create table public.acquisition_prospects(id uuid primary key);
    create table public.outbound_campaign_links(id uuid primary key default gen_random_uuid());
  `);
  await db.exec(migration);
  await db.exec(settingsMigration);
}, 30_000);
afterAll(async () => { await db.close(); });

async function fixture() {
  const campaignId = randomUUID(), prospectId = randomUUID();
  await db.query("insert into acquisition_campaigns values ($1)", [campaignId]);
  await db.query("insert into acquisition_prospects values ($1)", [prospectId]);
  await db.query("select save_outbound_settings($1,true,'restricted',array['target@example.com'],false,0,'admin@example.com')", [campaignId]);
  return { campaignId, prospectId };
}
async function queue(campaignId: string, prospectId: string | null, requestKey = randomUUID(), kind = "initial", email = "target@example.com") {
  const result = await db.query<{ result: { jobId: string; queued: number; duplicate: boolean; alreadyQueued?: number } }>(
    "select queue_outbound_email($1,$2,$3,'id','v1','hash','subject','html','admin@example.com',$4::jsonb,1) as result",
    [campaignId, requestKey, kind, JSON.stringify([{ prospectId, email, name: "Bapak/Ibu", company: null }])],
  );
  return result.rows[0].result;
}

describe("outbound queue SQL contracts", () => {
  it("starts sales follow-up paused, audits activation, and denies browser writes", async () => {
    expect((await db.query("select enabled,activated_at from sales_follow_up_settings")).rows).toEqual([{ enabled: false, activated_at: null }]);
    expect((await db.query("select has_function_privilege('anon','save_sales_follow_up_settings(boolean,integer,text)','execute') as allowed")).rows).toEqual([{ allowed: false }]);
    await db.query("select save_sales_follow_up_settings(true,1,'admin@example.com')");
    const active = (await db.query<{ enabled: boolean; activated_at: string }>("select enabled,activated_at from sales_follow_up_settings")).rows[0];
    expect(active.enabled).toBe(true); expect(active.activated_at).toBeTruthy();
    await expect(db.query("select save_sales_follow_up_settings(false,1,'admin@example.com')")).rejects.toThrow("SALES_SETTINGS_CONFLICT");
    await db.query("select save_sales_follow_up_settings(false,2,'admin@example.com')");
    expect((await db.query("select actor from sales_follow_up_settings_audit")).rows).toHaveLength(2);
  });
  it("atomically activates and queues a selection, with retry deduplication", async () => {
    const campaignId = randomUUID(); await db.query("insert into acquisition_campaigns values ($1)", [campaignId]);
    const key = randomUUID();
    const sql = "select activate_and_queue_outbound_email($1,$2,'test','id','v1','hash','subject','html','admin@example.com',$3::jsonb,0) as result";
    const args = [campaignId, key, JSON.stringify([{ prospectId: null, email: "admin@example.com", name: "Admin" }])];
    expect((await db.query<{ result: { queued: number } }>(sql, args)).rows[0].result.queued).toBe(1);
    expect((await db.query<{ result: { duplicate: boolean } }>(sql, args)).rows[0].result.duplicate).toBe(true);
    expect((await db.query("select version,recipient_mode from outbound_campaign_settings where campaign_id=$1", [campaignId])).rows).toEqual([{ version: 1, recipient_mode: "approved_list" }]);
  });
  it("rolls activation back on invalid queue data and never widens an existing audience", async () => {
    const campaignId = randomUUID(); await db.query("insert into acquisition_campaigns values ($1)", [campaignId]);
    await expect(db.query("select activate_and_queue_outbound_email($1,$2,'test','id','v1','hash','subject','html','admin@example.com',$3::jsonb,0)", [campaignId,randomUUID(),JSON.stringify([{ email: "other@example.com", name: "Other" }])])).rejects.toThrow("OUTBOUND_TEST_ADMIN_ONLY");
    expect((await db.query("select * from outbound_campaign_settings where campaign_id=$1", [campaignId])).rows).toHaveLength(0);
    await db.query("select save_outbound_settings($1,false,'restricted',array['target@example.com'],false,0,'admin@example.com')", [campaignId]);
    await expect(db.query("select activate_and_queue_outbound_email($1,$2,'initial','id','v1','hash','subject','html','admin@example.com',$3::jsonb,1)", [campaignId,randomUUID(),JSON.stringify([{ email: "other@example.com", name: "Other" }])])).rejects.toThrow("OUTBOUND_RECIPIENT_NOT_ALLOWED");
    expect((await db.query("select enabled,version from outbound_campaign_settings where campaign_id=$1", [campaignId])).rows).toEqual([{ enabled: false, version: 1 }]);
  });
  it("can safely reapply the migration without replacing queue data", async () => {
    const { campaignId, prospectId } = await fixture();
    const job = await queue(campaignId, prospectId);
    await db.exec(settingsMigration);
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
    expect((await db.query("select has_function_privilege('anon','queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb,integer)','execute') as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select has_table_privilege('authenticated','outbound_email_deliveries','select') as allowed")).rows).toEqual([{ allowed: false }]);
  });
  it("requires app activation and the settings version before queueing", async () => {
    const { campaignId, prospectId } = await fixture();
    await db.query("select save_outbound_settings($1,false,'restricted',array['target@example.com'],false,1,'admin@example.com')", [campaignId]);
    await expect(queue(campaignId, prospectId)).rejects.toThrow("OUTBOUND_SETTINGS_CHANGED_OR_PAUSED");
  });
  it("audits settings, normalizes addresses and rejects a stale concurrent edit", async () => {
    const { campaignId } = await fixture();
    await db.query("select save_outbound_settings($1,true,'restricted',array[' TARGET@EXAMPLE.COM ','target@example.com'],false,1,'admin@example.com')", [campaignId]);
    expect((await db.query("select version,allowed_emails from outbound_campaign_settings where campaign_id=$1", [campaignId])).rows).toEqual([{ version: 2, allowed_emails: ["target@example.com"] }]);
    expect((await db.query("select actor from outbound_settings_audit where campaign_id=$1", [campaignId])).rows).toHaveLength(2);
    await expect(db.query("select save_outbound_settings($1,false,'restricted',array['target@example.com'],false,1,'admin@example.com')", [campaignId])).rejects.toThrow("OUTBOUND_SETTINGS_CONFLICT");
  });
  it("blocks a target outside a restricted audience, but allows a test only to its admin", async () => {
    const { campaignId, prospectId } = await fixture();
    await expect(queue(campaignId, prospectId, randomUUID(), "initial", "other@example.com")).rejects.toThrow("OUTBOUND_RECIPIENT_NOT_ALLOWED");
    expect((await queue(campaignId, null, randomUUID(), "test", "admin@example.com")).queued).toBe(1);
    await expect(queue(campaignId, null, randomUUID(), "test", "other@example.com")).rejects.toThrow("OUTBOUND_TEST_ADMIN_ONLY");
  });
  it("a pause cancels pending jobs and resume does not replay them", async () => {
    const { campaignId, prospectId } = await fixture(); await queue(campaignId, prospectId);
    await db.query("select save_outbound_settings($1,false,'restricted',array['target@example.com'],false,1,'admin@example.com')", [campaignId]);
    await db.query("select save_outbound_settings($1,true,'restricted',array['target@example.com'],false,2,'admin@example.com')", [campaignId]);
    expect((await db.query("select * from claim_outbound_email(null,10,$1)", [campaignId])).rows).toHaveLength(0);
    expect((await db.query("select status from outbound_email_deliveries where campaign_id=$1", [campaignId])).rows).toEqual([{ status: "blocked" }]);
  });
  it("does not claim legacy jobs even after a campaign is explicitly activated", async () => {
    const { campaignId, prospectId } = await fixture();
    const jobId = randomUUID();
    await db.query("insert into outbound_email_jobs(id,campaign_id,request_key,kind,locale,template_version,template_hash,subject_template,html_template,requested_by,settings_version) values($1,$2,$3,'initial','id','old','hash','subject','html','admin@example.com',0)", [jobId,campaignId,randomUUID()]);
    await db.query("insert into outbound_email_deliveries(job_id,campaign_id,prospect_id,kind,email,name) values($1,$2,$3,'initial','target@example.com','Internal')", [jobId,campaignId,prospectId]);
    expect((await db.query("select * from claim_outbound_email(null,10,$1)", [campaignId])).rows).toHaveLength(0);
  });
  it("keeps settings and audits inaccessible to browser roles", async () => {
    expect((await db.query("select has_table_privilege('authenticated','outbound_campaign_settings','update') as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select has_function_privilege('anon','save_outbound_settings(uuid,boolean,text,text[],boolean,integer,text)','execute') as allowed")).rows).toEqual([{ allowed: false }]);
  });
});
