import type { SupabaseClient } from '@supabase/supabase-js';
import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { getPEParticipantDefinition,hashPEInstrument,loadPEInstrument,readPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';

function database(data:unknown,error:unknown=null) {
  const maybeSingle=vi.fn().mockResolvedValue({data,error});
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle};
  const from=vi.fn().mockReturnValue(query);
  return {client:{from} as unknown as Pick<SupabaseClient,'from'>,from,query};
}
describe('private database instrument registry',()=>{
  it('verifies the snapshot hash/version/structure and never loads a source JSON from Git',async()=>{
    const manifest=makeSyntheticPEInstrument();
    const {client,from,query}=database({manifest,bundle_sha256:hashPEInstrument(manifest)});
    const loaded=await loadPEInstrument(client);
    expect(loaded).toEqual(manifest);
    expect(Object.isFrozen(loaded.config.sjt_items[0].rationales)).toBe(true);
    expect(from).toHaveBeenCalledWith('pe_instrument_versions');
    expect(query.eq.mock.calls).toEqual([['instrument_id','BINAINSIGHTS-PE-V1'],['version','1.0.0-draft.1']]);
    expect(JSON.stringify(getPEParticipantDefinition(loaded))).not.toMatch(/scoring_key|option_scores|rationales/);
  });
  it('fails closed when setup is missing or the DB/hash is invalid',async()=>{
    await expect(loadPEInstrument(database(null).client)).rejects.toThrow('PE_INSTRUMENT_SETUP_REQUIRED');
    await expect(loadPEInstrument(database(null,{message:'private diagnostics'}).client)).rejects.toThrow(/^PE_INSTRUMENT_LOAD_FAILED$/);
    const manifest=makeSyntheticPEInstrument();
    await expect(loadPEInstrument(database({manifest,bundle_sha256:'0'.repeat(64)}).client)).rejects.toThrow('PE_INSTRUMENT_HASH_MISMATCH');
    manifest.metadata.instrument_version='1.0.0-draft.2';
    await expect(loadPEInstrument(database({manifest,bundle_sha256:hashPEInstrument(manifest)}).client)).rejects.toThrow('PE_INSTRUMENT_VERSION_MISMATCH');
  });
  it('rejects unknown scoring, incorrect coverage, orphan actions, duplicated IDs/options, public activation and non-provisional keys',()=>{
    const invalidators:Array<(b:ReturnType<typeof makeSyntheticPEInstrument>)=>void>=[
      b=>{ b.metadata.scoring_version='invented' as never; },b=>{ b.metadata.public_enabled=true as never; },
      b=>{ b.config.self_report_items.pop(); },b=>{ b.config.sjt_items[0].key_status='APPROVED' as never; },
      b=>{ b.config.sjt_items[0].options[0].id='B'; },b=>{ b.config.sjt_items[0].scoring_key='B'; },
      b=>{ b.config.self_report_items[1].id='SR01'; },b=>{ b.config.self_report_items[0].key_action_code='KA06.4'; },
      b=>{ b.config.competencies[0].code='PE-02'; },b=>{ b.config.sjt_items[0].key_action_codes=['KA01.1']; },
      b=>{ b.config.scoring.sjt.minimum_valid_scenarios_per_competency=1 as never; },
      b=>{ b.catalog_crosswalks[0].status='approved' as never; },
    ];
    for(const change of invalidators) { const input=makeSyntheticPEInstrument();change(input);expect(()=>readPEInstrument(input)).toThrow(); }
  });
  it('uses stable canonical hashes independent of JSON key insertion order',()=>{
    expect(hashPEInstrument({b:2,a:{z:3,x:1}})).toBe(hashPEInstrument({a:{x:1,z:3},b:2}));
    expect(hashPEInstrument({a:[1,2]})).not.toBe(hashPEInstrument({a:[2,1]}));
  });
});
