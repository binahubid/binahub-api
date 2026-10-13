import 'server-only';
import { z } from 'zod';

const text = z.string().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const code = z.string().regex(/^PE-0[1-6]$/);
const actionCode = z.string().regex(/^KA0[1-6]\.[1-5]$/);
const option = z.enum(['A','B','C','D']);
const credits = z.object({ A:z.number().int().min(0).max(3),B:z.number().int().min(0).max(3),
  C:z.number().int().min(0).max(3),D:z.number().int().min(0).max(3) }).strict();
const rationales = z.object({ A:text,B:text,C:text,D:text }).strict();
const schema = z.object({
  metadata:z.object({ instrument_version:text,item_version:text,scoring_version:z.literal('pe-dual-method-v1'),
    report_rules_version:text,priority_rules_version:z.literal('awaiting_ceo'),release_status:z.literal('draft'),
    public_enabled:z.literal(false),sources:z.array(z.object({file:text,sha256:hash}).strict()).length(3) }).strict(),
  config:z.object({
    assessment:z.object({id:z.literal('BINAINSIGHTS-PE-V1'),title:text,language:z.literal('id-ID'),purpose:text,
      target_population:text,estimated_duration_minutes:z.object({min:z.number().positive(),max:z.number().positive()}).strict(),
      status:z.literal('DRAFT_FOR_EXPERT_REVIEW_AND_PILOT'),validation_notice:text}).strict(),
    response_scales:z.object({ self_report:z.array(z.object({value:z.number().int().min(1).max(5).nullable(),label:text,code:z.literal('NA').optional()}).strict()).length(6),
      sjt:z.object({type:z.literal('single_best_response'),options:z.array(option).length(4),
        scoring_range:z.object({min:z.literal(0),max:z.literal(3)}).strict()}).strict() }).strict(),
    competencies:z.array(z.object({code,name:text,definition:text}).strict()).length(6),
    self_report_items:z.array(z.object({id:z.string().regex(/^SR\d{2}$/),competency_code:code,key_action_code:actionCode,
      type:z.literal('behavioral_self_report'),lookback_period_months:z.literal(3),prompt:text}).strict()).length(24),
    sjt_items:z.array(z.object({id:z.string().regex(/^SJ\d{2}$/),competency_code:code,key_action_codes:z.array(actionCode).min(1),
      type:z.literal('situational_judgment'),scenario:text,question:text,
      options:z.array(z.object({id:option,text}).strict()).length(4),scoring_key:option,option_scores:credits,rationales,
      key_status:z.literal('PROVISIONAL')}).strict()).length(12),
    scoring:z.object({ self_report:z.object({valid_values:z.array(z.number()).length(5),na_handling:text,
      competency_score:text,display_transform:text,minimum_valid_items_per_competency:z.literal(3),caveat:text}).strict(),
      sjt:z.object({option_scores:text,competency_score:text,minimum_valid_scenarios_per_competency:z.literal(2),
        missing_response_policy:text,caveat:text}).strict(),composite_score:text,level_mapping:text }).strict(),
    report_rules:z.object({display_per_competency:z.array(text),priority_selection:text,privacy:text}).strict(),
  }).strict(),
  key_actions:z.array(z.object({competency_code:code,code:actionCode,text}).strict()).length(25),
  catalog_crosswalks:z.array(z.object({pe_code:code,framework_id:z.literal('signature-2026-competency-v1'),
    catalog_code:z.string().regex(/^COMP-\d{3}$/),status:z.literal('proposed')}).strict()).length(6),
}).strict().superRefine((bundle,ctx) => {
  const fail = () => ctx.addIssue({code:'custom',message:'PE_INSTRUMENT_STRUCTURE_INVALID'});
  const {config,key_actions:actions} = bundle;
  const expected = Array.from({length:6},(_,i)=>`PE-0${i+1}`);
  if (config.competencies.map(c=>c.code).join()!==expected.join()) fail();
  if (new Set(actions.map(a=>a.code)).size!==25) fail();
  if (bundle.catalog_crosswalks.map(m=>m.pe_code).join()!==expected.join()) fail();
  const used = new Set<string>();
  for (const [items,prefix] of [[config.self_report_items,'SR'],[config.sjt_items,'SJ']] as const) {
    if (items.map(i=>i.id).join()!==Array.from({length:items.length},(_,n)=>`${prefix}${String(n+1).padStart(2,'0')}`).join()) fail();
    for (const item of items) {
      const links = 'key_action_code' in item ? [item.key_action_code] : item.key_action_codes;
      if (new Set(links).size!==links.length || links.some(link=>!actions.some(a=>a.code===link && a.competency_code===item.competency_code))) fail();
      links.forEach(link=>used.add(link));
    }
  }
  if (used.size!==25) fail();
  for (const c of expected) {
    if (config.self_report_items.filter(i=>i.competency_code===c).length!==4 || config.sjt_items.filter(i=>i.competency_code===c).length!==2) fail();
    if (actions.filter(a=>a.competency_code===c).length!==(c==='PE-01'?5:4)) fail();
  }
  for (const item of config.sjt_items) {
    if (item.options.map(o=>o.id).sort().join()!=='A,B,C,D' || item.option_scores[item.scoring_key]!==3) fail();
  }
  if (config.response_scales.self_report.map(s=>s.value).join()!=='1,2,3,4,5,' || config.response_scales.self_report[5].code!=='NA') fail();
  if (config.scoring.self_report.valid_values.join()!=='1,2,3,4,5') fail();
  if (config.response_scales.sjt.options.join()!=='A,B,C,D') fail();
});

export type PEInstrument = z.infer<typeof schema>;
export function validatePEInstrument(input:unknown): PEInstrument { return schema.parse(input); }
