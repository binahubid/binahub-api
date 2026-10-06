import { describe, expect, it } from 'vitest';
import { assessmentAreaCopy, assessmentAreaText } from './assessment-area-copy';
describe('assessment area copy', () => {
  it('normalizes old narratives without changing score keys', () => {
    expect(assessmentAreaCopy({ crossDimensionalInsights: ['Dimensi Works', '7 DIMENSIONS'], scores: { Insights: 57 } }))
      .toEqual({ crossDimensionalInsights: ['Area Works', '7 AREAS'], scores: { Insights: 57 } });
    expect(assessmentAreaText('Penalaran antardimensi dan cross-dimensional insights')).toBe('Penalaran antar area dan cross-area insights');
  });
});
