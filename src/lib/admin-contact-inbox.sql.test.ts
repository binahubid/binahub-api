import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
const db=new PGlite();
type Contact={id:string;recordId:string;name:string;email:string;whatsapp:string;sourceType:string;source:string;status:string;category:string;notes?:string;message?:string};
type Inbox={records:Contact[];total:number;counts:Record<string,number>;facets:{types:string[];categories:string[];statuses:string[]}};
const read=async(args:unknown[]=[0,'','','',''])=>(await db.query<{value:Inbox}>('select admin_contact_inbox($1,$2,$3,$4,$5) as value',args)).rows[0].value;
const detail=async(kind:string,id:string)=>(await db.query<{value:Contact|null}>('select admin_contact_detail($1,$2) as value',[kind,id])).rows[0].value;
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table leads(id uuid primary key,name text,email text,phone text,notes text,source text,lead_status text,created_at timestamptz default now());
   create table inquiries(id uuid primary key,name text,email text,whatsapp text,message text,source text,status text,admin_notes text,created_at timestamptz default now());
   create table coaches(id uuid primary key,name text,email text,phone text,notes text,bio text,linkedin_summary text,category text,status text,created_at timestamptz default now());
   create table employees(id uuid primary key,name text,email text,phone text,notes text,role text,department text,status text,created_at timestamptz default now());`);
  await db.exec(readFileSync('supabase/migrations/0084_admin_contact_inbox.sql','utf8'));
},30000);
beforeEach(()=>db.exec('truncate leads,inquiries,coaches,employees'));
afterAll(()=>db.close());
const lead=async(email:string|null='lead@example.invalid',extra:{name?:string;notes?:string;status?:string;phone?:string;source?:string;date?:string}={})=>{
  const id=randomUUID();await db.query('insert into leads(id,name,email,phone,notes,source,lead_status,created_at) values($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz,now()))',
  [id,extra.name??'Lead',email,extra.phone??'',extra.notes??'PRIVATE_LEAD_NOTES',extra.source??'website',extra.status??'New Lead',extra.date??null]);return id;
};
describe('SQL84 contact archive, isolated PostgreSQL',()=>{
  it('finds old data beyond1000 before pagination, never includes notes/context in list',async()=>{
    await db.exec(`insert into leads(id,name,email,source,lead_status,created_at) select gen_random_uuid(),'Synthetic '||i,'test'||i||'@example.invalid','website','New Lead',now()-i*interval '1 minute' from generate_series(1,1005)i;`);
    const id=await lead('old@example.invalid',{name:'Arsip %_* 東京',date:'2020-01-01',status:'Archived'});const full=await read();expect(full.total).toBe(1006);expect(full.records).toHaveLength(20);
    const old=await read([0,'%_* 東京','','','']);expect(old.total).toBe(1);expect(old.records[0].recordId).toBe(id);
    expect(JSON.stringify(old)).not.toMatch(/PRIVATE_|"notes"|"message"|search_text|identity_key|qualification/);
    expect((await read([50,'','','',''])).records).toHaveLength(6);expect((await read([51,'','','',''])).records).toEqual([]);
    expect(await detail('lead',id)).toMatchObject({notes:'PRIVATE_LEAD_NOTES',status:'Archived'});
  });
  it('merges all matching identities before filters, keeps lead priority and searchable historical aliases',async()=>{
    const id=await lead('  Mixed@EXAMPLE.invalid ',{name:'Primary lead',date:'2020-01-01',notes:''});
    await db.query(`insert into inquiries(id,name,email,whatsapp,message,source,status,admin_notes) values($1,'Old alias A,B "HQ"','mixed@example.invalid','628123','Inquiry context','contact_form','Dibalas','PRIVATE_INQUIRY_NOTE')`,[randomUUID()]);
    await db.query(`insert into coaches(id,name,email,category,status,bio) values($1,'Coach','mixed@example.invalid','Leadership','active','Coach context')`,[randomUUID()]);
    const result=await read([0,'A,B "HQ"','lead','','New Lead']);expect(result.total).toBe(1);expect(result.records[0]).toMatchObject({id:'lead:'+id,sourceType:'lead',name:'Primary lead',email:'Mixed@EXAMPLE.invalid',whatsapp:'628123',status:'New Lead'});
    expect(result.counts).toEqual({leads:1,reachable:1,sources:3});expect((await read([0,'','coach','',''])).total).toBe(0);
    expect(await detail('lead',id)).toMatchObject({message:'Inquiry context',notes:''});
    expect((await db.query<{notes:string}>('select notes from leads where id=$1',[id])).rows[0].notes).toBe('');
  });
  it('keeps source/type/id identities independent and never uses a name as identity',async()=>{
    const id=await lead(null,{name:'Same name',phone:''});
    await db.query(`insert into inquiries(id,name,email,whatsapp,source,status) values($1,'Same name','-','','website','Baru')`,[id]);
    expect((await read()).total).toBe(2);expect(await detail('lead',id)).toMatchObject({id:'lead:'+id});expect(await detail('inquiry',id)).toMatchObject({id:'inquiry:'+id});
    expect((await read()).counts.reachable).toBe(0);expect(await detail('coach',id)).toBeNull();
  });
  it('normalizes phone-only identity but does not infer a transitive match with a populated email',async()=>{
    await lead(null,{phone:'+62 812-34'});await db.query(`insert into employees(id,name,email,phone,department,status) values($1,'Employee',null,'6281234','Operations','active')`,[randomUUID()]);
    expect((await read()).total).toBe(1);await lead('separate@example.invalid',{phone:'6281234'});expect((await read()).total).toBe(2);
  });
  it.each(['A,B (HQ)','O\'Brien "Utama"','100%_unit*','a.b+[c](d)?{2}|^$','path\\branch','東京 Nusantara'])('matches %s literally',async(term)=>{
    const id=await lead('search@example.invalid',{name:term});await lead('other@example.invalid');expect((await read([0,term,'','',''])).records.map(r=>r.recordId)).toEqual([id]);
  });
  it('does not infer client/follow-up status from private notes or age; facets are global',async()=>{
    await lead('archived@example.invalid',{status:'Archived',date:'2020-01-01',notes:'proposal qualified client follow up'});
    await lead('client@example.invalid',{status:'Client',source:'contact_form'});
    expect(await read([0,'','lead','','Archived'])).toMatchObject({total:1,records:[{status:'Archived'}],facets:{statuses:['Archived','Client']}});
    expect((await read([0,'qualified','','',''])).total).toBe(0);
  });
  it('keeps deterministic representatives and ordering when timestamps tie',async()=>{
    const ids=[await lead('tie@example.invalid',{date:'2020-01-01'}),await lead('tie@example.invalid',{date:'2020-01-01'})].sort();
    expect((await read()).records[0].recordId).toBe(ids[0]);expect(await detail('lead',ids[1])).toBeNull();
  });
  it('denies browser roles and permits service_role reads only',async()=>{
    for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(read()).rejects.toThrow(/permission denied/i);await expect(db.query('select * from admin_contact_records()')).rejects.toThrow(/permission denied/i);await db.exec('reset role');}
    await db.exec('set role service_role');expect((await read()).total).toBe(0);await db.exec('reset role');
  });
  it('validates arguments without modifying stored data',async()=>{
    await expect(read([-1,'','','',''])).rejects.toThrow('CONTACT_INBOX_INVALID');await expect(read([0,'x'.repeat(151),'','',''])).rejects.toThrow('CONTACT_INBOX_INVALID');await expect(read([0,'','unknown','',''])).rejects.toThrow('CONTACT_INBOX_INVALID');
  });
});
