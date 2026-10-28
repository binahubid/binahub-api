import {describe,it,expect} from 'vitest';
import {meetingPublicHtml} from './meeting-public-copy';
describe('owner marketing copy revision',()=>{
 it('updates human text without breaking routes or tracking template variables',()=>{
  const html=meetingPublicHtml('<p>16 tahun melalui Bina Daya Nugraha. Diagnosa dan Assessment.</p><a href="/assessment">{{assessment_url}}</a>');
  expect(html).toContain('20 tahun lebih');expect(html).not.toContain('Bina Daya Nugraha');expect(html).toContain('Diagnosis dan Self Diagnostic');
  expect(html).toContain('href="/assessment"');expect(html).toContain('{{assessment_url}}');
 });
});
