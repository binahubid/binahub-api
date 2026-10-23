import { createHash } from 'node:crypto';

// Preparation-only adapter. No routes, database writes, AI calls or release activation.
export const V2_CODES = Object.freeze(['PE-01', 'PE-02', 'PE-03', 'PE-04', 'PE-05', 'PE-06']);
export const V2_FREE_CODES = Object.freeze(['PE-02', 'PE-04', 'PE-06']);
const OPTIONS = ['A', 'B', 'C', 'D'];
const validated = new WeakSet();
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.trim().length > 0;
const same = (a, b) => canonical(a) === canonical(b);
const assert = (condition, code = 'BINA_V2_SOURCE_INVALID') => {
  if (!condition) throw new Error(code);
};
function keys(value, expected) {
  return object(value) && same(Object.keys(value).sort(), [...expected].sort());
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('BINA_NON_JSON_VALUE');
  return serialized;
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const pick = (value, names) => Object.fromEntries(names.map(name => [name, value[name]]));
const SR_FIELDS = ['id', 'competency_code', 'key_action_code', 'type', 'lookback_period_months',
  'prompt', 'item_version', 'review_status', 'interpretation'];
const SJ_PUBLIC_FIELDS = ['id', 'competency_code', 'key_action_codes', 'type', 'scenario',
  'question', 'options', 'item_version'];

/** The source participant file is compared, not trusted as the eventual public API DTO. */
export function projectV2SourceParticipant(source) {
  return structuredClone({
    assessment: source.assessment,
    response_scales: source.response_scales,
    competencies: source.competencies,
    self_report_items: source.self_report_items.map(item => pick(item, SR_FIELDS)),
    sjt_items: source.sjt_items.map(item => pick(item, SJ_PUBLIC_FIELDS)),
    catalog_crosswalk_ref: source.catalog_crosswalk_ref,
  });
}

/** Validates the new source without weakening or reinterpreting the V1 contract. */
export function validateV2Sources(input, participant, crosswalk) {
  try {
    assert(keys(input, ['assessment', 'response_scales', 'competencies', 'self_report_items',
      'sjt_items', 'scoring', 'report_rules', 'key_action_reference', 'context_fields',
      'quality_gates', 'catalog_crosswalk_ref', 'recommendation_gates']));
    const source = structuredClone(input);
    const { assessment: a, competencies, self_report_items: sr, sjt_items: sj,
      key_action_reference: actions, scoring, response_scales: scales } = source;
    assert(a.id === 'BINAINSIGHTS-PE-V2-PILOT' && a.version === '2.0-pilot'
      && a.language === 'id-ID' && a.updated_at === '2026-10-20'
      && a.dictionary_version === '5.0-pilot' && a.catalog_version === '6.0-SS32'
      && a.recommendation_rules_version === '4.1-SS32' && a.report_template_version === '3.1-pilot'
      && a.status === 'DRAFT_FOR_EXPERT_REVIEW_AND_PILOT'
      && a.item_count === 37 && a.self_report_count === 24 && a.sjt_count === 13);
    assert(Array.isArray(competencies) && same(competencies.map(c => c.code), V2_CODES)
      && competencies.every(c => keys(c, ['code', 'name', 'definition']) && text(c.name) && text(c.definition))
      && new Set(competencies.map(c => c.name)).size === 6);
    assert(Array.isArray(sr) && sr.length === 24 && Array.isArray(sj) && sj.length === 13);
    const actionCodes = V2_CODES.flatMap((_, n) => Array.from({ length: n === 0 ? 5 : 4 },
      (_unused, index) => `KA0${n + 1}.${index + 1}`));
    assert(keys(actions, actionCodes) && Object.values(actions).every(text));
    const usedActions = new Set();
    for (const [items, prefix] of [[sr, 'SR'], [sj, 'SJ']]) {
      assert(same(items.map(i => i.id), Array.from({ length: items.length },
        (_, n) => `${prefix}${String(n + 1).padStart(2, '0')}`)));
      for (const item of items) {
        assert(V2_CODES.includes(item.competency_code) && item.item_version === '2.0'
          && item.review_status === 'REVISED_UNVALIDATED');
        const links = prefix === 'SR' ? [item.key_action_code] : item.key_action_codes;
        assert(Array.isArray(links) && links.length > 0 && new Set(links).size === links.length
          && links.every(link => own(actions, link)
            && link.startsWith(`KA${item.competency_code.slice(3)}.`)));
        links.forEach(link => usedActions.add(link));
        if (prefix === 'SR') {
          assert(keys(item, SR_FIELDS) && item.type === 'behavioral_self_report'
            && item.lookback_period_months === 3 && text(item.prompt) && text(item.interpretation));
        } else {
          assert(keys(item, [...SJ_PUBLIC_FIELDS, 'scoring_key', 'option_scores', 'rationales',
            'key_status', 'review_status', 'design_note']) && item.type === 'situational_judgment'
            && text(item.scenario) && text(item.question) && text(item.design_note)
            && item.key_status === 'PROVISIONAL_REQUIRES_EXPERT_PANEL');
          assert(Array.isArray(item.options) && same(item.options.map(o => o.id), OPTIONS)
            && item.options.every(o => keys(o, ['id', 'text']) && text(o.text)));
          assert(keys(item.option_scores, OPTIONS) && Object.values(item.option_scores)
            .every(score => Number.isInteger(score) && score >= 0 && score <= 3)
            && OPTIONS.includes(item.scoring_key) && item.option_scores[item.scoring_key] === 3
            && keys(item.rationales, OPTIONS) && Object.values(item.rationales).every(text));
        }
      }
    }
    assert(usedActions.size === 25);
    for (const code of V2_CODES) {
      assert(sr.filter(item => item.competency_code === code).length === 4
        && sj.filter(item => item.competency_code === code).length === (code === 'PE-01' ? 3 : 2));
    }
    assert(same(scales.self_report.map(s => s.value), [1, 2, 3, 4, 5, null])
      && scales.self_report.every(s => text(s.label)) && scales.self_report[5].code === 'NA'
      && same(scales.sjt.options, OPTIONS) && scales.sjt.type === 'single_best_response'
      && same(scales.sjt.scoring_range, { min: 0, max: 3 }));
    assert(same(scoring.self_report.valid_values, [1, 2, 3, 4, 5])
      && scoring.self_report.minimum_valid_items_per_competency === 3
      && scoring.sjt.minimum_valid_scenarios_per_competency === 2 && scoring.sjt.pilot_only === true
      && source.report_rules.high_stakes_uses_prohibited === true
      && source.report_rules.sjt_public_key_prohibition === true);
    assert(source.catalog_crosswalk_ref === 'BinaInsights_Crosswalk_v6_SS32.json');
    assert(same(projectV2SourceParticipant(source), participant), 'BINA_V2_PARTICIPANT_MISMATCH');
    assert(object(crosswalk) && crosswalk.dictionary_version === 'v5'
      && crosswalk.catalog_version === 'v6' && Array.isArray(crosswalk.solutions)
      && crosswalk.solutions.length === 32);
    const names = new Set();
    let links = 0;
    for (const [index, solution] of crosswalk.solutions.entries()) {
      assert(solution.solution_code === `SS-${String(index + 1).padStart(2, '0')}`
        && text(solution.solution_name) && Array.isArray(solution.core) && solution.core.length > 0
        && Array.isArray(solution.secondary));
      const mapped = [...solution.core, ...solution.secondary];
      assert(mapped.every(text) && new Set(mapped).size === mapped.length);
      mapped.forEach(name => names.add(name));
      links += mapped.length;
    }
    assert(names.size === 34 && links === 173 && competencies.every(c => names.has(c.name)));
    const pending = crosswalk.solutions.at(-1);
    assert(pending.product_status === 'DRAFT_PENDING_APPROVAL'
      && pending.available_for_final_recommendation === false);
    const result = freeze({ instrument: source, crosswalk: structuredClone(crosswalk) });
    validated.add(result);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'BINA_V2_PARTICIPANT_MISMATCH') throw error;
    throw new Error('BINA_V2_SOURCE_INVALID');
  }
}

function entitled(bundle, codes) {
  assert(validated.has(bundle), 'BINA_V2_VALIDATION_REQUIRED');
  assert(Array.isArray(codes) && codes.length > 0 && new Set(codes).size === codes.length
    && codes.every(code => V2_CODES.includes(code)), 'BINA_V2_ENTITLEMENT_INVALID');
  return V2_CODES.filter(code => codes.includes(code));
}

/** Explicit API allowlist. Source editorial fields and hidden competencies do not leave this DTO. */
export function getV2ParticipantDefinition(bundle, codes) {
  const allowed = entitled(bundle, codes);
  const source = bundle.instrument;
  const include = item => allowed.includes(item.competency_code);
  const sr = source.self_report_items.filter(include), sj = source.sjt_items.filter(include);
  return {
    instrumentId: source.assessment.id, instrumentVersion: source.assessment.version,
    publicEnabled: false, expectedCount: sr.length + sj.length,
    competencies: source.competencies.filter(c => allowed.includes(c.code))
      .map(c => pick(c, ['code', 'name', 'definition'])),
    selfReportScale: source.response_scales.self_report.map(s => ({ value: s.value ?? 'NA', label: s.label })),
    selfReportItems: sr.map(i => ({ id: i.id, itemVersion: i.item_version,
      competencyCode: i.competency_code, keyActionCodes: [i.key_action_code], type: i.type,
      lookbackPeriodMonths: i.lookback_period_months, prompt: i.prompt })),
    sjtItems: sj.map(i => ({ id: i.id, itemVersion: i.item_version,
      competencyCode: i.competency_code, keyActionCodes: [...i.key_action_codes], type: i.type,
      scenario: i.scenario, question: i.question, options: i.options.map(o => ({ id: o.id, text: o.text })) })),
  };
}

/** Preview/replay only until a version-aware persistence and delivery flow is installed. */
export function scoreV2Responses(bundle, input, codes) {
  const allowed = entitled(bundle, codes), source = bundle.instrument;
  assert(object(input), 'BINA_V2_RESPONSES_INVALID');
  const sr = source.self_report_items.filter(i => allowed.includes(i.competency_code));
  const sj = source.sjt_items.filter(i => allowed.includes(i.competency_code));
  const srIds = new Set(sr.map(i => i.id)), sjIds = new Set(sj.map(i => i.id));
  for (const [id, value] of Object.entries(input)) {
    const valid = srIds.has(id) ? (Number.isInteger(value) && value >= 1 && value <= 5) || value === 'NA'
      : sjIds.has(id) && OPTIONS.includes(value);
    assert(valid, 'BINA_V2_RESPONSES_INVALID');
  }
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const competencies = allowed.map(code => {
    const selfReportItems = sr.filter(i => i.competency_code === code);
    const scenarios = sj.filter(i => i.competency_code === code);
    const numeric = selfReportItems.map(i => input[i.id]).filter(v => typeof v === 'number');
    const naCount = selfReportItems.filter(i => input[i.id] === 'NA').length;
    const answered = scenarios.filter(i => own(input, i.id));
    const sum = numeric.reduce((total, value) => total + value, 0);
    const points = answered.reduce((total, i) => total + i.option_scores[input[i.id]], 0);
    const srReady = numeric.length >= 3, sjReady = answered.length >= 2;
    return { code,
      selfReport: { status: srReady ? 'scored' : 'insufficient_evidence', validCount: numeric.length,
        naCount, missingCount: selfReportItems.length - numeric.length - naCount,
        expectedCount: selfReportItems.length, rawSum: sum,
        mean: srReady ? round(sum / numeric.length) : null,
        score: srReady ? round(((sum / numeric.length - 1) / 4) * 100) : null },
      sjt: { status: sjReady ? 'scored' : 'incomplete', validCount: answered.length,
        missingCount: scenarios.length - answered.length, expectedCount: scenarios.length,
        rawSum: points, maximum: 3 * answered.length,
        score: sjReady ? round(points / (3 * answered.length) * 100) : null },
    };
  });
  return { instrumentId: source.assessment.id, instrumentVersion: source.assessment.version,
    scoringAdapterVersion: 'pe-v2-dual-method-preview-v1', dictionaryVersion: source.assessment.dictionary_version,
    catalogVersion: source.assessment.catalog_version, reportTemplateVersion: source.assessment.report_template_version,
    validationStatus: source.assessment.status,
    completeness: { expectedCount: sr.length + sj.length, answeredCount: Object.keys(input).length,
      missingCount: sr.length + sj.length - Object.keys(input).length,
      naCount: Object.values(input).filter(v => v === 'NA').length }, competencies };
}

export function getV2PreparationSummary(bundle) {
  assert(validated.has(bundle), 'BINA_V2_VALIDATION_REQUIRED');
  const source = bundle.instrument;
  return { instrumentId: source.assessment.id, instrumentVersion: source.assessment.version,
    dictionaryVersion: source.assessment.dictionary_version, catalogVersion: source.assessment.catalog_version,
    sourceRulesVersion: source.assessment.recommendation_rules_version,
    reportTemplateVersion: source.assessment.report_template_version,
    selfReportItems: 24, scenarios: 13, totalItems: 37,
    freeItems: getV2ParticipantDefinition(bundle, V2_FREE_CODES).expectedCount,
    additionalItems: getV2ParticipantDefinition(bundle, ['PE-01', 'PE-03', 'PE-05']).expectedCount,
    catalogSolutions: 32, catalogCompetencies: 34, catalogLinks: 173,
    pendingProducts: ['SS-32'], status: 'prepared_not_active' };
}

/** Read-only source comparison. IDs are safe to show; item texts and keys are never returned. */
export function compareV2WithV1(bundle, legacy) {
  assert(validated.has(bundle), 'BINA_V2_VALIDATION_REQUIRED');
  assert(legacy?.config?.assessment?.id === 'BINAINSIGHTS-PE-V1'
    && legacy?.metadata?.instrument_version === '1.0.0-draft.1'
    && legacy.config.self_report_items?.length === 24 && legacy.config.sjt_items?.length === 12,
  'BINA_V1_COMPARISON_SOURCE_INVALID');
  const before = [...legacy.config.self_report_items, ...legacy.config.sjt_items];
  const after = [...bundle.instrument.self_report_items, ...bundle.instrument.sjt_items];
  assert(new Set(before.map(i => i.id)).size === 36, 'BINA_V1_COMPARISON_SOURCE_INVALID');
  assert(same(before.map(i => i.id), [...Array.from({ length: 24 }, (_, n) => `SR${String(n + 1).padStart(2, '0')}`),
    ...Array.from({ length: 12 }, (_, n) => `SJ${String(n + 1).padStart(2, '0')}`)]), 'BINA_V1_COMPARISON_SOURCE_INVALID');
  const signature = item => pick(item, item.id.startsWith('SR')
    ? ['competency_code', 'key_action_code', 'type', 'lookback_period_months', 'prompt']
    : ['competency_code', 'key_action_codes', 'type', 'scenario', 'question', 'options',
      'scoring_key', 'option_scores', 'rationales']);
  const oldItems = new Map(before.map(i => [i.id, i]));
  const newItems = new Map(after.map(i => [i.id, i]));
  return { from: { instrumentId: legacy.config.assessment.id, instrumentVersion: legacy.metadata.instrument_version },
    to: { instrumentId: bundle.instrument.assessment.id, instrumentVersion: bundle.instrument.assessment.version },
    sharedItemIds: after.filter(i => oldItems.has(i.id)).map(i => i.id),
    changedItemIds: after.filter(i => oldItems.has(i.id)
      && !same(signature(i), signature(oldItems.get(i.id)))).map(i => i.id),
    addedItemIds: after.filter(i => !oldItems.has(i.id)).map(i => i.id),
    removedItemIds: before.filter(i => !newItems.has(i.id)).map(i => i.id),
    automaticAnswerMigrationAllowed: false };
}
