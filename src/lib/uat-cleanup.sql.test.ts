import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const previewSql=readFileSync('supabase/operations/cleanup_operational_test_data.sql','utf8');
const executeSql=previewSql.replace("binahub.cleanup_execute='false'","binahub.cleanup_execute='true'");
const real='d1ea232f-2038-4cfd-8c26-59caf4eaf760';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(){
  const db=new PGlite();await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text);
    create table organizations(id uuid primary key,name text);
    create table profiles(id uuid primary key references auth.users,organization_id uuid references organizations on delete set null,role text);
    create table leads(id uuid primary key,email text);
    create table client_accounts(id uuid primary key,organization_id uuid references organizations,source_lead_id uuid references leads on delete set null);
    create table engagements(id uuid primary key,organization_id uuid references organizations on delete cascade,title text,code text);
    create table projects(id uuid primary key,engagement_id uuid references engagements on delete set null,client_account_id uuid references client_accounts,source_lead_id uuid references leads on delete set null);
    create table participants(id uuid primary key,organization_id uuid references organizations on delete cascade,profile_id uuid references profiles,email text);
    create table engagement_participants(engagement_id uuid references engagements on delete cascade,participant_id uuid references participants on delete cascade,primary key(engagement_id,participant_id));
    create table batches(id uuid primary key,program_id uuid references engagements on delete cascade);
    create table tbos_missions(id uuid primary key,name text);
    create table tbos_behavioral_dimensions(id uuid primary key,name text);
    create table tbos_teams(id uuid primary key,engagement_id uuid references engagements on delete restrict,organization_id uuid references organizations,batch_id uuid references batches,name text);
    create table tbos_team_members(team_id uuid references tbos_teams on delete cascade,profile_id uuid references profiles,primary key(team_id,profile_id));
    create table tbos_observations(id uuid primary key,program_id uuid references engagements,team_id uuid references tbos_teams,mission_id uuid references tbos_missions,notes text);
    create table tbos_observation_scores(observation_id uuid references tbos_observations on delete cascade,dimension_id uuid references tbos_behavioral_dimensions,score int,primary key(observation_id,dimension_id));
    create table tbos_live_score_sessions(id uuid primary key,program_id uuid references engagements,batch_id uuid references batches,status text);
    create table tbos_live_score_audit_log(id uuid primary key,session_id uuid references tbos_live_score_sessions on delete cascade,metadata jsonb);
    create table app_client_access_codes(id uuid primary key,program_id uuid references engagements on delete cascade,participant_id uuid references participants on delete set null,auth_user_id uuid references auth.users,credential_hash text);
    create table program_modules(program_id uuid references engagements,module_key text,enabled boolean,primary key(program_id,module_key));
    create table facilitator_team_scores(program_id uuid,module_key text,score int,foreign key(program_id,module_key) references program_modules);
    create table acquisition_prospects(id uuid primary key,matched_lead_id uuid references leads on delete set null);
    alter table leads add column acquisition_prospect_id uuid references acquisition_prospects on delete set null;
    create table inquiries(id uuid primary key,lead_id uuid references leads on delete set null,email text);
    create table assessments(id uuid primary key,lead_id uuid references leads,form_data jsonb);
    create table calendar_bookings(id uuid primary key,attendee_email text);
    create table event_queue(id uuid primary key,payload jsonb);
    create table pe_participant_attempts(id uuid primary key,status text);
    create table pe_guest_contacts(attempt_id uuid primary key references pe_participant_attempts on delete cascade,email text);
    create table catalog_modules(id uuid primary key,name text);
    create table competency_dictionary(id uuid primary key,name text);
    create table pe_instrument_versions(id text primary key,manifest jsonb);
    create table sales_follow_up_settings(enabled boolean);
    create table generated_documents(id uuid primary key,title text);
    insert into organizations values('${id(1)}','Synthetic real org'),('${id(2)}','Synthetic test org');
    insert into auth.users values('${id(3)}','real@example.invalid'),('${id(4)}','test@example.invalid');
    insert into profiles values('${id(3)}','${id(1)}','client'),('${id(4)}','${id(2)}','admin');
    insert into leads(id,email) values('${id(5)}','buyer@example.invalid'),('${id(6)}','testbuyer@example.invalid');
    insert into client_accounts values('${id(7)}','${id(1)}','${id(5)}'),('${id(8)}','${id(2)}','${id(6)}');
    insert into engagements values('${real}','${id(1)}','Synthetic real program','PRIVATE'),
      ('${id(9)}','${id(2)}','Synthetic test program','TEST');
    insert into projects values('${id(10)}','${real}','${id(7)}','${id(5)}'),('${id(11)}','${id(9)}','${id(8)}','${id(6)}');
    insert into participants values('${id(12)}','${id(1)}','${id(3)}','real@example.invalid'),
      ('${id(13)}','${id(2)}','${id(4)}','test@example.invalid');
    insert into engagement_participants values('${real}','${id(12)}'),('${id(9)}','${id(13)}');
    insert into batches values('${id(14)}','${real}'),('${id(15)}','${id(9)}');
    insert into tbos_missions values('${id(16)}','Shared mission');
    insert into tbos_behavioral_dimensions values('${id(17)}','Shared area');
    insert into tbos_teams values('${id(18)}','${real}','${id(1)}','${id(14)}','Real team'),
      ('${id(19)}','${id(9)}','${id(2)}','${id(15)}','Test team');
    -- The same staff identity in both programs must not protect the test program.
    insert into tbos_team_members values('${id(18)}','${id(3)}'),('${id(19)}','${id(3)}');
    insert into tbos_observations values('${id(20)}','${real}','${id(18)}','${id(16)}','Real notes'),
      ('${id(21)}','${id(9)}','${id(19)}','${id(16)}','Test notes');
    insert into tbos_observation_scores values('${id(20)}','${id(17)}',4),('${id(21)}','${id(17)}',2);
    insert into tbos_live_score_sessions values('${id(22)}','${real}','${id(14)}','paused'),('${id(23)}','${id(9)}','${id(15)}','ready');
    insert into tbos_live_score_audit_log values('${id(24)}','${id(22)}','{}'),('${id(25)}','${id(23)}','{}');
    insert into app_client_access_codes values('${id(26)}','${real}','${id(12)}','${id(3)}','real-hash'),
      ('${id(27)}','${id(9)}','${id(13)}','${id(4)}','test-hash');
    insert into program_modules values('${real}','tbos',true),('${id(9)}','tbos',true);
    insert into facilitator_team_scores values('${real}','tbos',4),('${id(9)}','tbos',2);
    insert into acquisition_prospects values('${id(28)}','${id(6)}');
    update leads set acquisition_prospect_id='${id(28)}' where id='${id(6)}';
    insert into inquiries values('${id(29)}','${id(5)}','buyer@example.invalid'),('${id(30)}','${id(6)}','testbuyer@example.invalid');
    insert into assessments values('${id(31)}','${id(5)}','{"email":"buyer@example.invalid"}'),('${id(32)}','${id(6)}','{"email":"testbuyer@example.invalid"}');
    insert into calendar_bookings values('${id(33)}','real@example.invalid'),('${id(34)}','testmeeting@example.invalid');
    insert into event_queue values('${id(35)}','{"metadata":{"teamId":"${id(18)}"}}'),
      ('${id(36)}','{"metadata":{"teamId":"${id(19)}"}}');
    insert into pe_participant_attempts values('${id(37)}','submitted');
    insert into pe_guest_contacts values('${id(37)}','individual@example.invalid');
    insert into catalog_modules values('${id(38)}','CEO module');
    insert into competency_dictionary values('${id(39)}','CEO competency');
    insert into pe_instrument_versions values('CEO','{"immutable":true}');
    insert into sales_follow_up_settings values(false);
    insert into generated_documents values('${id(40)}','Ambiguous document retained');
  `);return db;
}
async function rows(db:PGlite,table:string){return (await db.query(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`)).rows;}
async function execute(db:PGlite,sql=executeSql){return db.exec(sql);}
describe('selective owner-only UAT cleanup',()=>{
  it('previews exact counts without persistent changes or exposing row data',async()=>{
    const db=await fixture();try{
      const before=await rows(db,'engagements'),result=await execute(db,previewSql);
      const status=result.flatMap(r=>r.rows).find(r=>'mode' in r);
      expect(status).toMatchObject({mode:'PREVIEW_ONLY_NO_DATA_CHANGED',protected_program:real,archive_schema:null});
      expect(result.flatMap(r=>r.rows).find(r=>r.table_name==='tbos_teams')).toMatchObject({total_before:2,protected_rows:1,planned_delete:1,deleted_rows:0});
      expect(await rows(db,'engagements')).toEqual(before);
      expect(JSON.stringify(result)).not.toContain('Real notes');
      expect((await db.query("select to_regclass('binahub_uat_selective_archive_20261018.records') as t")).rows).toEqual([{t:null}]);
      const again=await execute(db,previewSql);
      expect(again.flatMap(r=>r.rows).find(r=>r.table_name==='tbos_teams')).toMatchObject({protected_rows:1,planned_delete:1});
    }finally{await db.close();}
  },30_000);
  it('deletes test records only, preserving real program, scores, access, CRM, accounts and all shared CEO/config tables',async()=>{
    const db=await fixture();try{
      const tables=['tbos_missions','tbos_behavioral_dimensions','catalog_modules','competency_dictionary','pe_instrument_versions','sales_follow_up_settings','auth.users','generated_documents'];
      const before=await Promise.all(tables.map(t=>rows(db,t)));
      const realSnapshots=await Promise.all(['engagements','tbos_teams','tbos_observations','app_client_access_codes','projects','leads'].map(t=>rows(db,t)));
      const result=await execute(db);
      expect(result.flatMap(r=>r.rows).find(r=>'mode' in r)).toMatchObject({mode:'EXECUTED',profiles_detached:1});
      expect(await Promise.all(tables.map(t=>rows(db,t)))).toEqual(before);
      for(const [n,table] of ['engagements','tbos_teams','tbos_observations','app_client_access_codes','projects','leads'].entries()){
        const remaining=await rows(db,table);expect(remaining).toHaveLength(1);expect(realSnapshots[n]).toContainEqual(remaining[0]);
      }
      for(const table of ['tbos_observation_scores','tbos_live_score_sessions','tbos_live_score_audit_log','tbos_team_members','facilitator_team_scores','event_queue','calendar_bookings'])expect(await rows(db,table)).toHaveLength(1);
      expect(await rows(db,'pe_participant_attempts')).toEqual([]);expect(await rows(db,'pe_guest_contacts')).toEqual([]);
      expect(await rows(db,'acquisition_prospects')).toEqual([]);
      expect((await db.query('select organization_id from profiles where id=$1',[id(3)])).rows).toEqual([{organization_id:id(1)}]);
      expect((await db.query('select organization_id,role from profiles where id=$1',[id(4)])).rows).toEqual([{organization_id:null,role:'admin'}]);
      expect((await db.query("select row_data->>'id' id from binahub_uat_selective_archive_20261018.records where table_name='engagements'")).rows).toEqual([{id:id(9)}]);
      for(const role of ['anon','authenticated','service_role'])expect((await db.query("select has_schema_privilege($1,'binahub_uat_selective_archive_20261018','usage') ok",[role])).rows).toEqual([{ok:false}]);
    }finally{await db.close();}
  },30_000);
  it('aborts on the wrong database or a missing real program before archiving or deleting',async()=>{
    const missing=new PGlite();try{
      await missing.exec('create table leads(id uuid);create table pe_participant_attempts(id uuid);create table organizations(id uuid);create table engagements(id uuid,organization_id uuid);');
      await expect(execute(missing)).rejects.toThrow('PROTECTED_REAL_PROGRAM_NOT_FOUND_STOP');await missing.exec('rollback');
      expect((await missing.query("select to_regclass('binahub_uat_selective_archive_20261018.records') as t")).rows).toEqual([{t:null}]);
    }finally{await missing.close();}
  },30_000);
  it('preserves an unknown protected FK dependant and its connected records instead of cascading it',async()=>{
    const db=await fixture();try{
      await db.exec(`create table protected_settings(lead_id uuid references leads(id) on delete cascade);insert into protected_settings values('${id(6)}');`);
      const before=await rows(db,'protected_settings');await execute(db);
      expect(await rows(db,'protected_settings')).toEqual(before);expect(await rows(db,'leads')).toHaveLength(2);
    }finally{await db.close();}
  },30_000);
  it('rolls back all changes and archive when an unexpected trigger modifies protected data',async()=>{
    const db=await fixture();try{
      await db.exec(`create function malicious_cleanup_trigger() returns trigger language plpgsql as $$ begin
        update tbos_teams set name='must rollback' where id='${id(18)}';return old;end;$$;
        create trigger malicious_cleanup after delete on leads for each row execute function malicious_cleanup_trigger();`);
      const before=await rows(db,'leads');
      await expect(execute(db)).rejects.toThrow('PROTECTED_DATA_CHANGED_ROLLBACK');await db.exec('rollback');
      expect(await rows(db,'leads')).toEqual(before);
      expect((await db.query('select name from tbos_teams where id=$1',[id(18)])).rows).toEqual([{name:'Real team'}]);
      expect((await db.query("select to_regclass('binahub_uat_selective_archive_20261018.records') as t")).rows).toEqual([{t:null}]);
    }finally{await db.close();}
  },30_000);
  it('rolls back an unrecognized live relation cycle without disabling constraints',async()=>{
    const db=await fixture();try{
      await db.exec(`alter table inquiries add column assessment_id uuid references assessments;
        update inquiries set assessment_id='${id(32)}' where id='${id(30)}';
        alter table assessments add column inquiry_id uuid references inquiries;
        update assessments set inquiry_id='${id(30)}' where id='${id(32)}';`);
      await expect(execute(db)).rejects.toThrow('UNRESOLVED_RELATION_OR_SIDE_EFFECT_ROLLBACK');await db.exec('rollback');
      expect(await rows(db,'engagements')).toHaveLength(2);expect(await rows(db,'leads')).toHaveLength(2);
    }finally{await db.close();}
  },30_000);
  it('does not allow browser/service roles to execute cleanup',async()=>{
    const db=await fixture();try{
      await db.exec('set role service_role');
      await expect(execute(db)).rejects.toThrow('CLEANUP_DATABASE_OWNER_REQUIRED');await db.exec('rollback;reset role');
      expect(await rows(db,'engagements')).toHaveLength(2);
    }finally{await db.close();}
  },30_000);
  it('retains a second program sharing the real organization instead of guessing it is safe to delete',async()=>{
    const db=await fixture();try{
      await db.exec(`insert into engagements values('${id(41)}','${id(1)}','Shared organization context','OTHER')`);
      await execute(db);expect(await rows(db,'engagements')).toHaveLength(2);
      expect((await db.query('select id from engagements where id=$1',[id(41)])).rows).toHaveLength(1);
    }finally{await db.close();}
  },30_000);
  it('does not overwrite a prior private archive on re-execution',async()=>{
    const db=await fixture();try{
      await execute(db);
      const before=await rows(db,'binahub_uat_selective_archive_20261018.records');
      await expect(execute(db)).rejects.toThrow('ARCHIVE_ALREADY_EXISTS_STOP_AND_REVIEW');await db.exec('rollback');
      expect(await rows(db,'binahub_uat_selective_archive_20261018.records')).toEqual(before);
    }finally{await db.close();}
  },30_000);
});
