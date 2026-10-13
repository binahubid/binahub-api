import type { PEInstrument } from './instrument-contract';

/** TEST ONLY. Invented content and keys; contains NO CEO questions, rationales or answer keys. */
export function makeSyntheticPEInstrument(): PEInstrument {
  const codes = Array.from({length:6},(_,n)=>`PE-0${n+1}`);
  const key_actions = codes.flatMap((code,n)=>Array.from({length:n===0?5:4},(_,a)=>({
    competency_code:code,code:`KA0${n+1}.${a+1}`,text:`Synthetic action ${n+1}.${a+1}`,
  })));
  return {
    metadata:{instrument_version:'1.0.0-draft.1',item_version:'1.0.0-draft.1',scoring_version:'pe-dual-method-v1',
      report_rules_version:'pe-report-draft-v1',priority_rules_version:'awaiting_ceo',release_status:'draft',public_enabled:false,
      sources:['synthetic.docx','synthetic.json','synthetic.xlsx'].map(file=>({file,sha256:'0'.repeat(64)}))},
    config:{
      assessment:{id:'BINAINSIGHTS-PE-V1',title:'Synthetic PE test instrument',language:'id-ID',purpose:'Internal automated testing only',
        target_population:'Synthetic fixtures',estimated_duration_minutes:{min:15,max:20},status:'DRAFT_FOR_EXPERT_REVIEW_AND_PILOT',
        validation_notice:'Synthetic data, not an assessment instrument.'},
      response_scales:{self_report:[...Array.from({length:5},(_,n)=>({value:n+1,label:`Choice ${n+1}`})),
        {value:null,label:'Tidak ada kesempatan yang relevan',code:'NA'}],
        sjt:{type:'single_best_response',options:['A','B','C','D'],scoring_range:{min:0,max:3}}},
      competencies:codes.map(code=>({code,name:`Synthetic ${code}`,definition:`Synthetic definition ${code}`})),
      self_report_items:Array.from({length:24},(_,n)=>({id:`SR${String(n+1).padStart(2,'0')}`,
        competency_code:codes[Math.floor(n/4)],key_action_code:`KA0${Math.floor(n/4)+1}.${n%4+1}`,
        type:'behavioral_self_report',lookback_period_months:3,prompt:`Synthetic item ${n+1}, not CEO wording.`})),
      sjt_items:Array.from({length:12},(_,n)=>({id:`SJ${String(n+1).padStart(2,'0')}`,competency_code:codes[Math.floor(n/2)],
        key_action_codes:n===0?['KA01.1','KA01.5']:[`KA0${Math.floor(n/2)+1}.${n%2===0?1:3}`,`KA0${Math.floor(n/2)+1}.${n%2===0?2:4}`],
        type:'situational_judgment',scenario:`Synthetic scenario ${n+1}.`,question:'Synthetic question?',
        options:(['A','B','C','D'] as const).map(id=>({id,text:`Invented option ${id}`})),
        scoring_key:'A',option_scores:{A:3,B:2,C:1,D:0},rationales:{A:'Synthetic 3',B:'Synthetic 2',C:'Synthetic 1',D:'Synthetic 0'},
        key_status:'PROVISIONAL'})),
      scoring:{self_report:{valid_values:[1,2,3,4,5],na_handling:'Exclude NA.',competency_score:'Mean of valid values.',
        display_transform:'((mean - 1) / 4) * 100',minimum_valid_items_per_competency:3,caveat:'Synthetic.'},
        sjt:{option_scores:'Synthetic partial credits 0–3.',competency_score:'sum / (3 * valid count) * 100',
          minimum_valid_scenarios_per_competency:2,missing_response_policy:'Incomplete.',caveat:'Synthetic.'},
        composite_score:'No composite.',level_mapping:'No levels.'},
      report_rules:{display_per_competency:['self_report','sjt','completeness'],priority_selection:'Not activated.',privacy:'Synthetic data only.'},
    },
    key_actions,catalog_crosswalks:['COMP-007','COMP-024','COMP-006','COMP-001','COMP-008','COMP-020'].map((catalog_code,n)=>({
      pe_code:codes[n],framework_id:'signature-2026-competency-v1',catalog_code,status:'proposed',
    })),
  };
}
