import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validatePEInstrument, type PEInstrument } from './instrument-contract';
import {PE_PARTICIPANT_COPY_VERSION,peParticipantPrompt,peParticipantQuestion,peParticipantOption} from './meeting-copy';

export const PE_INSTRUMENT_ID = 'BINAINSIGHTS-PE-V1';
export const PE_VERSION = '1.0.0-draft.1';
export const PE_SCORING_VERSION = 'pe-dual-method-v1';
export const PE_REPORT_RULES_VERSION = 'pe-report-draft-v1';

function freeze<T>(value:T):T {
  if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function canonicalJson(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value)
    .sort(([a],[b])=>a.localeCompare(b,'en'))
    .map(([key,item])=>JSON.stringify(key)+':'+canonicalJson(item)).join(',')+'}';
  return JSON.stringify(value);
}
export const hashPEInstrument = (value:unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function readPEInstrument(input:unknown):PEInstrument { return freeze(validatePEInstrument(input)); }

/** Load private content from the database, never from a committed/static JSON bundle. */
export async function loadPEInstrument(client:Pick<SupabaseClient,'from'>, version=PE_VERSION) {
  const {data,error} = await client.from('pe_instrument_versions').select('manifest,bundle_sha256')
    .eq('instrument_id',PE_INSTRUMENT_ID).eq('version',version).maybeSingle();
  if (error) throw new Error('PE_INSTRUMENT_LOAD_FAILED');
  if (!data) throw new Error('PE_INSTRUMENT_SETUP_REQUIRED');
  if (hashPEInstrument(data.manifest)!==data.bundle_sha256) throw new Error('PE_INSTRUMENT_HASH_MISMATCH');
  let instrument:PEInstrument;
  try { instrument=readPEInstrument(data.manifest); } catch { throw new Error('PE_INSTRUMENT_STRUCTURE_INVALID'); }
  if (instrument.metadata.instrument_version!==version) throw new Error('PE_INSTRUMENT_VERSION_MISMATCH');
  return instrument;
}

/** Explicit allowlist. Never spread a source item: SJT keys/rationales are private. */
export function getPEParticipantDefinition(source:PEInstrument) {
  const {assessment,competencies,response_scales,self_report_items,sjt_items} = source.config;
  return {
    instrumentId:assessment.id,instrumentVersion:source.metadata.instrument_version,participantCopyVersion:PE_PARTICIPANT_COPY_VERSION,
    title:assessment.title,language:assessment.language,purpose:assessment.purpose,
    estimatedDurationMinutes:{...assessment.estimated_duration_minutes},
    status:assessment.status,validationNotice:assessment.validation_notice,publicEnabled:false,
    competencies:competencies.map(c=>({code:c.code,name:c.name,definition:c.definition})),
    selfReportScale:response_scales.self_report.map(s=>({value:s.value===null?'NA':s.value,label:s.label})),
    selfReportItems:self_report_items.map(i=>({
      id:i.id,itemVersion:source.metadata.item_version,competencyCode:i.competency_code,
      type:i.type,lookbackPeriodMonths:i.lookback_period_months,prompt:peParticipantPrompt(i.id,i.prompt),
    })),
    sjtItems:sjt_items.map(i=>({
      id:i.id,itemVersion:source.metadata.item_version,competencyCode:i.competency_code,
      type:i.type,scenario:i.scenario,question:peParticipantQuestion(i.id,i.question),
      options:i.options.map(o=>({id:o.id,text:peParticipantOption(i.id,o.id,o.text)})),
    })),
  };
}
