-- Remove obsolete catalog fixtures without touching the public BinaInsight assessment.
begin;

delete from public.catalog_modules
where module_code <> 'BI-PUBLIC'
  and (
    is_mock = true
    or module_code = 'UAT-P16-MOD-01'
    or catalog_version = 'v0.0-uat'
  );

-- The UAT product was created only as the parent of UAT-P16-MOD-01.
-- Delete it only when it is now empty, so this remains safe if reused later.
delete from public.catalog_products product
where product.product_key = 'uat_p16_20260904'
  and not exists (
    select 1
    from public.catalog_modules module
    where module.product_id = product.id
  );

commit;
