import { z } from 'zod';
import source from '@/data/spin-catalog-v6.json';

const moduleSchema = z.object({
  code: z.string().regex(/^SS-\d{2}$/), name: z.string().min(1),
  sourceParagraphStart: z.number().int().positive(), sourceParagraphEnd: z.number().int().positive(),
  objectives: z.array(z.object({ id: z.string(), text: z.string().min(1) }).strict()).min(1),
  audience: z.string().nullable(), duration: z.string().min(1), capacity: z.string().min(1),
  pricingModel: z.string(), dailyRateIdr: z.number().int().positive().nullable(),
  allowedDays: z.array(z.number().int().positive()), priceEvidence: z.string(), sourceText: z.string().min(1),
}).strict();

const catalogSchema = z.object({
  schemaVersion: z.literal(1), catalogVersion: z.literal('6.0-SS32'), scopeVersion: z.literal('spin-ss01-31-v1'),
  sourceFile: z.literal('BinaHub_Signature_Solutions_Catalog_V6_SS32.docx'),
  sourceSha256: z.literal('10b439e277cc823cdb0b8dd10cc2892830e821607c75488df0e7a82eb1c1cc99'),
  scopeCodes: z.array(z.string()).length(31), excludedCodes: z.tuple([z.literal('SS-32')]),
  modules: z.array(moduleSchema).length(31),
}).strict();

export type SpinCatalogModule = z.infer<typeof moduleSchema>;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function validateSpinCatalog(value: unknown) {
  const catalog = catalogSchema.parse(value);
  const expected = Array.from({ length: 31 }, (_, i) => `SS-${String(i + 1).padStart(2, '0')}`);
  if (catalog.scopeCodes.some((code, i) => code !== expected[i])
    || catalog.modules.some((module, i) => module.code !== expected[i])) throw new Error('SPIN_CATALOG_SCOPE_INVALID');
  for (const product of catalog.modules) {
    const ids = new Set(product.objectives.map(item => item.id));
    if (ids.size !== product.objectives.length || product.objectives.some((item, i) =>
      item.id !== `${product.code}.LO${String(i + 1).padStart(2, '0')}` || !product.sourceText.includes(item.text))) {
      throw new Error('SPIN_CATALOG_OBJECTIVE_INVALID');
    }
    const daily = /^Tarif Harian (Standar|Khusus)$/.test(product.pricingModel);
    if (product.dailyRateIdr !== null && (!daily || !/\/hari/.test(product.priceEvidence)
      || !product.allowedDays.length || !/hingga 30 peserta/i.test(product.capacity)
      || !product.priceEvidence.includes(product.dailyRateIdr.toLocaleString('id-ID')))) {
      throw new Error('SPIN_CATALOG_PRICE_INVALID');
    }
    if (!daily && (product.dailyRateIdr !== null || product.allowedDays.length)) throw new Error('SPIN_CATALOG_PRICE_INVALID');
  }
  return freeze(catalog);
}

/** Prepared source snapshot, not a declaration of deployed product readiness. */
export const SPIN_CATALOG = validateSpinCatalog(source);

export function spinCatalogCandidates(spiritualOptIn: 'yes' | 'no' | 'unknown') {
  return SPIN_CATALOG.modules.filter(module => module.code !== 'SS-27' || spiritualOptIn === 'yes');
}

/** Deliberately excludes prices, source internals, and all SS-32 content. */
export function spinMatchingCards(spiritualOptIn: 'yes' | 'no' | 'unknown') {
  return spinCatalogCandidates(spiritualOptIn).map(({ code, name, objectives, audience,sourceText }) => ({
    code, name, objectives: objectives.map(item => ({ ...item })), audience,
    competencies:spinCatalogCompetencies(sourceText),
  }));
}

/** Exact catalog labels, not measured competency levels or a guessed crosswalk.
 * The extracted V6 table loses core/secondary column alignment; retain one flat
 * list rather than asserting which column a competency originally belonged to.
 */
export function spinCatalogCompetencies(text:string):string[] {
 const compact=/Kompetensi inti:\s*([\s\S]*?)\s*Output:/i.exec(text);
 if(compact)return [...new Set(compact[1].replace(/Kompetensi pendukung:/gi,';').split(/[;\n]/)
  .map(value=>value.trim().replace(/\.$/,'')).filter(Boolean))];
 const block=/KOMPETENSI YANG DIKEMBANGKAN\s*([\s\S]*?)\s*Basis:/i.exec(text);
 if(!block)return [];
 return [...new Set(block[1].split('\n').filter(line=>/^\s*•/.test(line))
  .map(line=>line.replace(/^\s*•\s*/,'').trim()).filter(Boolean))];
}
