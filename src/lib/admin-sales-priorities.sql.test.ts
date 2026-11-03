import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
const db=new PGlite();
type Task={id:string;recordId:string;kind:string;name:string;note:string;view:string;detail:string|null;priority:number;at:string|null};
type Inbox={records:Task[];total:number;counts:Record<string,number>};
const read=async(args:unknown[]=[0,'','all','all'])=>(await db.query<{value:Inbox}>('select admin_sales_priorities($1,$2,$3,$4) as value',args)).rows[0].value;
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table leads(id uuid primary key,name text,email text,company text,opportunity_stage text,outreach_paused boolean,next_action text,next_action_due_at timestamptz,source text);
   create table inquiries(id uuid primary key,lead_id uuid,name text,email text,source text,status text,reply_status text,reply_sent_at timestamptz,follow_up_level integer,follow_up_paused boolean,created_at timestamptz default now(),message text,admin_notes text,reply_body text);
   create table assessments(id uuid primary key,lead_id uuid,form_data jsonb,scores jsonb,category text,overall_score numeric,assessment_status text,result_email_sent_at timestamptz,
    proposal_sent_at timestamptz,proposal_requested_at timestamptz,proposal_status text,proposal_draft_data jsonb,proposal_gate_status text,
    result_follow_up_level integer,proposal_follow_up_level integer,follow_up_paused boolean,created_at timestamptz default now());
   create table calendar_bookings(id uuid primary key,lead_id uuid,assessment_id uuid,attendee_email text,status text);
   create table follow_up_events(id uuid primary key,lead_id uuid,target_type text,target_id uuid);
   create table follow_up_claims(lead_id uuid,target_type text,target_id uuid,channel text,level integer,status text);
   create table email_suppressions(email text primary key);`);
  await db.exec(readFileSync('supabase/migrations/0082_admin_assessment_inbox.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0086_admin_sales_priorities.sql','utf8'));
},30000);
beforeEach(()=>db.exec('truncate leads,inquiries,assessments,calendar_bookings,follow_up_events,follow_up_claims,email_suppressions'));
afterAll(()=>db.close());
async function inquiry(extra:Record<string,unknown>={}){
  const id=extra.id??randomUUID();await db.query(`insert into inquiries(id,lead_id,name,email,source,status,reply_status,reply_sent_at,follow_up_level,follow_up_paused,created_at,message,admin_notes,reply_body)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,now()),'PRIVATE_MESSAGE','PRIVATE_NOTES','PRIVATE_REPLY')`,
   [id,extra.lead_id??null,extra.name??'Inquiry',extra.email??'inquiry@company.invalid',extra.source??'website',extra.status??'Baru',extra.reply_status??'none',extra.sent??null,extra.level??0,extra.paused??false,extra.created??null]);return String(id);
}
async function assessment(extra:Record<string,unknown>={},form:unknown={name:'Diagnosis',email:'diagnosis@company.invalid',company:'Organization'}){
  const id=extra.id??randomUUID();await db.query(`insert into assessments(id,lead_id,form_data,assessment_status,result_email_sent_at,proposal_sent_at,proposal_requested_at,proposal_status,proposal_draft_data,proposal_gate_status,result_follow_up_level,proposal_follow_up_level,follow_up_paused,created_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::timestamptz,now()))`,
   [id,extra.lead_id??null,JSON.stringify(form),extra.status??'Result Email Terkirim',extra.result_sent??'2020-01-01',extra.proposal_sent??null,extra.requested??null,extra.proposal??'Belum Diminta',JSON.stringify(extra.draft??null),extra.gate??null,extra.result_level??0,extra.proposal_level??0,extra.paused??false,extra.created??null]);return String(id);
}
describe('SQL86 CRM archive, isolated PostgreSQL',()=>{
  it('finds old tasks beyond1000, filters before pagination and keeps global counts independent',async()=>{
    await db.exec(`insert into inquiries(id,name,email,source,status,created_at) select gen_random_uuid(),'Synthetic '||i,'i@company.invalid','website','Baru',now()-i*interval '1 minute' from generate_series(1,1005)i`);
    const id=await assessment({proposal:'Diminta',created:'2020-01-01'},{name:'Old %_* 東京',email:'old@company.invalid',attribution:{utmSource:'catalog'},answers:{secret:'PRIVATE_ANSWERS'},challenge:'PRIVATE_CHALLENGE'});
    const all=await read();expect(all.total).toBe(1006);expect(all.records).toHaveLength(20);expect(all.records[0]).toMatchObject({recordId:id,kind:'proposal',priority:0,detail:'proposal'});
    const filtered=await read([0,'%_* 東京','all','proposal']);expect(filtered.total).toBe(1);expect(filtered.counts).toMatchObject({all:1006,proposal:1});
    expect(JSON.stringify(filtered)).not.toMatch(/PRIVATE_|form_data|answers|reply_body|draft_data/);
    expect((await read([50,'','all','all'])).records).toHaveLength(6);expect((await read([51,'','all','all'])).records).toEqual([]);
  });
  it('preserves proposal priority/reconciliation states and gives one action per diagnosis',async()=>{
    const ids:string[]=[];for(const proposal of ['Diminta','Gagal Otomatis','Perlu Rekonsiliasi','Menunggu Approval'])ids.push(await assessment({proposal}));
    await assessment({proposal:'Belum Diminta',gate:'revision_required'});await assessment({proposal:'Sedang Disusun',gate:'pending_approval'});
    await assessment({result_sent:null,proposal:'Belum Diminta'}); // explicit null is tested below via update
    const missing=await assessment();await db.query('update assessments set result_email_sent_at=null where id=$1',[missing]);
    const result=await read();expect(result.counts.proposal).toBe(5);expect(result.records.filter(t=>t.recordId===ids[2])[0]).toMatchObject({note:'Periksa pengiriman',detail:'proposal'});
    expect(result.records.find(t=>t.recordId===missing)).toMatchObject({kind:'assessment',detail:'summary'});
    expect(result.records.every((t,i,rows)=>i===0||t.priority>=rows[i-1].priority)).toBe(true);expect(new Set(result.records.map(t=>t.recordId)).size).toBe(result.records.length);
  });
  it('honors inquiry2/7/14 boundaries, sending replies, pauses and closed statuses',async()=>{
    for(const [level,days]of [[0,2],[1,7],[2,14]])await db.query(`insert into inquiries(id,name,email,status,reply_status,reply_sent_at,follow_up_level) values($1,'Due','due@company.invalid','Dibalas','sent',now()-make_interval(days=>$2),$3)`,[randomUUID(),days,level]);
    await db.exec(`insert into inquiries(id,name,status,reply_sent_at) values(gen_random_uuid(),'Too early','Dibalas',now()-interval '1 day 23 hours')`);
    for(const status of ['Closed','Client','Selesai','Diarsipkan','Lanjut Diskusi','Qualified','Follow Up 3 Terkirim','Unsubscribed'])await inquiry({status,sent:'2020-01-01'});
    await inquiry({sent:'2020-01-01',paused:true});await inquiry({sent:'2020-01-01',level:3});await inquiry({reply_status:'sending'});
    const orphan=await inquiry({reply_status:'sent'});const result=await read();expect(result.counts.followup).toBe(3);
    expect(result.records.find(t=>t.recordId===orphan)).toMatchObject({kind:'inquiry',note:'Status balasan terkirim perlu diperiksa'});
  });
  it('retains result3levels and proposal1level with status stops; missing delivery is a review, not a reminder',async()=>{
    for(const level of [0,1,2])await assessment({result_level:level});await assessment({result_level:3});await assessment({paused:true});
    const sent=await assessment({proposal:'Terkirim',proposal_sent:'2020-01-01'});await assessment({proposal:'Terkirim',proposal_sent:'2020-01-01',proposal_level:1});
    for(const proposal of ['Revisi','Lanjut Diskusi','Deal','Lost','Closed'])await assessment({proposal,proposal_sent:'2020-01-01'});
    const missing=await assessment();await db.query('update assessments set result_email_sent_at=null where id=$1',[missing]);
    expect((await read()).counts.followup).toBe(4);expect((await read([0,'','followup','all'])).records.find(t=>t.recordId===sent)).toMatchObject({note:'Pengingat proposal 1 siap ditinjau',detail:'followup'});
    expect((await read()).records.find(t=>t.recordId===missing)?.kind).toBe('assessment');
  });
  it('checks linked IDs and normalized email across the full lead/booking archive, without matching blank identities',async()=>{
    const linked=randomUUID();await db.query(`insert into leads(id,email,opportunity_stage,outreach_paused) values($1,'Different@company.invalid','consultation',false)`,[linked]);
    await inquiry({lead_id:linked,sent:'2020-01-01',email:'other@company.invalid'});
    for(const status of ['requested','confirmed','rescheduled','completed']){
      const id=await assessment({}, {name:'Booked',email:status+'@company.invalid'});
      await db.query('insert into calendar_bookings values($1,null,$2,null,$3)',[randomUUID(),id,status]);
    }
    await db.query(`insert into leads(id,email,outreach_paused) values($1,'  Mixed@COMPANY.invalid ',true)`,[randomUUID()]);await inquiry({sent:'2020-01-01',email:'mixed@company.invalid'});
    await db.query(`insert into calendar_bookings values($1,null,null,'peer@company.invalid','requested')`,[randomUUID()]);await inquiry({sent:'2020-01-01',email:' PEER@company.invalid '});
    await db.query(`insert into leads(id,email,outreach_paused) values($1,'',true)`,[randomUUID()]);const blank=await inquiry({sent:'2020-01-01',email:''});
    expect((await read()).records.map(t=>t.recordId)).toEqual([blank]);
  });
  it('excludes suppressions, per-opportunity event/claim limits and already claimed next levels',async()=>{
    const lead=randomUUID();await db.query(`insert into leads(id,email) values($1,'shared@company.invalid')`,[lead]);
    const a=await inquiry({lead_id:lead,sent:'2020-01-01'});await assessment({lead_id:lead});
    for(let i=0;i<3;i++)await db.query('insert into follow_up_events values($1,$2,$3,$4)',[randomUUID(),lead,'inquiry',a]);
    const claimed=await inquiry({sent:'2020-01-01'});await db.query(`insert into follow_up_claims values(null,'inquiry',$1,'inquiry',1,'delivery_unconfirmed')`,[claimed]);
    const capped=await assessment();for(const level of [1,2,3])await db.query(`insert into follow_up_claims values(null,'assessment',$1,'proposal',$2,'sent')`,[capped,level]);
    const suppression=await inquiry({sent:'2020-01-01',email:' SUPPRESSED@company.invalid '});await db.exec(`insert into email_suppressions values('suppressed@company.invalid')`);
    expect((await read()).total).toBe(0);expect(suppression).toBeTruthy();
  });
  it('does not block cancelled meetings or unrelated claims; does not turn pause into a ban on manual review work',async()=>{
    const id=await inquiry({sent:'2020-01-01'});await db.query(`insert into calendar_bookings values($1,null,null,'inquiry@company.invalid','cancelled')`,[randomUUID()]);
    await db.query(`insert into follow_up_claims values(null,'inquiry',$1,'inquiry',1,'processing')`,[randomUUID()]);
    await assessment({proposal:'Menunggu Approval',paused:true});await inquiry({paused:true});
    const result=await read();expect(result.total).toBe(3);expect(result.records.find(t=>t.recordId===id)?.kind).toBe('followup');
  });
  it.each(['A,B (HQ)','O\'Brien "Utama"','100%_unit*','a.b+[c](d)?{2}|^$','path\\branch','東京 Nusantara'])('searches %s as literal text',async(term)=>{
    const id=await inquiry({name:term});await inquiry();expect((await read([0,term,'all','all'])).records.map(t=>t.recordId)).toEqual([id]);
  });
  it('keeps source-qualified task IDs, stable ordering and explicit closed-deal counts',async()=>{
    const shared=randomUUID();await inquiry({id:shared,created:'2020-01-01'});await assessment({id:shared,proposal:'Diminta',created:'2020-01-01'});
    await db.query(`insert into leads values($1,'Overdue','p@company.invalid','Org','qualified',false,'Check proposal','2020-01-01','website'),($2,'Won','w@company.invalid','Org','won',false,'Old action','2020-01-01','website')`,[randomUUID(),randomUUID()]);
    const result=await read();expect(result.counts.won).toBe(1);expect(result.total).toBe(3);expect(result.records.map(t=>t.kind)).toEqual(['proposal','inquiry','pipeline']);expect(new Set(result.records.map(t=>t.id)).size).toBe(3);
  });
  it('rejects invalid arguments and browser roles; service_role can read without changes',async()=>{
    for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(read()).rejects.toThrow(/permission denied/i);await expect(db.query('select * from admin_sales_tasks()')).rejects.toThrow(/permission denied/i);await db.exec('reset role');}
    await db.exec('set role service_role');expect((await read()).total).toBe(0);await db.exec('reset role');
    for(const args of [[-1,'','all','all'],[0,'x'.repeat(151),'all','all'],[0,'','wrong','all'],[0,'','all','wrong']])await expect(read(args)).rejects.toThrow('SALES_PRIORITIES_INVALID');
  });
});
