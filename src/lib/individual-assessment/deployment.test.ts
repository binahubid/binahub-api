import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { preparePEDeployment,isOutsideRepository } from '../../../scripts/prepare-pe-deployment.mjs';
import { hashPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';

describe('local private seed generation',()=>{
  it('rejects repository descendants including a misleading double-dot directory',()=>{
    const repo=resolve('fixture-public-repo');
    expect(isOutsideRepository(repo,repo)).toBe(false);
    expect(isOutsideRepository(repo,resolve(repo,'private.sql'))).toBe(false);
    expect(isOutsideRepository(repo,resolve(repo,'..misleading','private.sql'))).toBe(false);
    expect(isOutsideRepository(repo,resolve(repo,'..','private.sql'))).toBe(true);
  });
  it('combines schema and source atomically without embedding source in the tracked migration',()=>{
    const bundle=makeSyntheticPEInstrument();
    const schema=readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8');
    const result=preparePEDeployment(bundle,schema);
    expect(result).toContain('PRIVATE CEO INSTRUMENT');
    expect(result).toContain(hashPEInstrument(bundle));
    expect(result.split(/^commit;$/m)).toHaveLength(2);
    expect(result.trimEnd().endsWith('commit;')).toBe(true);
    expect(schema).not.toContain('Synthetic scenario');
    expect(result).toContain('Synthetic scenario');
    expect(()=>preparePEDeployment({...bundle,metadata:{...bundle.metadata,public_enabled:true}},schema)).toThrow();
    expect(()=>preparePEDeployment(bundle,'not a transaction')).toThrow();
  });
});
