import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {publicPEReport} from './public-report';
it('redacts legacy private practice without mutating stored scores or snapshots',()=>{
 const input={areas:[{code:'PE-02',selfReport:{score:75},practice:{focus:'PRIVATE ANCHOR',successIndicator:'PRIVATE ANCHOR'}}],priorities:[{code:'PE-02',practice:{focus:'PRIVATE ANCHOR'}}]};
 const result=publicPEReport(input);
 expect(JSON.stringify(result)).not.toContain('PRIVATE ANCHOR');expect(result.areas[0].selfReport.score).toBe(75);
 expect(input.areas[0].practice.focus).toBe('PRIVATE ANCHOR');
 expect(publicPEReport(result)).toEqual(result);
});
