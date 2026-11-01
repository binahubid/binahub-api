import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import React from 'react';
import {renderToBuffer} from '@react-pdf/renderer';
import {PetaGroupReport} from './contracts';
import {renderPetaIndividualPDF,renderPetaGroupPDF,PetaGroupPDF,PetaIndividualPDF} from './pdf';
import {petaGroupPattern,petaReportNarrative} from './reporting';
import {petaPDFIndividualFixture as individual,petaPDFGroupFixture as group} from './report-fixtures';
type LayoutNode={type:string;box:{top:number;height:number;width:number};props:{render?:unknown;src?:unknown};children:LayoutNode[];value?:string;lines?:{box:{height:number;y:number}}[];style?:{fontSize?:number;lineHeight?:number}};
const content=(node:LayoutNode):string=>[node.value||'',...(node.children||[]).map(content)].join(' ');
const nodes=(node:LayoutNode):LayoutNode[]=>[node,...(node.children||[]).flatMap(nodes)];

describe('PETA PDF reports',()=>{
 it('prints a legible numbered confidentiality footer on every page',async()=>{
  await renderToBuffer(React.cloneElement(PetaGroupPDF({data:group}),{onRender:(props:unknown)=>{
   const pages=(props as {_INTERNAL__LAYOUT__DATA_:{children:LayoutNode[]}})._INTERNAL__LAYOUT__DATA_.children;
   expect(pages).toHaveLength(2);
   for(const [i,page] of pages.entries()){
    const footer=nodes(page).find(node=>node.props?.render)!;
    expect(footer.lines?.length).toBeGreaterThan(0);expect(footer.box.top+footer.box.height).toBeLessThan(842);
    expect(content(page).replace(/\s+/g,' ')).toContain('Rahasia | PETA - BinaHub');
    expect(content(page)).not.toMatch(/internal admin pendamping/i);
    expect(footer.children[0].value).toContain(`${i+1} / 2`);
   }
  }}));
 });
 it('embeds the original logo and keeps text leading stable through pagination in both reports',async()=>{
  const logoPath=path.join(process.cwd(),'public','brand','binahub-wordmark.png');
  expect(createHash('sha256').update(readFileSync(logoPath)).digest('hex')).toBe('b5c2d29be695d4df48669f3295596eeaa4684a53d2e8ddfa309ea4d8c597004a');
  for(const document of [PetaIndividualPDF({data:individual}),PetaGroupPDF({data:group})]){
   await renderToBuffer(React.cloneElement(document,{onRender:(props:unknown)=>{
    const pages=(props as {_INTERNAL__LAYOUT__DATA_:{children:LayoutNode[]}})._INTERNAL__LAYOUT__DATA_.children;
    expect(pages).toHaveLength(2);
    for(const page of pages){
     const logo=nodes(page).find(node=>node.type==='IMAGE');expect(logo?.props.src).toEqual({data:readFileSync(logoPath),format:'png'});expect(logo?.box.width).toBeCloseTo(116);
     for(const node of nodes(page).filter(node=>node.type==='TEXT'&&node.lines?.length&&node.style?.fontSize)){
      expect(node.style?.lineHeight).toBeUndefined();
      for(const line of node.lines!){expect(line.box.height).toBeLessThanOrEqual(node.style!.fontSize!*1.65);}
     }
    }
   }}));
  }
 });
 it('counts ties and balanced patterns descriptively, without averaging NET or ranking',()=>{
  expect(petaGroupPattern(group.members)).toEqual({counts:{D:2,I:2,S:0,C:0},balanced:1,tied:1});
  expect(petaReportNarrative(group.members[1].report.result)).toContain('tertinggi yang sama');
  expect(petaReportNarrative(group.members[2].report.result)).toContain('Tidak ada satu kecenderungan');
 });
 it('rejects inconsistent coverage, missing data, and empty group PDFs',async()=>{
  expect(()=>PetaGroupReport.parse({...group,counts:{...group.counts,included:3}})).toThrow();
  expect(()=>PetaGroupReport.parse({...group,members:[{...group.members[0],report:{...individual.report,result:{...individual.report.result,rows:[]}}}]})).toThrow();
  await expect(renderPetaGroupPDF({...group,counts:{total:0,included:0,unfinished:0,restricted:0,unavailable:0},members:[]})).rejects.toThrow('PETA_NO_REVIEWABLE_RESULTS');
 });
 it('renders real vector PDFs, preserving source numbers and excluding private keys',async()=>{
  const before=JSON.stringify([individual,group]);
  const a=await renderPetaIndividualPDF(individual),b=await renderPetaGroupPDF(group);
  expect(a.subarray(0,5).toString()).toBe('%PDF-');expect(b.subarray(0,5).toString()).toBe('%PDF-');
  expect(a.length).toBeGreaterThan(5000);expect(b.length).toBeGreaterThan(4000);expect(JSON.stringify([individual,group])).toBe(before);
  const dir=process.env.PETA_PDF_PREVIEW_DIR;
  if(dir){mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'peta-individu-contoh.pdf'),a);writeFileSync(path.join(dir,'peta-grup-internal-contoh.pdf'),b);}
 },20000);
 it('paginates a larger group with long participant names without truncating its members',async()=>{
  const members=Array.from({length:37},(_,i)=>({...group.members[i%4],participantName:'Peserta sintetis dengan nama panjang untuk memeriksa pembungkusan baris '+(i+1),report:{...group.members[i%4].report,participantCode:'SYNTHETIC-'+i}}));
  const document=PetaGroupPDF({data:{...group,counts:{total:37,included:37,unfinished:0,restricted:0,unavailable:0},members}});
  const buffer=await renderToBuffer(React.cloneElement(document,{onRender:(props:unknown)=>{
   const pages=(props as {_INTERNAL__LAYOUT__DATA_:{children:LayoutNode[]}})._INTERNAL__LAYOUT__DATA_.children;
   expect(pages.length).toBeGreaterThan(2);
   for(const page of pages.slice(1)){
    expect(content(page)).toContain('Rincian hasil peserta');
    expect(nodes(page).find(node=>node.props?.render)?.lines?.length).toBeGreaterThan(0);
    for(const row of page.children.filter(node=>content(node).includes('Peserta sintetis dengan nama panjang'))){expect(row.box.top+row.box.height).toBeLessThanOrEqual(794);}
   }
   const all=pages.map(content).join(' ');
   for(const member of members)expect(all).toContain(member.participantName);
  }}));
  expect(buffer.subarray(0,5).toString()).toBe('%PDF-');
 },20000);
});
