import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
type RecordDTO = { id: string; isUpcoming: boolean; isSuperseded: boolean; status: string; meetingUrl?: string };
type Inbox = { total: number; counts: Record<string, number>; records: RecordDTO[]; nextBooking: RecordDTO | null; statuses: string[] };
const read = async (args: unknown[] = [0, '', 'all', '']) => (await db.query<{ value: Inbox }>('select admin_meetings_inbox($1,$2,$3,$4) as value', args)).rows[0].value;
const detail = async (id: string) => (await db.query<{ value: RecordDTO | null }>('select admin_meeting_detail($1) as value', [id])).rows[0].value;
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table calendar_bookings(id uuid primary key,provider text default 'cal.com',provider_uid text,provider_series_uid text,
    lead_id uuid,assessment_id uuid,event_type_slug text,title text,status text,attendee_name text,attendee_email text,organizer_email text,
    start_time timestamptz,end_time timestamptz,time_zone text,meeting_url text,cancellation_reason text,
    provider_payload jsonb default '{"secret":"PRIVATE_PAYLOAD"}',created_at timestamptz default now(),updated_at timestamptz default now());`);
  await db.exec(readFileSync('supabase/migrations/0087_admin_meetings_inbox.sql', 'utf8'));
}, 30000);
beforeEach(() => db.exec('truncate calendar_bookings'));
afterAll(() => db.close());
const add = async (extra: Record<string, unknown> = {}) => {
  const id = randomUUID();
  await db.query(`insert into calendar_bookings(id,provider_uid,provider_series_uid,title,status,attendee_name,attendee_email,start_time,end_time,time_zone,meeting_url,cancellation_reason,created_at)
    values($1::uuid,$1::text,$2,'Consultation',$3,$4,'test@company.invalid',$5,$6,'America/New_York','https://meet.company.invalid/PRIVATE_ROOM','PRIVATE_REASON',coalesce($7::timestamptz,now()))`,
    [id, extra.series ?? null, extra.status ?? 'confirmed', extra.name ?? 'Synthetic', 'start' in extra ? extra.start : '2099-01-01T00:00:00Z',
      'end' in extra ? extra.end : '2099-01-01T01:00:00Z', extra.created ?? null]);
  return id;
};
describe('SQL87 isolated consultation archive', () => {
  it('counts and searches beyond 1000 records before pagination; hides private detail and provider payload', async () => {
    await db.exec(`insert into calendar_bookings(id,provider_uid,status,attendee_name,attendee_email,start_time,end_time)
      select gen_random_uuid(),i::text,'completed','Synthetic '||i,'test@company.invalid','2020-01-01','2020-01-02' from generate_series(1,1005)i`);
    const old = await add({ name: 'Old %_* 東京', start: '2019-01-01', end: '2019-01-02' });
    const all = await read(); expect(all.total).toBe(1006); expect(all.counts.all).toBe(1006); expect(all.records).toHaveLength(20);
    expect((await read([50, '', 'all', ''])).records).toHaveLength(6);
    expect((await read([51, '', 'all', ''])).records).toHaveLength(0);
    const found = await read([0, '%_* 東京', 'all', '']); expect(found.records.map(r => r.id)).toEqual([old]);
    expect(JSON.stringify(found)).not.toContain('PRIVATE_'); expect((await detail(old))?.meetingUrl).toContain('PRIVATE_ROOM');
    expect(JSON.stringify(await detail(old))).not.toContain('PRIVATE_PAYLOAD'); expect(await detail(randomUUID())).toBeNull();
  });
  it('keeps rescheduled slots historical using creation lineage, not the old row update timestamp', async () => {
    const old = await add({ series: 'same', status: 'rescheduled', created: '2020-01-01' });
    const newer = await add({ series: 'same', created: '2020-01-02' });
    await db.query('update calendar_bookings set updated_at=now() where id=$1', [old]);
    const upcoming = await read([0, '', 'upcoming', '']); expect(upcoming.records.map(r => r.id)).toEqual([newer]);
    expect(upcoming.nextBooking?.id).toBe(newer); expect((await detail(old))?.isSuperseded).toBe(true);
    expect((await read([0, '', 'history', ''])).records.map(r => r.id)).toEqual([old]);
    await db.query(`update calendar_bookings set status='cancelled' where id=$1`, [newer]);
    expect((await read([0, '', 'upcoming', ''])).total).toBe(0); expect((await read()).counts.cancelled).toBe(1);
  });
  it('uses WIB for today, includes earlier agenda, and never equates elapsed time with completion', async () => {
    const { rows } = await db.query<{ today: string; yesterday: string }>(`select ((now() at time zone 'Asia/Jakarta')::date+time '00:01') at time zone 'Asia/Jakarta' as today,
      (((now() at time zone 'Asia/Jakarta')::date-1)+time '23:59') at time zone 'Asia/Jakarta' as yesterday`);
    const today = await add({ start: rows[0].today, end: rows[0].today });
    await add({ start: rows[0].yesterday, end: rows[0].yesterday });
    await add({ start: rows[0].today, end: rows[0].today, status: 'cancelled' });
    await add({ status: 'completed' });
    expect((await read([0, '', 'today', ''])).records.map(r => r.id)).toEqual([today]);
    expect((await read()).counts.completed).toBe(1); expect((await detail(today))?.status).toBe('confirmed');
  });
  it('retains undated, reversed-time and unknown-status records in review and cancelled records in their own view', async () => {
    const unknown = await add({ status: 'unknown' }); await add({ start: null, end: null });
    await add({ start: '2099-02-01', end: '2099-01-01' });
    for (const status of ['cancelled', 'rejected', 'no_show']) await add({ status, start: null, end: null });
    expect(await read()).toMatchObject({ total: 6, counts: { review: 3, cancelled: 3, upcoming: 0, completed: 0 } });
    expect((await read([0, '', 'review', 'unknown'])).records[0].id).toBe(unknown);
  });
  it.each(["O'Brien", 'A,B (HQ)', '100%_unit*', 'a.b+[c](d)?{2}|^$', 'path\\branch', '東京 Nusantara'])('matches %s literally and keeps global counts stable', async name => {
    const id = await add({ name }); await add(); const found = await read([0, name, 'all', 'confirmed']);
    expect(found.records.map(r => r.id)).toEqual([id]); expect(found.counts.all).toBe(2);
  });
  it('denies browser roles and invalid bounds; reads cannot mutate source records', async () => {
    const id = await add();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`); await expect(read()).rejects.toThrow(/permission denied/i); await expect(detail(id)).rejects.toThrow(/permission denied/i); await db.exec('reset role');
    }
    await db.exec('set role service_role'); expect((await read()).total).toBe(1); await db.exec('reset role');
    for (const args of [[-1, '', 'all', ''], [0, '', 'invalid', ''], [0, 'x'.repeat(151), 'all', '']]) await expect(read(args)).rejects.toThrow('MEETINGS_INBOX_INVALID');
    expect((await db.query('select status from calendar_bookings')).rows).toEqual([{ status: 'confirmed' }]);
  });
});
