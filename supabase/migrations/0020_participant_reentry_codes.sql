begin;

alter table public.engagements
  add column if not exists participant_limit integer not null default 100;

alter table public.engagements
  drop constraint if exists engagements_participant_limit_check;
alter table public.engagements
  add constraint engagements_participant_limit_check
  check (participant_limit between 1 and 5000);

alter table public.app_client_access_codes
  add column if not exists participant_code_hint text,
  add column if not exists participant_code_issued_at timestamptz,
  add column if not exists participant_code_rotated_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists credential_version integer not null default 1,
  add column if not exists registration_device_hash text,
  add column if not exists registration_ip_hash text,
  add column if not exists identity_review_required boolean not null default false,
  add column if not exists identity_review_note text;

alter table public.app_client_access_codes
  drop constraint if exists app_client_access_codes_credential_version_check;
alter table public.app_client_access_codes
  add constraint app_client_access_codes_credential_version_check
  check (credential_version >= 1);

create unique index if not exists app_client_access_codes_program_device_unique
  on public.app_client_access_codes(program_id, registration_device_hash)
  where program_id is not null and registration_device_hash is not null;

create unique index if not exists app_client_access_codes_participant_code_unique
  on public.app_client_access_codes(code_hash)
  where participant_code_hint is not null;

create index if not exists app_client_access_codes_program_identity_review_idx
  on public.app_client_access_codes(program_id, identity_review_required)
  where identity_review_required;

create or replace function public.register_program_participant(
  p_program_id uuid,
  p_display_name text,
  p_code_hash text,
  p_code_hint text,
  p_expires_at timestamptz,
  p_device_hash text,
  p_ip_hash text,
  p_identity_review_required boolean,
  p_identity_review_note text
)
returns table (
  access_id uuid,
  participant_id uuid,
  company_name text,
  organization_id uuid,
  program_id uuid,
  expires_at timestamptz,
  credential_version integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program public.engagements%rowtype;
  v_participant_id uuid;
  v_access_id uuid;
  v_company_name text;
begin
  if p_display_name is null or char_length(btrim(p_display_name)) < 2 then
    raise exception using errcode = 'P0001', message = 'Nama peserta tidak valid.';
  end if;

  select * into v_program
  from public.engagements engagement
  where engagement.id = p_program_id
  for update;

  if v_program.id is null or v_program.status not in ('active', 'in_progress', 'review') then
    raise exception using errcode = 'P0001', message = 'Program tidak sedang menerima pendaftaran peserta.';
  end if;

  if (select count(*) from public.engagement_participants membership where membership.engagement_id = p_program_id) >= v_program.participant_limit then
    raise exception using errcode = 'P0001', message = 'Kapasitas peserta program sudah penuh.';
  end if;

  if exists (
    select 1 from public.app_client_access_codes access_code
    where access_code.program_id = p_program_id
      and lower(regexp_replace(btrim(access_code.team_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'))
  ) then
    raise exception using errcode = 'P0001', message = 'Nama tersebut sudah terdaftar. Gunakan kode peserta untuk masuk kembali.';
  end if;

  if exists (
    select 1 from public.app_client_access_codes access_code
    where access_code.program_id = p_program_id
      and access_code.registration_device_hash = p_device_hash
  ) then
    raise exception using errcode = 'P0001', message = 'Perangkat ini sudah digunakan untuk mendaftarkan peserta pada program.';
  end if;

  select organization.name into v_company_name
  from public.organizations organization
  where organization.id = v_program.organization_id;
  if v_company_name is null then
    raise exception using errcode = 'P0001', message = 'Organisasi program tidak ditemukan.';
  end if;

  insert into public.participants (organization_id, name)
  values (v_program.organization_id, regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'))
  returning id into v_participant_id;

  insert into public.engagement_participants (engagement_id, participant_id, role)
  values (p_program_id, v_participant_id, 'participant');

  insert into public.app_client_access_codes (
    company_name, team_name, code_hash, is_active, organization_id,
    participant_id, program_id, expires_at, participant_code_hint,
    participant_code_issued_at, credential_version, registration_device_hash,
    registration_ip_hash, identity_review_required, identity_review_note
  ) values (
    v_company_name, regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'), p_code_hash, true, v_program.organization_id,
    v_participant_id, p_program_id, p_expires_at, p_code_hint,
    now(), 1, p_device_hash, p_ip_hash, coalesce(p_identity_review_required, false), p_identity_review_note
  ) returning id into v_access_id;

  return query select v_access_id, v_participant_id, v_company_name, v_program.organization_id, p_program_id, p_expires_at, 1;
end;
$$;

revoke all on function public.register_program_participant(uuid,text,text,text,timestamptz,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.register_program_participant(uuid,text,text,text,timestamptz,text,text,boolean,text) to service_role;

revoke all on table public.app_client_access_codes from public, anon, authenticated;
grant select, insert, update, delete on table public.app_client_access_codes to service_role;

commit;
