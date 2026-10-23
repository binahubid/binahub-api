-- SELECTIVE UAT CLEANUP v2, 2026-10-18. Run the WHOLE file as database owner.
-- Default is PREVIEW ONLY: no persistent archive, UPDATE or DELETE.
-- After reviewing preview and taking a provider backup, change ONLY false below to true.
-- Maintenance required: pause workers/schedulers and submissions while executing.
-- Preserves the real program and connected records; ambiguous relations are retained.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='300s';
set local row_security=off;
set local binahub.cleanup_execute='false';

create temporary table cleanup_tables(
  relation oid primary key, schema_name text not null, table_name text not null,
  fields text[] not null, in_scope boolean not null
) on commit drop;
create temporary table cleanup_rows(
  row_number bigint generated always as identity primary key,
  relation oid not null, row_key jsonb not null, row_data jsonb not null,
  keep boolean not null default false
) on commit drop;
create index on cleanup_rows(relation);
create temporary table cleanup_ids(value text primary key) on commit drop;
create temporary table cleanup_emails(value text primary key) on commit drop;
create temporary table cleanup_mentions(row_number bigint,value text,primary key(row_number,value)) on commit drop;
create index on cleanup_mentions(value);
create temporary table cleanup_summary(
  table_name text, total_before bigint, protected_rows bigint, planned_delete bigint,
  deleted_rows bigint default 0
) on commit drop;
create temporary table cleanup_status(mode text,protected_program uuid,archive_schema text,profiles_detached bigint) on commit drop;

create or replace function pg_temp.cleanup_key(row_data jsonb,fields text[]) returns jsonb
language sql immutable as $$
  select case when cardinality(fields)=0 then row_data else
    (select jsonb_object_agg(field,row_data->field) from unnest(fields) field) end;
$$;

do $$
declare
  protected_program constant uuid:='d1ea232f-2038-4cfd-8c26-59caf4eaf760';
  archive_name constant text:='binahub_uat_selective_archive_20261018';
  execute_cleanup boolean:=current_setting('binahub.cleanup_execute')='true';
  scope_names text[]:=array[
    'leads','assessments','assessment_jobs','inquiries','calendar_bookings',
    'opportunity_activities','email_failures','follow_up_claims','follow_up_events',
    'prospect_import_batches','acquisition_prospects','acquisition_events','outbound_campaign_links','outbound_campaign_clicks',
    'outbound_email_jobs','outbound_email_deliveries','inbound_journeys','inbound_journey_events','inbound_lead_journeys','inbound_catalog_interests',
    'lead_discovery_candidates','lead_discovery_runs','client_accounts','client_stakeholders','client_activities',
    'retention_opportunities','account_health_reviews','project_milestones','projects','project_roles','project_assignments',
    'smart_actions','operational_tasks','operational_task_events','organizations','batches','engagements','participants',
    'engagement_participants','engagement_facilitators','evidence','capability_evidence','participant_capabilities','actions',
    'reflections','insights','outcomes','event_queue','proposal_approvals',
    'program_modules','program_staff_assignments','program_questionnaires','program_questionnaire_questions','program_questionnaire_submissions',
    'facilitator_program_assignments','facilitator_missions','facilitator_team_scores','tbos_teams','tbos_team_members',
    'tbos_program_competencies','tbos_program_configurations','tbos_observations',
    'tbos_observation_members','tbos_observation_scores','tbos_observation_audit_log','tbos_live_score_sessions','tbos_live_score_audit_log',
    'lep_responses','lep_speaker_ratings','lep_speakers','binaimpact_level1_evaluations','home_quiz_results','chat_sessions',
    'coach_assignments','coach_sessions','app_client_access_codes',
    'pe_attempts','pe_audit_events','pe_participant_attempts','pe_participant_events','pe_review_permissions','pe_pilot_feedback',
    'pe_guest_contacts','pe_email_links','pe_result_sessions','pe_report_snapshots','pe_report_email_jobs','pe_delivery_events','pe_consultation_requests',
    'pe_commerce_orders','pe_commerce_payment_attempts','pe_commerce_payment_events','pe_commerce_entitlements','pe_commerce_outbox','pe_commerce_customers'
  ];
  related_fields text[]:=array['id','program_id','programId','engagement_id','engagementId','organization_id','organizationId',
    'lead_id','leadId','source_lead_id','client_account_id','project_id','source_project_id','participant_id',
    'team_id','batch_id','observation_id','session_id','questionnaire_id','attempt_id','assessment_id','inquiry_id',
    'job_id','link_id','target_id','aggregate_id','input_id','output_id','entity_id','retention_opportunity_id'];
  tbl record; edge record; predicate text; blockers text; changed bigint; pass_changes bigint;
  removed bigint; total_removed bigint:=0; detached bigint:=0; mismatch boolean; round int:=0;
  profile_relation oid:=to_regclass('public.profiles');
begin
  if to_regclass('public.engagements') is null or to_regclass('public.leads') is null
    or to_regclass('public.pe_participant_attempts') is null then raise exception 'WRONG_DATABASE_OR_SETUP';end if;
  if current_user in ('anon','authenticated','service_role') or not pg_has_role(current_user,
    (select relowner from pg_class where oid='public.engagements'::regclass),'USAGE') then raise exception 'CLEANUP_DATABASE_OWNER_REQUIRED';end if;

  -- Discover the ACTUAL schema and FK graph; do not guess deletion order.
  insert into cleanup_tables
  select c.oid,n.nspname,c.relname,
    coalesce((select array_agg(a.attname::text order by k.position) from pg_constraint p,
      unnest(p.conkey) with ordinality k(attnum,position) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
      where p.conrelid=c.oid and p.contype='p'),'{}'::text[]),
    n.nspname='public' and c.relname=any(scope_names)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and (n.nspname='public' or (n.nspname='auth' and c.relname='users'));
  if exists(select 1 from pg_inherits i join cleanup_tables t on t.relation=i.inhrelid or t.relation=i.inhparent)
    then raise exception 'PARTITIONED_OR_INHERITED_SCHEMA_REQUIRES_REVIEW';end if;
  -- Preview uses a consistent snapshot without blocking normal program writes.
  -- Execution freezes global tables too; maintenance must stop ongoing workers first.
  for tbl in select * from cleanup_tables order by schema_name,table_name loop
    if execute_cleanup then execute format('lock table %I.%I in access exclusive mode',tbl.schema_name,tbl.table_name);end if;
    execute format('insert into cleanup_rows(relation,row_key,row_data) select %s,pg_temp.cleanup_key(to_jsonb(t),%L::text[]),to_jsonb(t) from %I.%I t',
      tbl.relation,tbl.fields,tbl.schema_name,tbl.table_name);
  end loop;
  if not exists(select 1 from cleanup_rows where relation='public.engagements'::regclass and row_data->>'id'=protected_program::text
    and nullif(row_data->>'organization_id','') is not null) then raise exception 'PROTECTED_REAL_PROGRAM_NOT_FOUND_STOP';end if;

  insert into cleanup_ids values(protected_program::text);
  insert into cleanup_mentions
    select r.row_number,lower(m.value[1]) from cleanup_rows r join cleanup_tables t on t.relation=r.relation and t.in_scope
      cross join lateral regexp_matches(r.row_data::text,'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}','g') m(value)
    on conflict do nothing;

  -- Unknown/off-scope children are preserved, including their referenced scope rows.
  -- Only the known nullable test-organization link on profiles may be detached.
  for edge in select c.* from pg_constraint c
    join cleanup_tables child on child.relation=c.conrelid and not child.in_scope
    join cleanup_tables parent on parent.relation=c.confrelid and parent.in_scope
    where c.contype='f' loop
    if edge.conrelid=profile_relation and edge.confrelid='public.organizations'::regclass
      and array(select attname::text from pg_attribute where attrelid=edge.conrelid and attnum=any(edge.conkey))=array['organization_id'] then continue;end if;
    select string_agg(format('c.row_data->%L is not null and c.row_data->%L<>''null''::jsonb and c.row_data->%L=p.row_data->%L',ca.attname,ca.attname,ca.attname,pa.attname),' and ')
      into predicate from unnest(edge.conkey,edge.confkey) k(ck,pk)
      join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=k.ck
      join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=k.pk;
    execute format('update cleanup_rows p set keep=true from cleanup_rows c where p.relation=%s and c.relation=%s and %s',edge.confrelid,edge.conrelid,predicate);
  end loop;

  loop
    round:=round+1;if round>200 then raise exception 'PROTECTION_CLOSURE_LIMIT_STOP';end if;
    pass_changes:=0;
    update cleanup_rows r set keep=true where not keep and exists(select 1 from cleanup_mentions m join cleanup_ids i using(value) where m.row_number=r.row_number);
    get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    update cleanup_rows r set keep=true from cleanup_tables t where t.relation=r.relation and t.in_scope and not r.keep
      and exists(select 1 from cleanup_emails e where e.value=lower(btrim(r.row_data->>'email')) or e.value=lower(btrim(r.row_data->>'attendee_email'))
        or e.value=lower(btrim(r.row_data->>'contact_email')) or e.value=lower(btrim(r.row_data->'form_data'->>'email')));
    get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    for edge in select c.* from pg_constraint c
      join cleanup_tables child on child.relation=c.conrelid and child.in_scope
      join cleanup_tables parent on parent.relation=c.confrelid and parent.in_scope where c.contype='f' loop
      select string_agg(format('c.row_data->%L is not null and c.row_data->%L<>''null''::jsonb and c.row_data->%L=p.row_data->%L',ca.attname,ca.attname,ca.attname,pa.attname),' and ')
        into predicate from unnest(edge.conkey,edge.confkey) k(ck,pk)
        join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=k.ck
        join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=k.pk;
      execute format('update cleanup_rows c set keep=true from cleanup_rows p where c.relation=%s and p.relation=%s and not c.keep and p.keep and %s',edge.conrelid,edge.confrelid,predicate);
      get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
      execute format('update cleanup_rows p set keep=true from cleanup_rows c where c.relation=%s and p.relation=%s and c.keep and not p.keep and %s',edge.conrelid,edge.confrelid,predicate);
      get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    end loop;
    -- Shared staff, catalog and mission IDs never seed unrelated records.
    insert into cleanup_ids select distinct lower(e.value) from cleanup_rows r
      join cleanup_tables t on t.relation=r.relation and t.in_scope
      cross join lateral jsonb_each_text(r.row_data) e where r.keep and e.key=any(related_fields)
      and e.value~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' on conflict do nothing;
    get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    insert into cleanup_emails select distinct lower(btrim(e.value)) from cleanup_rows r
      join cleanup_tables t on t.relation=r.relation and t.in_scope
      cross join lateral jsonb_each_text(r.row_data) e where r.keep and e.key in ('email','contact_email','attendee_email')
      and e.value like '%@%' on conflict do nothing;
    get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    insert into cleanup_emails select distinct lower(btrim(r.row_data->'form_data'->>'email')) from cleanup_rows r
      join cleanup_tables t on t.relation=r.relation and t.in_scope where r.keep
      and r.row_data->'form_data'->>'email' like '%@%' on conflict do nothing;
    get diagnostics changed=row_count;pass_changes:=pass_changes+changed;
    exit when pass_changes=0;
  end loop;
  insert into cleanup_summary(table_name,total_before,protected_rows,planned_delete)
    select t.table_name,count(r.row_number),count(r.row_number) filter(where r.keep),count(r.row_number) filter(where not r.keep)
      from cleanup_tables t left join cleanup_rows r on r.relation=t.relation where t.in_scope group by t.table_name;
  insert into cleanup_status values(case when execute_cleanup then 'EXECUTED' else 'PREVIEW_ONLY_NO_DATA_CHANGED' end,protected_program,
    case when execute_cleanup then archive_name else null end,0);
  if not execute_cleanup then return;end if;

  if exists(select 1 from pg_namespace where nspname=archive_name) then raise exception 'ARCHIVE_ALREADY_EXISTS_STOP_AND_REVIEW';end if;
  execute format('create schema %I',archive_name);
  execute format('revoke all on schema %I from public,anon,authenticated,service_role',archive_name);
  execute format('create table %I.records(table_name text not null,row_data jsonb not null)',archive_name);
  execute format('revoke all on %I.records from public,anon,authenticated,service_role',archive_name);
  execute format('insert into %I.records select t.table_name,r.row_data from cleanup_rows r join cleanup_tables t on t.relation=r.relation where t.in_scope and not r.keep',archive_name);

  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='organization_id') then
    execute format('insert into %I.records select ''profiles'',to_jsonb(p) from public.profiles p where exists(select 1 from cleanup_rows r where r.relation=''public.organizations''::regclass and not r.keep and r.row_data->>''id''=p.organization_id::text)',archive_name);
    -- Expected account change is ONLY the approved nullable test-organization link.
    update cleanup_rows p set row_data=jsonb_set(p.row_data,'{organization_id}','null') where p.relation=profile_relation
      and exists(select 1 from cleanup_rows o where o.relation='public.organizations'::regclass and not o.keep and o.row_data->>'id'=p.row_data->>'organization_id');
    update public.profiles p set organization_id=null where exists(select 1 from cleanup_rows o
      where o.relation='public.organizations'::regclass and not o.keep and o.row_data->>'id'=p.organization_id::text);
    get diagnostics detached=row_count;update cleanup_status set profiles_detached=detached;
  end if;
  -- Known nullable import cycle; real leads remain byte-for-byte unchanged.
  for tbl in select a.attname,c.fields from pg_attribute a join cleanup_tables c on c.relation=a.attrelid
    where a.attrelid='public.leads'::regclass and a.attname in ('acquisition_batch_id','acquisition_prospect_id') and not a.attnotnull loop
    execute format('update public.leads t set %I=null where %I is not null and exists(select 1 from cleanup_rows r where r.relation=''public.leads''::regclass and not r.keep and r.row_key=pg_temp.cleanup_key(to_jsonb(t),%L::text[]))',tbl.attname,tbl.attname,tbl.fields);
  end loop;

  -- Explicit planned rows only, leaves first. No TRUNCATE/CASCADE or disabled FKs/triggers.
  loop
    pass_changes:=0;
    for tbl in select * from cleanup_tables where in_scope order by table_name loop
      blockers:='';
      for edge in select * from pg_constraint where contype='f' and confrelid=tbl.relation and conrelid<>confrelid loop
        select string_agg(format('c.%I=t.%I',ca.attname,pa.attname),' and ') into predicate
          from unnest(edge.conkey,edge.confkey) k(ck,pk)
          join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=k.ck
          join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=k.pk;
        blockers:=blockers||format(' and not exists(select 1 from %s c where %s)',edge.conrelid::regclass,predicate);
      end loop;
      execute format('delete from %I.%I t where exists(select 1 from cleanup_rows r where r.relation=%s and not r.keep and r.row_key=pg_temp.cleanup_key(to_jsonb(t),%L::text[])) %s',tbl.schema_name,tbl.table_name,tbl.relation,tbl.fields,blockers);
      get diagnostics removed=row_count;pass_changes:=pass_changes+removed;total_removed:=total_removed+removed;
      update cleanup_summary set deleted_rows=deleted_rows+removed where table_name=tbl.table_name;
    end loop;
    exit when pass_changes=0;
  end loop;
  if exists(select 1 from cleanup_summary where planned_delete<>deleted_rows) then raise exception 'UNRESOLVED_RELATION_OR_SIDE_EFFECT_ROLLBACK';end if;

  -- Exact multiset check: protected/global rows and auth accounts cannot change.
  -- Trigger side effects or unexpected new rows cause a COMPLETE rollback.
  for tbl in select * from cleanup_tables loop
    execute format('select exists((select to_jsonb(t) from %I.%I t except all select row_data from cleanup_rows where relation=%s and (%L=false or keep)) union all (select row_data from cleanup_rows where relation=%s and (%L=false or keep) except all select to_jsonb(t) from %I.%I t))',
      tbl.schema_name,tbl.table_name,tbl.relation,tbl.in_scope,tbl.relation,tbl.in_scope,tbl.schema_name,tbl.table_name) into mismatch;
    if mismatch then raise exception 'PROTECTED_DATA_CHANGED_ROLLBACK: %.%',tbl.schema_name,tbl.table_name;end if;
  end loop;
  raise notice 'Selective cleanup complete: % test rows deleted; real program protected; % profile test-org links detached.',total_removed,detached;
end; $$;

-- Count-only output: no identities, answers, program access codes or credentials.
select * from cleanup_status;
select * from cleanup_summary order by table_name;
drop function pg_temp.cleanup_key(jsonb,text[]);
commit;
