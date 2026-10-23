import { describe, expect, it } from 'vitest';
import source from '@/data/spin-catalog-v6.json';
import { SPIN_CATALOG, spinCatalogCandidates, spinMatchingCards, validateSpinCatalog } from './catalog';

describe('SPIN catalog source and scope', () => {
  it('preserves actual V6 provenance while restricting discovery to SS-01..31', () => {
    expect(SPIN_CATALOG.catalogVersion).toBe('6.0-SS32');
    expect(SPIN_CATALOG.scopeCodes).toEqual(Array.from({ length: 31 }, (_, i) => `SS-${String(i + 1).padStart(2, '0')}`));
    expect(SPIN_CATALOG.excludedCodes).toEqual(['SS-32']);
    expect(SPIN_CATALOG.sourceSha256).toHaveLength(64);
  });
  it('handles the colon heading on SS-10 without merging it into SS-09', () => {
    expect(SPIN_CATALOG.modules[9].name).toBe('Coaching Skills for Leaders');
    expect(SPIN_CATALOG.modules[8].sourceText).not.toContain('SS-10: Coaching Skills for Leaders');
    expect(SPIN_CATALOG.modules[9].sourceText).toContain('bukan layanan coaching individual');
  });
  it.each(['no', 'unknown'] as const)('does not offer spiritual content for %s consent', consent => {
    expect(spinCatalogCandidates(consent)).toHaveLength(30);
    expect(spinCatalogCandidates(consent).some(item => item.code === 'SS-27')).toBe(false);
  });
  it('permits the special candidate only after explicit yes', () => {
    expect(spinCatalogCandidates('yes')).toHaveLength(31);
  });
  it('retains source objectives without declaring an instrument score', () => {
    for (const product of SPIN_CATALOG.modules) {
      expect(product.objectives.length).toBeGreaterThan(0);
      for (const item of product.objectives) expect(product.sourceText).toContain(item.text);
    }
  });
  it('never sends commercial/source internals to the matching model', () => {
    for (const item of spinMatchingCards('no')) expect(Object.keys(item).sort()).toEqual(['audience', 'code', 'name', 'objectives']);
  });
  it('keeps package/custom models separate from fixed daily tariffs', () => {
    expect(SPIN_CATALOG.modules.find(item => item.code === 'SS-11')).toMatchObject({ dailyRateIdr: null, allowedDays: [] });
    expect(SPIN_CATALOG.modules.find(item => item.code === 'SS-18')).toMatchObject({ dailyRateIdr: null });
    expect(SPIN_CATALOG.modules.find(item => item.code === 'SS-22')).toMatchObject({ dailyRateIdr: 30_000_000, allowedDays: [2, 3, 4, 5] });
  });
  it('freezes nested catalog values', () => {
    expect(Object.isFrozen(SPIN_CATALOG.modules[0].objectives[0])).toBe(true);
    expect(() => { SPIN_CATALOG.modules[0].name = 'Changed'; }).toThrow();
  });
  it.each(['missing', 'duplicate', 'wrong_objective', 'invented_price', 'wrong_hash'])('rejects %s source corruption', kind => {
    const broken = structuredClone(source);
    if (kind === 'missing') broken.modules.pop();
    if (kind === 'duplicate') broken.modules[1].code = 'SS-01';
    if (kind === 'wrong_objective') broken.modules[0].objectives[0].id = 'SS-29.LO01';
    if (kind === 'invented_price') broken.modules[0].dailyRateIdr = 1;
    if (kind === 'wrong_hash') broken.sourceSha256 = '0'.repeat(64);
    expect(() => validateSpinCatalog(broken)).toThrow();
  });
});
