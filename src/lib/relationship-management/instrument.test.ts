import {describe,it,expect,vi} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {validateRMInstrument,rmParticipantDefinition,rmReadiness,hashRMInstrument,loadRMInstrument} from './instrument';
import {previewRMReport} from './scoring';
const names=['Communication','Presentation & Public Speaking','Professional Presence','Relationship Building','Trust Building','Collaboration','Influencing','Conflict Management','Customer Orientation'];
function fixture(){return validateRMInstrument({metadata:{version:'4.0.0-draft.1',status:'draft',publicEnabled:false,sources:[{file:'synthetic.docx',sha256:'a'.repeat(64)},{file:'synthetic.xlsx',sha256:'b'.repeat(64)}],reportSelfReportCount:24,bankSelfReportCount:27},
 competencies:names.map((name,i)=>({code:'RM-'+String(i+7).padStart(2,'0'),name,definition:'Synthetic definition',behaviorAnchors:['PRIVATE_ANCHOR'],candidates:[{code:'SS-04',name:'Synthetic program',alignment:'Core'}],deliveryNote:'Review format',validation:'Review context'})),
 scale:Array.from({length:5},(_,i)=>({value:i+1,label:'Choice '+(i+1)})),
 selfReportItems:names.flatMap((_,i)=>Array.from({length:3},(_,j)=>({id:`RM-SR-0${i+1}-0${j+1}`,competencyCode:'RM-'+String(i+7).padStart(2,'0'),prompt:'Synthetic question',behaviorAnchor:'PRIVATE_ITEM_ANCHOR'}))),
 sjtItems:Array.from({length:13},(_,i)=>({id:'RM-SJT-'+String(i+1).padStart(2,'0'),title:'Synthetic case',scenario:'Synthetic scenario',options:['A','B','C','D'].map(id=>({id,text:'Synthetic option '+id})),tags:['RM-07'],bestOption:'B',scores:{A:0,B:3,C:1,D:2},rationale:'PRIVATE_RATIONALE'})),scoringPolicy:null});}
describe('RM v4 protected draft foundation',()=>{
 it('exports question text only, never keys, credits, tags or private behavior anchors',()=>{
  const definition=rmParticipantDefinition(fixture()),json=JSON.stringify(definition);
  expect(definition.selfReportItems).toHaveLength(27);expect(definition.sjtItems).toHaveLength(13);
  for(const privateValue of ['PRIVATE_','bestOption','scores','rationale','behaviorAnchor','tags'])expect(json).not.toContain(privateValue);
 });
 it('supports the owner-approved module 50:50 without inventing competency tag weights',()=>{
  const source=fixture(),responses=Object.fromEntries([...source.selfReportItems.map(i=>[i.id,5]),...source.sjtItems.map(i=>[i.id,'B'])]);
  const report=previewRMReport(source,responses,true);expect(report.combinedScore).toBe(100);
  expect(report.moduleProfile).toMatchObject({selfReport:100,sjt:100,combined:100,scope:'module',weights:{selfReport:0.5,sjt:0.5}});
  expect(report.areas.every(a=>a.selfReport.score===100&&a.sjt.score===null&&a.sjt.status==='weighting_required')).toBe(true);
  expect(report.solutions.items).toEqual([]);expect(JSON.stringify(report)).not.toContain('PRIVATE_');
  expect(rmReadiness(source).canSell).toBe(false);expect(rmReadiness(source).missing.length).toBeGreaterThan(2);
 });
 it('distinguishes insufficient evidence from zero and validates all answer domains',()=>{
  const source=fixture();expect(previewRMReport(source,{}).areas[0].selfReport.score).toBeNull();
  const answers=Object.fromEntries(source.selfReportItems.slice(0,3).map(i=>[i.id,1]));
  expect(previewRMReport(source,answers).areas[0].selfReport.score).toBe(0);
  expect(previewRMReport(source,{}).combinedScore).toBeNull();
  const zero=Object.fromEntries([...source.selfReportItems.map(i=>[i.id,1]),...source.sjtItems.map(i=>[i.id,'A'])]);
  expect(previewRMReport(source,zero,true).moduleProfile).toMatchObject({selfReport:0,sjt:0,combined:0});
  const split=Object.fromEntries([...source.selfReportItems.map(i=>[i.id,5]),...source.sjtItems.map(i=>[i.id,'A'])]);
  expect(previewRMReport(source,split,true).combinedScore).toBe(50);
  expect(()=>previewRMReport(source,answers,true)).toThrow('RM_ANSWERS_INCOMPLETE');
  for(const input of [{unknown:5},{'RM-SR-01-01':'B'},{'RM-SJT-01':5},{'RM-SR-01-01':0},{'RM-SJT-01':'E'}])expect(()=>previewRMReport(source,input)).toThrow();
 });
 it('rejects malformed source and never loads an altered manifest with the original hash',async()=>{
  const source=fixture();expect(()=>validateRMInstrument({...source,scoringPolicy:{defaultWeight:1}})).toThrow();
  expect(()=>validateRMInstrument({...source,sjtItems:source.sjtItems.slice(1)})).toThrow();
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{manifest:source,bundle_sha256:'f'.repeat(64)},error:null})})})})};
  await expect(loadRMInstrument(db as never)).rejects.toThrow('RM_SOURCE_HASH_MISMATCH');
 });
 const privatePath=new URL('../../../private/relationship-management-v4/relationship-management-v4.private.json',import.meta.url);
 it.skipIf(!existsSync(privatePath))('validates the actual private CEO import without disclosing its contents',()=>{
  const raw=readFileSync(privatePath,'utf8'),source=validateRMInstrument(JSON.parse(raw));
  expect(hashRMInstrument(source)).toBe(createHash('sha256').update(raw).digest('hex'));
  expect(rmReadiness(source).counts).toEqual({competencies:9,selfReport:27,sjt:13});
 });
});
