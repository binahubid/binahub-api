import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase',()=>({createServerSupabase:vi.fn()}));
import { MeetingCreateSchema, validateMeetingWrite } from './meeting';

describe('internal meeting answer overlays',()=>{
 it('preserves original evidence and keeps only meaningful active additions',()=>{
  const original={role:'R1'};
  const result=validateMeetingWrite({revision:0,answers:{industry:'IND1'},notes:' Follow up ',status:'in_progress'},original);
  expect(original).toEqual({role:'R1'});expect(result.answers).toEqual({industry:'IND1'});expect(result.notes).toBe('Follow up');
 });
 it('rejects unknown keys, invalid choices, excessive notes and incomplete completion',()=>{
  const body={revision:0,answers:{},notes:'',status:'in_progress'};
  expect(()=>validateMeetingWrite({...body,answers:{madeUp:'x'}},{})).toThrow();
  expect(()=>validateMeetingWrite({...body,answers:{role:'fake'}},{})).toThrow();
  expect(()=>validateMeetingWrite({...body,notes:'x'.repeat(4001)},{})).toThrow();
  expect(()=>validateMeetingWrite({...body,status:'completed'},{})).toThrow('SPIN_ANSWERS_INVALID');
 });
 it('requires recorded notice for admin-led meetings and does not accept identity/role injection',()=>{
  const create={id:'11111111-1111-4111-8111-111111111111',contact:{name:'Example',company:'Example',email:'example@example.invalid'},processingNoticeConfirmed:true};
  expect(MeetingCreateSchema.safeParse(create).success).toBe(true);
  expect(MeetingCreateSchema.safeParse({...create,processingNoticeConfirmed:false}).success).toBe(false);
  expect(MeetingCreateSchema.safeParse({...create,actorId:'fake'}).success).toBe(false);
 });
});
