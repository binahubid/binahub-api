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
  const json=JSON.stringify(bundle);
  const sha=createHash('sha256').update(canonical(bundle)).digest('hex');
  // A digest-based delimiter cannot be influenced by question punctuation.
  const delimiter='$pe_private_'+sha+'$';
  if(json.includes(delimiter))throw new Error('PE_PRIVATE_DELIMITER_CONFLICT');
  if(!schema.trimEnd().endsWith('commit;'))throw new Error('PE_SCHEMA_TRANSACTION_REQUIRED');
  return schema.trimEnd().slice(0,-'commit;'.length)
    +'\n-- PRIVATE CEO INSTRUMENT. DO NOT COMMIT, UPLOAD PUBLICLY OR COPY INTO LOGS.\n'
    +'select public.pe_register_draft_instrument_v1('+delimiter+json+delimiter+"::jsonb,'"+sha+"');\ncommit;\n";
}

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
