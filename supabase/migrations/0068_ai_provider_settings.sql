-- Shared AI routing. No credentials or prompts are stored here.
begin;
create table if not exists public.ai_provider_settings (
  id boolean primary key default true check(id),
  primary_provider text check(primary_provider in ('lapakvip','codecraft','openrouter')),
  enabled_providers text[] not null default '{}',
  version integer not null default 0 check(version>=0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check(enabled_providers <@ array['lapakvip','codecraft','openrouter']::text[]),
  check((version=0 and primary_provider is null and cardinality(enabled_providers)=0)
    or (version>0 and primary_provider is not null and primary_provider=any(enabled_providers)))
);
insert into public.ai_provider_settings(id) values(true) on conflict(id) do nothing;
create table if not exists public.ai_provider_settings_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  previous_policy jsonb not null,
  next_policy jsonb not null,
  created_at timestamptz not null default now()
);
create or replace function public.save_ai_provider_settings(
  p_primary text, p_enabled text[], p_version integer, p_actor uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.ai_provider_settings; saved public.ai_provider_settings;
begin
  if p_actor is null or p_version is null or p_version<0 or p_primary is null
    or p_primary not in ('lapakvip','codecraft','openrouter') or p_enabled is null
    or cardinality(p_enabled) not between 1 and 3 or array_position(p_enabled,null) is not null
    or not(p_enabled <@ array['lapakvip','codecraft','openrouter']::text[])
    or not(p_primary=any(p_enabled))
    or cardinality(p_enabled)<>(select count(distinct value) from unnest(p_enabled) value)
  then raise exception 'AI_SETTINGS_INVALID'; end if;
  select * into strict previous from public.ai_provider_settings where id=true for update;
  if previous.version<>p_version then raise exception 'AI_SETTINGS_CONFLICT'; end if;
  update public.ai_provider_settings set primary_provider=p_primary,enabled_providers=p_enabled,
    version=version+1,updated_by=p_actor,updated_at=now() where id=true returning * into saved;
  insert into public.ai_provider_settings_audit(actor_id,previous_policy,next_policy)
    values(p_actor,to_jsonb(previous),to_jsonb(saved));
  return to_jsonb(saved)-'updated_by';
end; $$;
alter table public.ai_provider_settings enable row level security;
alter table public.ai_provider_settings_audit enable row level security;
revoke all on public.ai_provider_settings,public.ai_provider_settings_audit from public,anon,authenticated,service_role;
grant select on public.ai_provider_settings,public.ai_provider_settings_audit to service_role;
revoke all on function public.save_ai_provider_settings(text,text[],integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_ai_provider_settings(text,text[],integer,uuid) to service_role;
commit;
