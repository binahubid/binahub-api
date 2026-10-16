import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';

const db=new PGlite(), actor=randomUUID();
const migration=readFileSync('supabase/migrations/0069_individual_commerce_foundation.sql','utf8');
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table pe_guest_contacts(id uuid);
    create table pe_instrument_versions(instrument_id text,version text,manifest jsonb,primary key(instrument_id,version));`);
  await db.query('insert into pe_instrument_versions values($1,$2,$3)',[
    'BINAINSIGHTS-PE-V1','1.0.0-draft.1',{config:{competencies:Array.from({length:6},(_,i)=>({code:`PE-0${i+1}`}))}},
  ]);
  await db.exec(migration);
},30_000);
afterAll(()=>db.close());
async function dashboard(){return (await db.query<{value:Record<string,unknown>}>('select pe_commerce_admin_dashboard() as value')).rows[0].value;}

describe('SQL69 individual commerce preparation',()=>{
  it('starts unpriced and closed, without copying questions or creating fake purchases',async()=>{
    const value=await dashboard();
    expect(value.areaCodes).toEqual(['PE-01','PE-03','PE-05']);
    expect(value.orders).toEqual([]);expect(value.matchedCount).toBe(0);
    expect(Object.values(value.configuration as object).every(v=>v===null)).toBe(true);
    expect((await db.query('select accepting_orders as enabled from pe_commerce_settings')).rows).toEqual([{enabled:false}]);
    await expect(db.exec('update pe_commerce_settings set accepting_orders=true')).rejects.toThrow();
  });
  it('saves append-only versions, replays lost acknowledgements and rejects stale admins',async()=>{
    const initial=await dashboard(), input={...initial.configuration as object,name:'Synthetic internal draft',priceIdr:250000};
    const save=()=>db.query('select pe_commerce_save_draft($1,$2,$3) as value',[initial.revision,input,actor]);
    expect((await save()).rows).toEqual([{value:{revision:1}}]);
    expect((await save()).rows).toEqual([{value:{revision:1}}]);
    expect((await db.query('select count(*)::int as n from pe_commerce_audit')).rows).toEqual([{n:1}]);
    expect((await db.query<{configuration:unknown}>('select configuration from pe_commerce_offer_revisions where revision=0')).rows[0].configuration).toEqual(initial.configuration);
    await expect(db.query('select pe_commerce_save_draft($1,$2,$3)',[0,input,randomUUID()])).rejects.toThrow('PE_REVISION_CONFLICT');
    await expect(db.query('select pe_commerce_save_draft($1,$2,$3)',[0,{...input,name:'Other draft'},actor])).rejects.toThrow('PE_REVISION_CONFLICT');
  });
  it('rejects unknown fields, zero, decimals, forged activation and invalid types at the SQL boundary',async()=>{
    const value=await dashboard();
    for(const patch of [{priceIdr:0},{priceIdr:1.5},{priceIdr:'250000'},{attempts:0},{name:true},{terms:''},{active:true}]){
      await expect(db.query('select pe_commerce_save_draft($1,$2,$3)',[value.revision,{...value.configuration as object,...patch},actor])).rejects.toThrow('PE_INVALID_REQUEST');
    }
  });
  it('does not reset saved preparation when migration is reapplied',async()=>{
    const before=await dashboard();await db.exec(migration);expect(await dashboard()).toEqual(before);
  });
  it('denies direct browser and service mutations and limits executable RPCs to service',async()=>{
    const tables=['offer_revisions','settings','customers','orders','payment_attempts','entitlements','payment_events','outbox','audit'];
    for(const table of tables)for(const role of ['anon','authenticated','service_role']){
      expect((await db.query(`select has_table_privilege('${role}',$1,'select,insert,update,delete') as ok`,['pe_commerce_'+table])).rows).toEqual([{ok:false}]);
    }
    for(const fn of ['pe_commerce_admin_dashboard(text,text)','pe_commerce_save_draft(int,jsonb,uuid)']){
      for(const role of ['anon','authenticated'])expect((await db.query(`select has_function_privilege('${role}',$1,'execute') as ok`,[fn])).rows).toEqual([{ok:false}]);
    }
    await db.exec('set role service_role');try{expect((await dashboard()).orders).toEqual([]);}finally{await db.exec('reset role');}
  });
  it('enforces idempotent order, unique entitlement and scoped payment references without exposing a payment writer',async()=>{
    const customer=randomUUID(), order=randomUUID(),offer=(await dashboard()).offerId;
    await db.query('insert into pe_commerce_customers(id,email,verified_at) values($1,$2,now())',[customer,'synthetic@example.invalid']);
    const insert=()=>db.query(`insert into pe_commerce_orders(id,customer_id,offer_id,total_idr,snapshot,idempotency_key,request_hash)
      values($1,$2,$3,1000,'{}','synthetic_request_0001',repeat('a',64))`,[order,customer,offer]);
    await insert();await expect(insert()).rejects.toThrow();
    const grant=()=>db.query(`insert into pe_commerce_entitlements(order_id,customer_id,area_codes,status,attempts_allowed,start_until,complete_until)
      values($1,$2,array['PE-01','PE-03','PE-05'],'available',1,now()+interval '1 day',now()+interval '2 days')`,[order,customer]);
    await grant();await expect(grant()).rejects.toThrow();
    const value=await dashboard();expect(value.matchedCount).toBe(1);
    expect((value.orders as {accessStatus:string}[])[0].accessStatus).toBe('available');
    expect((await db.query<{v:Record<string,unknown>}>("select pe_commerce_admin_dashboard('not matching','all') as v")).rows[0].v.orders).toEqual([]);
    expect(migration).not.toMatch(/create or replace function public\.(?:.*grant|.*checkout|.*mark_paid)/);
  });
});
