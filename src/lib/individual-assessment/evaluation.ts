import { z } from 'zod';
import { PEResponsesSchema } from './contracts';
import { PEDeliveryResultSchema } from './delivery-contracts';
const Row=z.object({instrumentVersion:z.string(),scoringVersion:z.string(),responses:PEResponsesSchema,
  competencies:PEDeliveryResultSchema.shape.competencies,elapsedSeconds:z.number().int().nonnegative(),
  clarity:z.number().min(1).max(5).nullable(),usefulness:z.number().min(1).max(5).nullable()}).strict();
const cell=(n:number)=>n===0?0:n>=5?n:null;
export function buildPEEvaluationExport(input:unknown) {
  const rows=Row.array().min(5).max(1000).parse(input);
  const items=[...new Set(rows.flatMap(row=>Object.keys(row.responses)))].sort().map(id=>{
    const values=rows.map(row=>row.responses[id]),options=[...new Set(values.filter(v=>v!==undefined))];
    return {id,missing:cell(values.filter(v=>v===undefined).length),
      distribution:Object.fromEntries(options.map(option=>[String(option),cell(values.filter(v=>v===option).length)]))};
  });
  const durations=rows.map(row=>row.elapsedSeconds).sort((a,b)=>a-b);
  const midpoint=Math.floor(durations.length/2),medianSeconds=durations.length%2?durations[midpoint]:(durations[midpoint-1]+durations[midpoint])/2;
  return {version:'pe-evaluation-export-v1',exportedAt:new Date().toISOString(),consentVersion:'pe-evaluation-v2',
    notice:'Pseudonymous, restricted evaluation data; not anonymous. No selection/promotions, norms, or empirical validation claims. Do not reidentify or publish participant rows.',
    sampleUnit:'Latest submitted attempt per owner. Guest owners are per attempt; this is not a verified unique-person count.',
    descriptive:{sampleSize:rows.length,elapsedMedianSeconds:medianSeconds,
      timingNotice:'Elapsed time from draft creation to submission includes pauses/offline time; not active time or item response latency.',
      items,smallCellRule:'Non-zero cells below 5 are suppressed (null); do not infer them from row-level export.'},
    records:rows.map((row,index)=>({participantCode:`P${String(index+1).padStart(4,'0')}`,...row}))};
}
