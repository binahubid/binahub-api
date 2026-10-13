import 'server-only';
import type { PEInstrument } from './instrument-contract';
import { PEResponsesSchema, PEResultSchema } from './contracts';
export { PEResponsesSchema } from './contracts';
export type { PEResponses } from './contracts';
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Deterministic, provisional scoring. No AI, overall score, level, norm or priority ranking. */
export function scorePEResponses(input: unknown, instrument:PEInstrument) {
  const responses = PEResponsesSchema.parse(input);
  const { config,metadata } = instrument;
  const srIds = new Set(config.self_report_items.map(i=>i.id));
  const sjtIds = new Set(config.sjt_items.map(i=>i.id));
  const competencies = config.competencies.map(c => {
    const sr = config.self_report_items.filter(i => i.competency_code === c.code);
    const sjt = config.sjt_items.filter(i => i.competency_code === c.code);
    const values = sr.map(i => responses[i.id]).filter((v): v is number => typeof v === 'number');
    const na = sr.filter(i => responses[i.id] === 'NA').length;
    const srSum = values.reduce((total, value) => total + value, 0);
    const srReady = values.length >= config.scoring.self_report.minimum_valid_items_per_competency;
    const validSjt = sjt.filter(i => Object.hasOwn(responses, i.id));
    const sjtSum = validSjt.reduce((total, item) => total + item.option_scores[responses[item.id] as 'A' | 'B' | 'C' | 'D'], 0);
    const sjtReady = validSjt.length >= config.scoring.sjt.minimum_valid_scenarios_per_competency;
    return {
      code: c.code,
      selfReport: {
        status: srReady ? 'scored' : 'insufficient_evidence',
        validCount: values.length, naCount: na, missingCount: sr.length - values.length - na,
        expectedCount: sr.length, rawSum: srSum,
        // Preserve the numerator/denominator; round only presentation values, never intermediate means.
        mean: srReady ? round(srSum / values.length) : null,
        score: srReady ? round(((srSum / values.length - 1) / 4) * 100) : null,
      },
      sjt: {
        status: sjtReady ? 'scored' : 'incomplete', validCount: validSjt.length,
        missingCount: sjt.length - validSjt.length, expectedCount: sjt.length,
        rawSum: sjtSum, maximum: 3 * validSjt.length,
        score: sjtReady ? round(sjtSum / (3 * validSjt.length) * 100) : null,
      },
    };
  });
  return PEResultSchema.parse({
    instrumentId: config.assessment.id, instrumentVersion: metadata.instrument_version,
    scoringVersion: metadata.scoring_version, reportRulesVersion: metadata.report_rules_version,
    priorityRulesVersion: metadata.priority_rules_version,
    validationStatus: config.assessment.status,
    completeness: {
      expectedCount: srIds.size + sjtIds.size, answeredCount: Object.keys(responses).length,
      missingCount: srIds.size + sjtIds.size - Object.keys(responses).length,
      naCount: Object.values(responses).filter(v => v === 'NA').length,
      scoredMethods: competencies.reduce((n, c) => n + Number(c.selfReport.status === 'scored') + Number(c.sjt.status === 'scored'), 0),
    },
    competencies,
  });
}
