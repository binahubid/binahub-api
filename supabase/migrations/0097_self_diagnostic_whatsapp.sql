begin;

alter table public.pe_guest_contacts
  add column if not exists whatsapp text check (whatsapp ~ '^[+][1-9][0-9]{7,14}$');

-- A retry with the same verified draft preserves the same contact details.
create or replace function public.pe_start_guest_with_whatsapp(
  p_id uuid, p_hash text, p_name text, p_email text, p_context jsonb,
  p_consent_version text, p_privacy_version text, p_sharing_version text, p_channel text, p_whatsapp text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  envelope jsonb;
begin
  if p_whatsapp is null or p_whatsapp !~ '^[+][1-9][0-9]{7,14}$' then
    raise exception 'PE_INVALID_REQUEST';
  end if;
  envelope := public.pe_start_guest(
    p_id,p_hash,p_name,p_email,p_context,p_consent_version,p_privacy_version,p_sharing_version,p_channel
  );
  update public.pe_guest_contacts
  set whatsapp = p_whatsapp
  where attempt_id = p_id and draft_hash = p_hash and (whatsapp is null or whatsapp = p_whatsapp);
  if not found then raise exception 'PE_START_CONFLICT'; end if;
  return envelope;
end;
$$;

revoke all on function public.pe_start_guest_with_whatsapp(uuid,text,text,text,jsonb,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.pe_start_guest_with_whatsapp(uuid,text,text,text,jsonb,text,text,text,text,text)
  to service_role;

commit;
