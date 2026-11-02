import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const db = new PGlite();
type Row = { id: string; name: string; overallScore: number; proposalDraft: unknown };
type Inbox = { records: Row[]; total: number; pageSize: number; counts: Record<string, number>; facets: { categories: string[]; employees: string[] } };
const read = async (args: unknown[] = [0, '', '', '', 0, 'all', 'latest']) => (await db.query<{ value: Inbox }>('select admin_assessment_inbox($1,$2,$3,$4,$5,$6,$7) as value', args)).rows[0].value;
const add = async (extra: Record<string, unknown> = {}, form: unknown = { name: 'Synthetic', email: 'test@example.invalid', company: 'Nusantara', employees: '51-100' }) => {
  const id = randomUUID();
  await db.query(`insert into assessments(id,form_data,created_at,proposal_status,assessment_status,proposal_draft_data,proposal_gate_status,proposal_sent_at,result_email_sent_at,result_follow_up_level,proposal_follow_up_level,follow_up_paused,scores,overall_score,category,lead_id)
    values($1,$2,coalesce($3::timestamptz,now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
  [id, JSON.stringify(form), extra.created_at ?? null, extra.proposal_status ?? null, extra.assessment_status ?? null, JSON.stringify(extra.proposal_draft_data ?? null), extra.proposal_gate_status ?? null,
    extra.proposal_sent_at ?? null, extra.result_email_sent_at ?? null, extra.result_follow_up_level ?? 0, extra.proposal_follow_up_level ?? 0, extra.follow_up_paused ?? false,
    JSON.stringify(extra.scores ?? { overall: 67 }), extra.overall_score ?? null, extra.category ?? 'Profesional', extra.lead_id ?? null]);
  return id;
};
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table leads(id uuid primary key,name text,email text,company text);
    create table assessments(id uuid primary key,lead_id uuid,form_data jsonb,scores jsonb,category text,overall_score numeric,
    assessment_status text,result_email_sent_at timestamptz,proposal_sent_at timestamptz,proposal_status text,proposal_draft_data jsonb,proposal_gate_status text,
    result_follow_up_level integer,proposal_follow_up_level integer,follow_up_paused boolean,created_at timestamptz not null);`);
  await db.exec(readFileSync('supabase/migrations/0082_admin_assessment_inbox.sql', 'utf8'));
}, 30000);
beforeEach(() => db.exec('truncate assessments,leads'));
afterAll(() => db.close());

describe('SQL82 admin diagnosis inbox, isolated PostgreSQL', () => {
  it('finds old data beyond1000 rows, counts before pagination and never returns raw answers/reports', async () => {
    await db.exec(`insert into assessments(id,form_data,scores,category,created_at)
      select gen_random_uuid(),jsonb_build_object('name','Synthetic '||i,'company','Company '||i,'answers','PRIVATE_ANSWERS'),'{"overall":60}', 'Profesional',now()-i*interval '1 minute' from generate_series(1,1005) i;`);
    const old = await add({ created_at: '2020-01-01', category: 'Arsip', scores: { overall: 90 } }, { name: 'Old, "Unique" %_*', employees: '1001+', answers: { private: true } });
    const full = await read(); expect(full.total).toBe(1006); expect(full.records).toHaveLength(20); expect(full.counts.all).toBe(1006);
    const found = await read([0, '"Unique" %_*', '', '', 0, 'all', 'latest']);
    expect(found.total).toBe(1); expect(found.records[0].id).toBe(old);
    expect(found.facets).toMatchObject({ categories: ['Arsip', 'Profesional'], employees: ['1001+', 'Tidak diketahui'] });
    expect(JSON.stringify(found)).not.toMatch(/PRIVATE_ANSWERS|"answers"|form_data|scores|ai_analysis/);
    expect((await read([50, '', '', '', 0, 'all', 'latest'])).records).toHaveLength(6);
    expect((await read([51, '', '', '', 0, 'all', 'latest'])).records).toEqual([]);
  });

  it('normalizes legacy JSON strings, lead fallbacks, score precedence and filters before totals', async () => {
    const lead = randomUUID(); await db.query('insert into leads values($1,$2,$3,$4)', [lead, 'Nama lead', 'lead@example.invalid', 'PT Tokyo 東京']);
    const id = await add({ lead_id: lead, scores: JSON.stringify({ overall: '69.5' }), overall_score: 10, category: 'Berkembang' }, JSON.stringify({ employees: '1-50' }));
    await add({ scores: { overall: 90 }, category: 'Profesional' });
    const result = await read([0, '東京', 'Berkembang', '1-50', 70, 'all', 'latest']);
    expect(result.total).toBe(1); expect(result.records[0]).toMatchObject({ id, name: 'Nama lead', overallScore: 70 });
    expect((await read([0, '東京', '', '', 71, 'all', 'latest'])).total).toBe(0);
    expect((await db.query<{ n: number }>(`select admin_assessment_number('"invalid"') as n`)).rows[0].n).toBe(0);
  });

  it('keeps queue semantics and counts independent of the selected queue', async () => {
    const requested = await add({ proposal_status: 'Diminta' });
    const failed = await add({ proposal_status: 'Gagal Otomatis' });
    await add({ proposal_status: 'Perlu Rekonsiliasi' });
    await add({ proposal_status: 'Menunggu Approval' });
    await add({ proposal_gate_status: 'revision_required' });
    const processing = await add({ proposal_status: 'Sedang Disusun' });
    const manual = await add({ proposal_status: 'Sedang Disusun', proposal_draft_data: { proposal: { subject: 'PRIVATE_DRAFT' } } });
    await add({ proposal_status: 'Terkirim', proposal_gate_status: 'rejected' });
    const sent = await add({ proposal_status: 'Gagal Otomatis', proposal_sent_at: new Date().toISOString() });
    const counts = (await read()).counts;
    expect(counts).toEqual({ all: 9, attention: 5, processing: 1, sent: 2 });
    const active = await read([0, '', '', '', 0, 'processing', 'latest']);
    expect(active.total).toBe(1); expect(active.records[0].id).toBe(processing); expect(active.counts).toEqual(counts);
    const attention = await read([0, '', '', '', 0, 'attention', 'latest']);
    expect(attention.records.map((row) => row.id)).toEqual(expect.arrayContaining([requested, failed]));
    expect(attention.records.map((row) => row.id)).not.toEqual(expect.arrayContaining([processing, manual, sent]));
    const all = await read([0, '', '', '', 0, 'all', 'attention']);
    expect(all.records.slice(0, 5).every((row) => attention.records.some((item) => item.id === row.id))).toBe(true);
    expect(all.records.find((row) => row.id === manual)?.proposalDraft).toEqual({ proposal: {}, automatic: false });
    expect(JSON.stringify(all)).not.toContain('PRIVATE_DRAFT');
  });

  it('honors follow-up2/7/14day boundaries, stopped and paused states without sending anything', async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    await add({ created_at: ago(2.01) });
    await add({ result_follow_up_level: 1, result_email_sent_at: ago(7.01) });
    await add({ result_follow_up_level: 2, result_email_sent_at: ago(14.01) });
    await add({ proposal_status: 'Terkirim', proposal_sent_at: ago(2.01) });
    for (const extra of [{ created_at: ago(1.99) }, { result_follow_up_level: 1, created_at: ago(6.99) },
      { result_follow_up_level: 2, created_at: ago(13.99) }, { follow_up_paused: true, created_at: ago(30) },
      { result_follow_up_level: 3, created_at: ago(30) }, { assessment_status: 'Closed', created_at: ago(30) },
      { proposal_status: 'Lost', created_at: ago(30) }, { proposal_status: 'Terkirim', proposal_sent_at: ago(10), proposal_follow_up_level: 1 }]) await add(extra);
    expect((await read()).counts.attention).toBe(4);
    const before = (await db.query('select * from assessments order by id')).rows;
    await read([0, '', '', '', 0, 'attention', 'attention']);
    expect((await db.query('select * from assessments order by id')).rows).toEqual(before);
  });

  it('has deterministic pages when timestamps tie and only grants service-role execution', async () => {
    for (let i = 0; i < 42; i++) await add({ created_at: '2026-01-01' });
    const first = await read(); const second = await read([1, '', '', '', 0, 'all', 'latest']);
    expect(new Set([...first.records, ...second.records].map((row) => row.id)).size).toBe(40);
    expect((await read()).records).toEqual(first.records);
    for (const role of ['anon', 'authenticated']) expect((await db.query<{ ok: boolean }>(`select has_function_privilege($1,'admin_assessment_inbox(integer,text,text,text,integer,text,text)','execute') as ok`, [role])).rows[0].ok).toBe(false);
    expect((await db.query<{ ok: boolean }>(`select has_function_privilege('service_role','admin_assessment_inbox(integer,text,text,text,integer,text,text)','execute') as ok`)).rows[0].ok).toBe(true);
  });

  it('returns49 aggregate rows on demand without participant answers', async () => {
    await add({}, { name: 'PRIVATE_PERSON', answers: { '1': 4, '2': 5 } });
    await add({}, JSON.stringify({ answers: { '1': 4, '2': 1 } }));
    const result = (await db.query<{ value: Array<Record<string, number | string>> }>('select admin_assessment_answer_distribution() as value')).rows[0].value;
    expect(result).toHaveLength(49); expect(result[0]).toMatchObject({ question: 'Q1', '4': 2 }); expect(result[1]).toMatchObject({ '1': 1, '5': 1 });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PERSON');
    for (const role of ['anon', 'authenticated']) expect((await db.query<{ ok: boolean }>(`select has_function_privilege($1,'admin_assessment_answer_distribution()','execute') as ok`, [role])).rows[0].ok).toBe(false);
  });

  it.each([[-1, '', '', '', 0, 'all', 'latest'], [10001, '', '', '', 0, 'all', 'latest'], [0, 'x'.repeat(151), '', '', 0, 'all', 'latest'], [0, '', '', '', 101, 'all', 'latest'], [0, '', '', '', 0, 'unsafe', 'latest'], [0, '', '', '', 0, 'all', 'sql']])('rejects invalid query %j', async (...args) => {
    await expect(read(args)).rejects.toThrow('ASSESSMENT_INBOX_INVALID');
  });
});
