import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const migration = (name: string) => readFileSync('supabase/migrations/' + name, 'utf8');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const email = () => 'person-' + randomUUID() + '@example.invalid';
const admin = randomUUID();

type Visit = { visitId: string; expiresAt: string; method: string };
type Report = {
  records: {
    id: string; associateId: string | null; reviewReason: string | null; stage: string; reviewStatus: string; updatedAt: string;
    company: string | null; contact: { name: string | null; email: string | null } | null; canShareContact: boolean;
    sources: { channel: string }[]; needsHelp: boolean; followUps: unknown[]; reviews: { reason: string }[] | null;
  }[];
  total: number; totals: { visits: number; review: number; successful: number };
  associates: unknown[] | null;
};

async function rpc<T>(name: string, ...params: unknown[]) {
  const { rows } = await db.query<{ result: T }>(
    'select public.' + name + '(' + params.map((_, index) => '$' + (index + 1)).join(',') + ') as result', params,
  );
  return rows[0].result;
}
async function associate() {
  const id = randomUUID();
  const address = email();
  const settings = await rpc<{ code: string }>('referral_code_settings', id, address, 'load', null);
  return { id, email: address, code: settings.code };
}
const visit = (code: string, method = 'link') => rpc<Visit>('referral_register_visit', code, method, randomUUID());
const report = (owner: string | null, status: string | null = null, source: string | null = null) =>
  rpc<Report>('referral_dashboard', owner, owner === null, status, source, null, 0, 20);
async function lead(address: string, company = 'Synthetic Company', createdAt?: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into leads(name,email,company,created_at) values('Synthetic Contact',$1,$2,coalesce($3,now())) returning id",
    [address, company, createdAt || null],
  );
  return rows[0].id;
}
async function inquiry(leadId: string, address: string, visitId: string | null, share: boolean, company = 'Synthetic Company') {
  await db.query("insert into inquiries(lead_id,email,company,source,referral_visit_id,referral_contact_consent) values($1,$2,$3,'contact_form',$4,$5)", [
    leadId, address, company, visitId, share,
  ]);
}
async function booking(address: string, leadId: string, series: string, uid: string, token?: string) {
  await db.query(
    "insert into calendar_bookings(lead_id,attendee_email,provider_series_uid,provider_uid,provider_payload,status) values($1,$2,$3,$4,$5,'confirmed')",
    [leadId, address, series, uid, JSON.stringify(token ? { metadata: { binahub_referral: token } } : {})],
  );
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table leads(id uuid primary key default gen_random_uuid(), email text unique, name text, company text, phone text, source text,
      next_action text, lifecycle_stage text default 'prospect', opportunity_stage text default 'identified', source_metadata jsonb,
      created_at timestamptz not null default now());
    create table inquiries(id uuid primary key default gen_random_uuid(),lead_id uuid, name text, company text, email text, whatsapp text,
      message text, source text, status text, module_request_data jsonb, follow_up_paused boolean, reply_status text, reply_email_id text, reply_sent_at timestamptz);
    create table assessments(id uuid primary key default gen_random_uuid(),lead_id uuid,program_id uuid,form_data jsonb,
      follow_up_paused boolean,result_email_sent_at timestamptz,assessment_status text);
    create table calendar_bookings(id uuid primary key default gen_random_uuid(),provider text not null default 'cal.com',
      provider_uid text not null,provider_series_uid text,provider_payload jsonb,lead_id uuid,attendee_email text,status text not null);
    create table pe_participant_attempts(id uuid primary key, status text, retention_until timestamptz not null);
    create table pe_guest_contacts(attempt_id uuid primary key references pe_participant_attempts on delete cascade,
      email text,name text,draft_hash text);
    create table pe_consultation_requests(id uuid primary key,attempt_id uuid,inquiry_id uuid);
    create table consultant_workspaces(lead_id uuid,handoff jsonb);
  `);
  await db.exec(migration('0071_spin_discovery.sql'));
  await db.exec(migration('0098_associate_referrals.sql'));
  await db.exec(migration('0098_associate_referrals.sql'));
}, 30000);
afterAll(() => db.close());

describe('Associate referrals', () => {
  it('keeps dormant or rotated codes out of new intake and scopes cookies to thirty days', async () => {
    const a = await associate();
    const v = await visit(a.code);
    expect(v.method).toBe('link');
    expect(new Date(v.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    const disabled = await rpc<{ enabled: boolean }>('referral_code_settings', a.id, a.email, 'disable', a.code);
    expect(disabled.enabled).toBe(false);
    expect(await rpc('referral_lookup', v.visitId, null)).toBeNull();
    expect(await visit(a.code)).toBeNull();

    const next = await rpc<{ code: string }>('referral_code_settings', a.id, a.email, 'rotate', a.code);
    await expect(rpc('referral_code_settings', a.id, a.email, 'enable', a.code)).rejects.toThrow('REFERRAL_CODE_CHANGED');
    await rpc('referral_code_settings', a.id, a.email, 'enable', next.code);
    expect(await rpc('referral_lookup', v.visitId, null)).toBeNull();
    const second = await visit(next.code);
    await db.query("update associate_referral_visits set expires_at=now()-interval '1 second' where id=$1", [second.visitId]);
    expect(await rpc('referral_lookup', second.visitId, null)).toBeNull();
  });

  it('merges inquiry and team diagnosis below one case and changes stage from the CRM', async () => {
    const a = await associate(), other = await associate(), v = await visit(a.code), address = email();
    const id = await lead(address);
    await inquiry(id, address, v.visitId, true);
    await db.query('insert into assessments(lead_id,form_data) values($1,$2)', [id, JSON.stringify({ email: address, company: 'Synthetic Company', score: 72 })]);
    await db.query('insert into assessments(lead_id,program_id,form_data) values($1,$2,$3)', [id, randomUUID(), JSON.stringify({ email: address })]);
    const list = await report(a.id);
    expect(list.total).toBe(1);
    expect(list.records[0]).toMatchObject({ stage: 'verified', canShareContact: true, contact: { email: address } });
    expect(list.records[0].sources.map((x) => x.channel)).toEqual(['inquiry', 'team_diagnosis']);
    expect(JSON.stringify(list)).not.toContain('score');
    expect(list.associates).toBeNull();
    expect((await report(other.id)).records).toEqual([]);
    expect((await report(a.id, null, 'booking')).records).toEqual([]);

    const caseId = list.records[0].id;
    await expect(rpc('referral_add_follow_up', other.id, caseId, randomUUID(), 'Other account', null, false)).rejects.toThrow('REFERRAL_NOT_FOUND');
    const followId = randomUUID();
    await rpc('referral_add_follow_up', a.id, caseId, followId, 'Requested next week', null, false);
    await rpc('referral_add_follow_up', a.id, caseId, followId, 'Requested next week', null, false);
    expect((await report(a.id)).records[0].followUps).toHaveLength(1);
    await db.query("update leads set opportunity_stage='proposal' where id=$1", [id]);
    expect((await report(a.id)).records[0].stage).toBe('in_progress');
    await db.query("update leads set opportunity_stage='won' where id=$1", [id]);
    expect((await report(a.id, 'success')).records[0].stage).toBe('won');
    await db.query("insert into consultant_workspaces values($1,'{\"done\":true}')", [id]);
    expect((await report(a.id, 'success')).records[0].stage).toBe('completed');
  });

  it('reviews manual codes with reasons, protects private contacts, and handles stale reviews', async () => {
    const a = await associate(), v = await visit(a.code, 'manual'), address = email();
    const id = await lead(address, 'Manual testing company');
    await inquiry(id, address, v.visitId, false, 'Manual testing company');
    const row = (await report(a.id)).records[0];
    expect(row).toMatchObject({ reviewStatus: 'pending', contact: null, company: null, canShareContact: false });
    await expect(rpc('referral_add_follow_up', a.id, row.id, randomUUID(), 'Call customer', null, false)).rejects.toThrow('REFERRAL_CONSENT_REQUIRED');
    await rpc('referral_add_follow_up', a.id, row.id, randomUUID(), '', null, true);
    expect((await report(a.id)).records[0].needsHelp).toBe(true);

    const queue = await report(null, 'review');
    const target = queue.records.find((item) => item.id === row.id)!;
    expect(target.reviewReason).toBe('manual');
    await rpc('referral_review', admin, row.id, 'verified', a.code, 'Client confirmed', target.updatedAt);
    await expect(rpc('referral_review', admin, row.id, 'verified', a.code, 'Outdated review', target.updatedAt)).rejects.toThrow('REFERRAL_CHANGED');
    expect((await report(a.id)).records[0]).toMatchObject({ stage: 'verified', contact: null, needsHelp: false });
    expect((await report(null)).records.find((entry) => entry.id === row.id)?.reviews?.[0].reason).toBe('Client confirmed');
  });

  it('flags existing contacts, self-referrals and competing claims without transferring ownership', async () => {
    const a = await associate(), b = await associate(), address = email();
    const id = await lead(address, 'Established account', '2000-01-01T00:00:00Z');
    const av = await visit(a.code), bv = await visit(b.code);
    await inquiry(id, address, av.visitId, true, 'Established account');
    const old = (await report(a.id)).records[0];
    expect((await report(null, 'review')).records.find((entry) => entry.id === old.id)?.reviewReason).toBe('existing_contact');
    await inquiry(id, address, bv.visitId, true, 'Established account');
    expect((await report(b.id)).total).toBe(0);
    const conflict = (await report(null, 'review')).records.find((entry) => entry.id === old.id)!;
    expect(conflict).toMatchObject({ associateId: a.id, reviewReason: 'conflict' });
    await rpc('referral_review', admin, old.id, 'verified', b.code, 'Client confirmed the other referral', conflict.updatedAt);
    expect((await report(a.id)).total).toBe(0);
    expect((await report(b.id)).records[0]).toMatchObject({ contact: { email: address }, canShareContact: true });
    const selfLead = await lead(a.email);
    await inquiry(selfLead, a.email, av.visitId, true);
    const self = (await report(a.id)).records[0];
    await expect(rpc('referral_review', admin, self.id, 'verified', a.code, 'Invalid self approval', self.updatedAt)).rejects.toThrow('REFERRAL_SELF');
  });

  it('captures the real recommendation submission once on retries', async () => {
    const a = await associate(), v = await visit(a.code);
    const id = randomUUID(), draftKey = hash(randomUUID()), address = email();
    await rpc('spin_start', id, draftKey, 'spin-v3.2-ceo-2026-10-22', 'spin-processing-indefinite-v1');
    const payload = JSON.stringify({ idempotencyKey: hash('submit'), processingConsent: true, marketingConsent: false,
      noticeVersion: 'spin-processing-indefinite-v1', contact: { name: 'Synthetic prospect', email: address, company: 'Synthetic Onboarding', phone: '' } });
    const args = [id, draftKey, 0, '{"problemCluster":"C2"}', '{"status":"confirmed"}', '{}', payload, v.visitId, true];
    await rpc('referral_spin_write', ...args);
    await rpc('referral_spin_write', ...args);
    const list = await report(a.id);
    expect(list.total).toBe(1);
    expect(list.records[0].sources.map((entry) => entry.channel)).toEqual(['recommendation']);
  });

  it('captures guest completion without storing results or retaining expired individual contact', async () => {
    const a = await associate(), v = await visit(a.code), id = randomUUID(), address = email(), draftKey = hash('draft');
    await db.query("insert into pe_participant_attempts values($1,'draft',now()+interval '2 days')", [id]);
    await db.query("insert into pe_guest_contacts values($1,$2,'Synthetic individual',$3)", [id, address, draftKey]);
    await rpc('referral_prepare_individual', id, 'wrong draft key', v.visitId, true);
    expect((await db.query('select referral_visit_id from pe_guest_contacts where attempt_id=$1', [id])).rows[0]).toMatchObject({ referral_visit_id: null });
    await rpc('referral_prepare_individual', id, draftKey, v.visitId, true);
    expect((await report(a.id)).total).toBe(0);
    await db.query("update pe_participant_attempts set status='submitted' where id=$1", [id]);
    expect((await report(a.id)).records[0]).toMatchObject({ contact: { email: address }, sources: [{ channel: 'individual_diagnosis' }] });
    await db.query("update pe_participant_attempts set retention_until=now()-interval '1 second' where id=$1", [id]);
    expect((await report(a.id)).records[0]).toMatchObject({ contact: null, canShareContact: false });
    await db.query('delete from pe_participant_attempts where id=$1', [id]);
    expect((await report(a.id)).total).toBe(0);
  });

  it('uses a booking token for just one series and puts untagged bookings in the admin queue', async () => {
    const a = await associate(), v = await visit(a.code), address = email(), stranger = email();
    const first = await lead(address), second = await lead(stranger);
    const token = await rpc<string>('referral_issue_booking_token', v.visitId);
    await booking(address, first, 'test-series-one', 'test-uid-one', token);
    await booking(address, first, 'test-series-one', 'test-uid-two', token);
    await booking(stranger, second, 'test-series-two', 'test-uid-three', token);
    const list = await report(a.id);
    expect(list.total).toBe(1);
    expect(list.records[0]).toMatchObject({ contact: null, sources: [{ channel: 'booking' }] });
    const unmatched = (await report(null, 'review', 'booking')).records.find((row) => row.contact?.email === stranger)!;
    expect(unmatched).toMatchObject({ associateId: null, reviewReason: 'booking_without_code' });
    await rpc('referral_review', admin, unmatched.id, 'verified', a.code, 'Booking source was verified', unmatched.updatedAt);
    expect((await report(a.id)).total).toBe(2);
  });

  it('rejects direct client access and keeps internal intake RPCs private', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await db.query<{ canRead: boolean; canChange: boolean }>(
        "select has_table_privilege($1,'associate_referral_cases','select') as \"canRead\", has_function_privilege($1,'referral_review(uuid,uuid,text,text,text,timestamptz)','execute') as \"canChange\"", [role],
      );
      expect(rows[0]).toEqual({ canRead: false, canChange: false });
    }
    const { rows } = await db.query("select has_function_privilege('service_role','referral_record_entry(uuid,uuid,text,text,text,text,boolean,uuid)','execute') as allowed");
    expect(rows[0]).toMatchObject({ allowed: false });
  });
});
