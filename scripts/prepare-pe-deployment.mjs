import { readFileSync,writeFileSync,mkdirSync,realpathSync } from 'node:fs';
import { dirname,resolve,relative,isAbsolute,sep,basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Local-only artifact generator. Never prints source items or answer keys.
// Full structural validation also runs in the database-admin registration function.
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en'))
    .map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export function preparePEDeployment(bundle,schema) {
  if(bundle?.config?.assessment?.id!=='BINAINSIGHTS-PE-V1'||bundle?.metadata?.public_enabled!==false
    ||bundle?.metadata?.release_status!=='draft')throw new Error('PE_PRIVATE_BUNDLE_INVALID');
  if(bundle?.metadata?.instrument_version!=='1.0.0-draft.1')throw new Error('PE_PRIVATE_BUNDLE_VERSION_REQUIRED');
  const json=JSON.stringify(bundle);
  const sha=createHash('sha256').update(canonical(bundle)).digest('hex');
  // A digest-based delimiter cannot be influenced by question punctuation.
  const delimiter='$pe_private_'+sha+'$';
  if(json.includes(delimiter))throw new Error('PE_PRIVATE_DELIMITER_CONFLICT');
  if(!schema.trimEnd().endsWith('commit;'))throw new Error('PE_SCHEMA_TRANSACTION_REQUIRED');
  const body=schema.trimEnd().slice(0,-'commit;'.length)
    .replace(/^-- PE_SCHEMA_ONLY_BEGIN[\s\S]*?-- PE_SCHEMA_ONLY_END\r?\n/,'')
    .replace(/-- PE_SCHEMA_ONLY_STATUS_BEGIN[\s\S]*?-- PE_SCHEMA_ONLY_STATUS_END\r?\n/,'');
  return PRIVATE_INSTALL_HEADER+body
    +'\n-- PRIVATE CEO INSTRUMENT. DO NOT COMMIT, UPLOAD PUBLICLY OR COPY INTO LOGS.\n'
    +'select public.pe_register_draft_instrument_v1('+delimiter+json+delimiter+"::jsonb,'"+sha+"');\n"
    +PRIVATE_INSTALL_VERIFICATION+'commit;\n';
}

export const PRIVATE_INSTALL_HEADER=`-- SQL 64 COMPLETE PRIVATE INSTALLATION - updated 2026-10-13.
-- Run ALL contents in Supabase SQL Editor as a database administrator, after SQL 63.
-- Includes the schema AND the CEO instrument BINAINSIGHTS-PE-V1 / 1.0.0-draft.1.
-- After success, run SQL 65 in the SAME Supabase project used by the API.
-- Reapplying the same source preserves attempts, results and existing mapping reviews.
-- A different source with the same version is rejected; do not change the CEO payload.
-- PRIVATE: DO NOT upload to GitHub, publish, or paste contents into logs.
`;

export const PRIVATE_INSTALL_VERIFICATION=`
-- Verify the complete installation before committing. Never return the private manifest.
do $$ declare v_manifest jsonb; begin
  select manifest into v_manifest from public.pe_instrument_versions
    where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1';
  if not found then raise exception 'PE_PRIVATE_SOURCE_REQUIRED'; end if;
  if jsonb_array_length(v_manifest->'config'->'competencies') is distinct from 6
    or jsonb_array_length(v_manifest->'config'->'self_report_items') is distinct from 24
    or jsonb_array_length(v_manifest->'config'->'sjt_items') is distinct from 12
    or (select count(*) from public.pe_catalog_crosswalks
      where instrument_id='BINAINSIGHTS-PE-V1' and instrument_version='1.0.0-draft.1')<>6 then
    raise exception 'PE_PRIVATE_INSTALL_INCOMPLETE';
  end if;
end; $$;
select instrument_id,version,
  jsonb_array_length(manifest->'config'->'competencies') as competency_count,
  jsonb_array_length(manifest->'config'->'self_report_items') as self_report_question_count,
  jsonb_array_length(manifest->'config'->'sjt_items') as scenario_question_count,
  (select count(*) from public.pe_catalog_crosswalks
    where instrument_id='BINAINSIGHTS-PE-V1' and instrument_version='1.0.0-draft.1') as catalog_mapping_count
from public.pe_instrument_versions
where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1';
`;

export function isOutsideRepository(repo,target) {
  const position=relative(repo,target);
  return position==='..'||position.startsWith('..'+sep)||isAbsolute(position);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [input,output]=process.argv.slice(2);
    if(!input||!output)throw new Error('Usage: node scripts/prepare-pe-deployment.mjs <private-bundle.json> <outside-repo.private.sql>');
    const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
    const target=resolve(output);
    if(!isOutsideRepository(realpathSync(repo),target))throw new Error('PE_OUTPUT_MUST_BE_OUTSIDE_PUBLIC_REPOSITORY');
    if(!target.endsWith('.private.sql'))throw new Error('PE_OUTPUT_MUST_USE_PRIVATE_SQL_SUFFIX');
    mkdirSync(dirname(target),{recursive:true});
    // Check resolved parent as well: a symlink/junction must not bypass the repository boundary.
    const actual=resolve(realpathSync(dirname(target)),basename(target));
    if(!isOutsideRepository(realpathSync(repo),actual))throw new Error('PE_OUTPUT_MUST_BE_OUTSIDE_PUBLIC_REPOSITORY');
    const bundle=JSON.parse(readFileSync(input,'utf8'));
    const schema=readFileSync(resolve(repo,'supabase/migrations/0064_personal_effectiveness_foundation.sql'),'utf8');
    writeFileSync(target,preparePEDeployment(bundle,schema),{flag:'wx'}); // Never overwrite an existing seed.
    console.log('Private SQL prepared outside repository. Schema + instrument install in one transaction.');
  }catch(error){
    // JSON/IO errors may contain source snippets or private paths. Do not echo them.
    const message=error instanceof Error?error.message:'';
    console.error(/^PE_[A-Z_]+$/.test(message)||message.startsWith('Usage:')?message:'PE_PRIVATE_DEPLOYMENT_PREPARATION_FAILED');
    process.exitCode=1;
  }
}
