import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
type Inbox = { records: Array<{id:string;messagePreview:string;followUpDue:boolean}>;total:number;counts:Record<string,number>;facets:{sources:string[];statuses:string[]} };
const read = async (args:unknown[]=[0,'','','']) => (await db.query<{value:Inbox}>('select admin_inquiry_inbox($1,$2,$3,$4) as value',args)).rows[0].value;
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table inquiries(id uuid primary key,name text,email text,whatsapp text,message text,source text,status text,reply_status text,reply_sent_at timestamptz,
    follow_up_level integer,follow_up_paused boolean,admin_notes text,reply_body text,module_request_data jsonb,created_at timestamptz not null default now());`);
  await db.exec(readFileSync('supabase/migrations/0083_admin_inquiry_inbox.sql','utf8'));
},30000);
beforeEach(()=>db.exec('truncate inquiries'));
afterAll(()=>db.close());
const add = async (extra:Record<string,unknown>={})=>{
  const id=randomUUID();
  await db.query(`insert into inquiries(id,name,email,whatsapp,message,source,status,reply_status,reply_sent_at,follow_up_level,follow_up_paused,created_at,admin_notes,reply_body,module_request_data)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::timestamptz,now()),'PRIVATE_NOTES','PRIVATE_REPLY','{"private":"PRIVATE_MODULE"}')`,
  [id,extra.name??'Synthetic',extra.email??'test@example.invalid',extra.whatsapp??'',extra.message??'Synthetic context',extra.source??'website',extra.status??'Baru',extra.reply_status??'none',extra.reply_sent_at??null,extra.follow_up_level??0,extra.follow_up_paused??false,extra.created_at??null]);
  return id;
};
describe('SQL83 Inquiry inbox, isolated PostgreSQL',()=>{
  it('searches beyond1000 records before count/pagination; bounds payload and preserves private detail',async()=>{
    await db.exec(`insert into inquiries(id,name,email,message,source,status,reply_status,created_at) select gen_random_uuid(),'Synthetic '||i,'test@example.invalid','Context','website','Baru','none',now()-i*interval '1 minute' from generate_series(1,1005)i;`);
    const old=await add({name:'Old, "Unique" %_* 東京',message:'X'.repeat(5000),created_at:'2020-01-01',source:'old_source',status:'Custom'});
    const full=await read(); expect(full.total).toBe(1006); expect(full.records).toHaveLength(20); expect(full.counts.fresh).toBe(1005);
    const found=await read([0,'"Unique" %_* 東京','','']);expect(found.total).toBe(1);expect(found.records[0].id).toBe(old);expect(found.records[0].messagePreview).toHaveLength(500);
    expect(JSON.stringify(found)).not.toMatch(/PRIVATE_|admin_notes|reply_body|module_request_data|follow_up_history/);
    expect(found.facets.sources).toEqual(['old_source','website']); expect(found.facets.statuses).toEqual(['Baru','Custom']);
    expect((await read([50,'','',''])).records).toHaveLength(6);expect((await read([51,'','',''])).records).toEqual([]);
    expect((await db.query<{message:string}>('select message from inquiries where id=$1',[old])).rows[0].message).toHaveLength(5000);
  });
  it.each(['A,B (HQ)','O\'Brien "Utama"','100%_unit*','a.b+[c](d)?{2}|^$','path\\branch','東京 Nusantara'])('treats %s as literal searchable text',async(term)=>{
    const id=await add({message:term});await add({message:'Different'});const result=await read([0,term,'','']);expect(result.records.map(r=>r.id)).toEqual([id]);
  });
  it('applies source/status filters to totals and metrics but not the facet inventory',async()=>{
    await add({source:'catalog',status:'Baru',reply_status:'draft'});await add({source:'catalog',status:'Diproses',reply_status:'reviewed'});await add({source:'spin_discovery',status:'New',reply_status:'sent'});
    expect(await read()).toMatchObject({total:3,counts:{fresh:2,awaiting:1,ready:1,due:0}});
    expect(await read([0,'','catalog','Diproses'])).toMatchObject({total:1,counts:{fresh:0,awaiting:0,ready:1,due:0},facets:{sources:['catalog','spin_discovery'],statuses:['Baru','Diproses','New']}});
  });
  it('uses existing2/7/14day due boundaries and excludes paused, stopped, complete and unsent inquiries',async()=>{
    await db.exec(`insert into inquiries(id,name,email,status,reply_status,reply_sent_at,follow_up_level) values
      (gen_random_uuid(),'A','a@x','Dibalas','sent',now()-interval '2 days',0),
      (gen_random_uuid(),'B','b@x','Follow Up 1 Terkirim','sent',now()-interval '7 days',1),
      (gen_random_uuid(),'C','c@x','Follow Up 2 Terkirim','sent',now()-interval '14 days',2),
      (gen_random_uuid(),'D','d@x','Dibalas','sent',now()-interval '1 day 23 hours',0);`);
    for(const status of ['Lanjut Diskusi','Qualified','Client','Selesai','Diarsipkan','Closed','Follow Up 3 Terkirim']) await add({status,reply_sent_at:'2020-01-01'});
    await add({reply_sent_at:'2020-01-01',follow_up_paused:true});await add({reply_sent_at:'2020-01-01',follow_up_level:3});await add();
    expect((await read()).counts.due).toBe(3);
  });
  it('orders timestamp ties by ID and denies browser roles while allowing service_role',async()=>{
    const ids=[await add({created_at:'2026-01-01'}),await add({created_at:'2026-01-01'}),await add({created_at:'2026-01-01'})];
    expect((await read()).records.map(r=>r.id)).toEqual(ids.sort());
    for(const role of ['anon','authenticated']) {await db.exec(`set role ${role}`);await expect(read()).rejects.toThrow(/permission denied/i);await db.exec('reset role');}
    await db.exec('set role service_role');expect((await read()).total).toBe(3);await db.exec('reset role');
  });
  it('rejects invalid bounds without writes',async()=>{
    await expect(read([-1,'','',''])).rejects.toThrow('INQUIRY_INBOX_INVALID');await expect(read([0,'x'.repeat(151),'',''])).rejects.toThrow('INQUIRY_INBOX_INVALID');
    expect((await read()).total).toBe(0);
  });
});
