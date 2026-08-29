-- Phase 6 release reconciliation.
-- The free public BinaInsight assessment is a real published module and must
-- not expose a mock catalog version. Commercial modules remain untouched.

begin;

update public.catalog_products
set status = 'ready',
    updated_at = now()
where product_key = 'binainsight'
  and status <> 'retired';

update public.catalog_modules
set catalog_version = 'v1.0-public',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'publicRelease', true,
      'pricingKind', 'free',
      'reconciledAt', now()
    ),
    updated_at = now()
where module_code = 'BI-PUBLIC'
  and is_mock = false
  and readiness_status = 'ready'
  and active;

do $$
begin
  if not exists (
    select 1
    from public.catalog_modules module
    join public.catalog_products product on product.id = module.product_id
    where module.module_code = 'BI-PUBLIC'
      and module.is_mock = false
      and module.readiness_status = 'ready'
      and module.active
      and module.catalog_version = 'v1.0-public'
      and product.product_key = 'binainsight'
      and product.status = 'ready'
  ) then
    raise exception 'BINAINSIGHT_PUBLIC_CATALOG_RECONCILIATION_FAILED';
  end if;
end;
$$;

comment on table public.catalog_modules is
  'Module-level catalog. Only active, ready, non-mock modules under ready products may be published.';

commit;
