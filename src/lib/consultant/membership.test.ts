import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({row:vi.fn(),ams:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/ams-client",()=>({callAms:mock.ams}));
vi.mock("@/lib/supabase",()=>({createServerSupabase:()=>({
  from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:mock.row};return q;},
})}));
import {assertActiveConsultantMembership} from "./membership";
beforeEach(()=>{
  vi.resetAllMocks();
  mock.row.mockResolvedValue({data:{active:true,email:"alice@example.com",ams_associate_id:"ams-account",ams_membership_id:"team",ams_status:"active",agreement_accepted_at:"2026-11-12"},error:null});
  mock.ams.mockResolvedValue({success:true,active:true});
});
describe("Current consultant membership checks",()=>{
  it("verifies the current AMS membership and bound email on every request",async()=>{
    await assertActiveConsultantMembership("profile");
    expect(mock.ams).toHaveBeenCalledWith("/api/integrations/app/consultant-team/check",{
      associateId:"ams-account",membershipId:"team",email:"alice@example.com",
    });
    mock.ams.mockResolvedValue({success:true,active:false});
    await expect(assertActiveConsultantMembership("profile")).rejects.toThrow("CONSULTANT_FORBIDDEN");
  });
  it("cannot use an older manual portal grant without membership acceptance",async()=>{
    mock.row.mockResolvedValue({data:{active:true},error:null});
    await expect(assertActiveConsultantMembership("profile")).rejects.toThrow("CONSULTANT_FORBIDDEN");
    expect(mock.ams).not.toHaveBeenCalled();
  });
  it("fails closed when either database or AMS is unavailable",async()=>{
    mock.ams.mockRejectedValue(new Error("Unavailable"));
    await expect(assertActiveConsultantMembership("profile")).rejects.toThrow("CONSULTANT_AMS_UNAVAILABLE");
    mock.row.mockResolvedValue({error:{code:"missing"}});
    await expect(assertActiveConsultantMembership("profile")).rejects.toThrow("CONSULTANT_AMS_UNAVAILABLE");
  });
});
