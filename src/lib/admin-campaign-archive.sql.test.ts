import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
type Archive = { total: number; all: number; statusCounts: Record<string, number>; records: Array<{ id: string; status: string; title: string; linked?: boolean }> };
const read = async (kind = 'campaigns', campaign: string | null = null, page = 0, search = '', status = '', channel = '', journey: string | null = null) =>
  (await db.query<{ value: Archive | null }>('select admin_campaign_archive($1,$2,$3,$4,$5,$6,$7) as value', [kind, campaign, journey, page, search, status, channel])).rows[0].value;
let campaign: string, other: string, source: string;
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table acquisition_sources(id uuid primary key,name text,channel text,status text,active boolean,config jsonb default '{"private":"PRIVATE_SOURCE"}');
   create table acquisition_campaigns(id uuid primary key,source_id uuid,name text,campaign_code text,status text,owner text,channel text,starts_on date,ends_on date,
    updated_at timestamptz default now(),utm_config jsonb default '{}',target_definition jsonb default '{"private":"PRIVATE_TARGET"}');
   create table acquisition_prospects(id uuid primary key,campaign_id uuid,name text,email text,company text,validation_status text,consent_status text,
    created_at timestamptz default now(),raw_data jsonb default '{"secret":"PRIVATE_RAW"}');
   create table prospect_import_batches(id uuid primary key,campaign_id uuid,import_key text,file_name text,status text,total_rows int default 0,valid_rows int default 0,
    invalid_rows int default 0,duplicate_rows int default 0,suppressed_rows int default 0,promoted_rows int default 0,created_at timestamptz default now(),legal_snapshot jsonb);
   create table acquisition_events(id uuid primary key,campaign_id uuid,event_type text,actor text,note text,created_at timestamptz default now(),metadata jsonb default '{"secret":"PRIVATE_METADATA"}');
   create table outbound_email_jobs(id uuid primary key,locale text,html_template text default 'PRIVATE_HTML');
   create table outbound_email_deliveries(id uuid primary key,campaign_id uuid,job_id uuid,name text,email text,company text,status text,kind text,
    created_at timestamptz default now(),error_message text default 'PRIVATE_PROVIDER',provider_email_id text default 'PRIVATE_PROVIDER_ID');
   create table inbound_journeys(id uuid primary key,first_attribution jsonb,last_attribution jsonb,first_channel text,first_landing_path text,last_path text,
    first_seen_at timestamptz default now(),last_seen_at timestamptz default now());
   create table inbound_journey_events(id uuid primary key,journey_id uuid,event_type text,route_path text,module_codes text[] default '{}',created_at timestamptz default now(),attribution jsonb);
   create table inbound_lead_journeys(journey_id uuid,lead_id uuid);`);
  await db.exec(readFileSync('supabase/migrations/0088_admin_campaign_archive.sql', 'utf8'));
}, 30000);
beforeEach(async () => {
  await db.exec('truncate acquisition_sources,acquisition_campaigns,acquisition_prospects,prospect_import_batches,acquisition_events,outbound_email_jobs,outbound_email_deliveries,inbound_journeys,inbound_journey_events,inbound_lead_journeys');
  source = randomUUID(); campaign = randomUUID(); other = randomUUID();
  await db.query(`insert into acquisition_sources(id,name,channel,status,active) values($1,'Synthetic source','inbound','paused',false)`, [source]);
  for (const id of [campaign, other]) await db.query(`insert into acquisition_campaigns(id,source_id,name,campaign_code,status,owner,channel,utm_config)
   values($1,$2,$3,$3,'completed','admin@example.invalid','email',$4)`, [id, source, id === campaign ? 'OLD_CAMPAIGN' : 'OTHER_CAMPAIGN', { campaign: id === campaign ? 'old_campaign' : 'other_campaign', source: 'binahub', medium: 'email' }]);
});
afterAll(() => db.close());
const journey = async (campaignCode = 'old_campaign', sourceName = 'binahub', last = {}) => {
  const id = randomUUID();
  await db.query(`insert into inbound_journeys(id,first_attribution,last_attribution,first_channel,first_landing_path,last_path) values($1,$2,$3,'email','/insight','/thanks')`,
    [id, { utmCampaign: campaignCode, utmSource: sourceName, utmMedium: 'email', token: 'PRIVATE_ATTRIBUTION' }, last]);
  return id;
};
describe('SQL88 isolated campaign archive', () => {
  it('finds old campaigns beyond 1000 records, with global counts independent of literal search', async () => {
    await db.query(`insert into acquisition_campaigns(id,source_id,name,campaign_code,status,owner,channel)
     select gen_random_uuid(),$1,'Synthetic '||i,'SYNTHETIC_'||i,'active','admin@example.invalid','email' from generate_series(1,1005)i`, [source]);
    await db.query(`update acquisition_campaigns set name='Old %_* 東京',updated_at='2000-01-01' where id=$1`, [campaign]);
    expect(await read()).toMatchObject({ total: 1007, all: 1007, statusCounts: { active: 1005, completed: 2 } });
    expect((await read())?.records).toHaveLength(20);
    expect((await read('campaigns', null, 50))?.records).toHaveLength(7);
    const found = await read('campaigns', null, 0, '%_* 東京', 'completed', 'inbound');
    expect(found?.records.map(v => v.id)).toEqual([campaign]); expect(found?.all).toBe(1007);
    expect(JSON.stringify(found)).not.toContain('PRIVATE_');
  });
  it('paginates all recipient, delivery, batch and audit history without leaking operational secrets', async () => {
    const job = randomUUID(); await db.query(`insert into outbound_email_jobs(id,locale) values($1,'id')`, [job]);
    await db.query(`insert into acquisition_prospects(id,campaign_id,name,email,company,validation_status,consent_status,created_at)
     select gen_random_uuid(),$1,'Synthetic '||i,'synthetic'||i||'@example.invalid','Company','valid','unknown','2020-01-01' from generate_series(1,1005)i`, [campaign]);
    await db.query(`insert into outbound_email_deliveries(id,campaign_id,job_id,name,email,status,kind)
     select gen_random_uuid(),$1,$2,'Synthetic '||i,'synthetic'||i||'@example.invalid','sent','initial' from generate_series(1,1005)i`, [campaign, job]);
    await db.query(`insert into prospect_import_batches(id,campaign_id,import_key,status) select gen_random_uuid(),$1,'IMPORTED_'||i,'completed' from generate_series(1,1005)i`, [campaign]);
    await db.query(`insert into acquisition_events(id,campaign_id,event_type,actor,note) select gen_random_uuid(),$1,'batch_staged','admin@example.invalid','Synthetic '||i from generate_series(1,1005)i`, [campaign]);
    for (const kind of ['prospects', 'deliveries', 'batches', 'events']) {
      const result = await read(kind, campaign, 50); expect(result?.total).toBe(1005); expect(result?.records).toHaveLength(5);
      expect((await read(kind, other))?.total).toBe(0); expect(JSON.stringify(result)).not.toContain('PRIVATE_');
      expect((await read(kind, campaign, 0, 'Synthetic 1005'))?.total).toBe(kind === 'batches' ? 0 : 1);
    }
    expect((await read('batches', campaign, 0, 'IMPORTED_1005'))?.total).toBe(1);
    expect((await read('deliveries', campaign))?.statusCounts.sent).toBe(1005);
  });
  it('uses first-touch exact UTM evidence, not last touch, and counts journeys rather than events or people', async () => {
    const id = await journey(); await journey('other_campaign'); await journey('old_campaign', 'someone_else');
    await journey('Old_Campaign'); await journey('unknown', 'binahub', { utmCampaign: 'old_campaign', utmSource: 'binahub', utmMedium: 'email' });
    await db.query(`insert into inbound_journey_events(id,journey_id,event_type,route_path) select gen_random_uuid(),$1,'inquiry_submitted','/thanks' from generate_series(1,1005)`, [id]);
    await db.query(`insert into inbound_lead_journeys values($1,$2),($1,$3)`, [id, randomUUID(), randomUUID()]);
    const found = await read('journeys', campaign); expect(found).toMatchObject({ all: 1, total: 1, statusCounts: { converted: 1 } });
    expect(found?.records[0]).toMatchObject({ id, linked: true }); expect(JSON.stringify(found)).not.toContain('PRIVATE_');
    const events = await read('journey_events', campaign, 50, '', '', '', id); expect(events?.total).toBe(1005); expect(events?.records).toHaveLength(5);
    expect(await read('journey_events', other, 0, '', '', '', id)).toBeNull();
  });
  it('returns null for a removed scope and keeps unknown statuses searchable', async () => {
    expect(await read('prospects', randomUUID())).toBeNull();
    await db.query(`update acquisition_campaigns set status='legacy_unknown' where id=$1`, [campaign]);
    expect((await read('campaigns', null, 0, '', 'legacy_unknown'))?.records[0].id).toBe(campaign);
  });
  it('orders timestamp ties stably, denies browser roles and rejects invalid direct RPC parameters', async () => {
    const first = await read(); const again = await read(); expect(first?.records.map(v => v.id)).toEqual(again?.records.map(v => v.id));
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`); await expect(read()).rejects.toThrow(/permission denied/i);
      await expect(db.query(`select * from admin_campaign_archive_rows('campaigns')`)).rejects.toThrow(/permission denied/i); await db.exec('reset role');
    }
    await db.exec('set role service_role'); expect((await read())?.all).toBe(2); await db.exec('reset role');
    for (const args of [['invalid', null, null, 0, '', '', ''], ['campaigns', null, null, -1, '', '', ''], ['prospects', null, null, 0, '', '', ''],
      ['campaigns', null, null, 0, 'x'.repeat(151), '', ''], ['campaigns', null, randomUUID(), 0, '', '', '']]) {
      await expect(db.query('select admin_campaign_archive($1,$2,$3,$4,$5,$6,$7)', args)).rejects.toThrow('CAMPAIGN_ARCHIVE_INVALID');
    }
    expect((await db.query<{ n: number }>('select count(*) n from acquisition_campaigns')).rows[0].n).toBe(2);
  });
});
