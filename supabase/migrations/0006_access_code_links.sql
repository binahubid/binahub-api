ALTER TABLE IF EXISTS public.app_client_access_codes
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_access_codes_organization ON public.app_client_access_codes(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_codes_participant ON public.app_client_access_codes(participant_id);

UPDATE public.app_client_access_codes
SET organization_id = (
  SELECT id FROM public.organizations
  WHERE name = app_client_access_codes.company_name
  LIMIT 1
)
WHERE organization_id IS NULL;

UPDATE public.app_client_access_codes ac
SET participant_id = (
  SELECT p.id FROM public.participants p
  WHERE p.organization_id = ac.organization_id
  AND LOWER(p.name) LIKE '%' || LOWER(ac.team_name) || '%'
  LIMIT 1
)
WHERE participant_id IS NULL AND organization_id IS NOT NULL;
