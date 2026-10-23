import { makeSyntheticPEInstrument } from './synthetic-fixture';

/** Invented test content only. Never copy CEO items or answer keys into this file. */
export function makeSyntheticV2Sources() {
  const old = makeSyntheticPEInstrument();
  const source = {
    assessment: { ...old.config.assessment, id: 'BINAINSIGHTS-PE-V2-PILOT', version: '2.0-pilot',
      updated_at: '2026-10-20', dictionary_version: '5.0-pilot', catalog_version: '6.0-SS32',
      recommendation_rules_version: '4.1-SS32', report_template_version: '3.1-pilot',
      item_count: 37, self_report_count: 24, sjt_count: 13 },
    response_scales: old.config.response_scales,
    competencies: old.config.competencies,
    self_report_items: old.config.self_report_items.map(item => ({ ...item, item_version: '2.0',
      review_status: 'REVISED_UNVALIDATED', interpretation: 'Synthetic interpretation, not CEO material.' })),
    sjt_items: [...old.config.sjt_items, { ...structuredClone(old.config.sjt_items[0]), id: 'SJ13',
      scenario: 'Invented additional Integrity scenario, not CEO material.' }].map(item => ({ ...item,
      item_version: '2.0', review_status: 'REVISED_UNVALIDATED', design_note: 'Synthetic note.',
      key_status: 'PROVISIONAL_REQUIRES_EXPERT_PANEL' })),
    scoring: { ...old.config.scoring, sjt: { ...old.config.scoring.sjt, pilot_only: true } },
    report_rules: { ...old.config.report_rules, high_stakes_uses_prohibited: true, sjt_public_key_prohibition: true },
    key_action_reference: Object.fromEntries(old.key_actions.map(action => [action.code, action.text])),
    context_fields: [], quality_gates: {}, catalog_crosswalk_ref: 'BinaInsights_Crosswalk_v6_SS32.json',
    recommendation_gates: [],
  };
  const names = [...source.competencies.map(c => c.name),
    ...Array.from({ length: 28 }, (_, n) => `Invented catalog competency ${n + 7}`)];
  const crosswalk = { dictionary_version: 'v5', catalog_version: 'v6',
    solutions: Array.from({ length: 32 }, (_, n) => ({
      solution_code: `SS-${String(n + 1).padStart(2, '0')}`, solution_name: `Invented program ${n + 1}`,
      core: [names[n]], secondary: Array.from({ length: n < 13 ? 5 : 4 }, (_, a) => names[(n + a + 1) % 34]),
      ...(n === 31 ? { product_status: 'DRAFT_PENDING_APPROVAL', available_for_final_recommendation: false } : {}),
    })) };
  return { source: structuredClone(source), crosswalk, old };
}
