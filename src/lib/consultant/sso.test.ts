import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({db:vi.fn(),assert:vi.fn(),link:vi.fn(),insert:vi.fn(),consume:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase",()=>({createServerSupabase:mock.db}));
vi.mock("./membership",()=>({assertActiveConsultantMembership:mock.assert}));
vi.mock("@/lib/public-app-url",()=>({resolvePublicAppUrl:()=>"https://app.example.com"}));
import {claimAmsAccessSession,createAmsAccessTicket} from "@/lib/ams-integration";
const id="11111111-1111-4111-8111-111111111111",associate="22222222-2222-4222-8222-222222222222";
beforeEach(()=>{
  vi.resetAllMocks();mock.assert.mockResolvedValue(undefined);
  mock.consume.mockResolvedValue({data:[{email:"alice@example.com",next_path:"/konsultan"}],error:null});
  mock.link.mockResolvedValue({data:{properties:{hashed_token:"temporary-magic-link"}},error:null});
  mock.insert.mockResolvedValue({error:null});
  mock.db.mockReturnValue({
    auth:{admin:{listUsers:async()=>({data:{users:[{id,email:"alice@example.com"}]},error:null}),generateLink:mock.link}},
    rpc:mock.consume,
    from:(table:string)=>{const q={
      select:()=>q,eq:()=>q,update:()=>q,upsert:async()=>({error:null}),insert:mock.insert,
      maybeSingle:async()=>({data:table==="profiles"?{id,role:"consultant"}:{profile_id:id,email:"alice@example.com",last_event_at:"2020-01-01"},error:null}),
      then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve),
    };return q;},
  });
});
describe("AMS consultant access ticket",()=>{
  it("creates a short-lived, hashed one-use ticket only after membership verification",async()=>{
    const result=await createAmsAccessTicket({id:associate,email:"alice@example.com",fullName:"Alice",status:"active"},"/konsultan");
    expect(mock.assert).toHaveBeenCalledWith(id);
    const ticket=new URL(result.url).searchParams.get("ticket");
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({
      profile_id:id,next_path:"/konsultan",token_hash:expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(JSON.stringify(mock.insert.mock.calls)).not.toContain(ticket);
    expect(Date.parse(result.expiresAt)-Date.now()).toBeLessThanOrEqual(300000);
  });
  it("rechecks active membership when consuming a previously issued ticket",async()=>{
    mock.assert.mockRejectedValue(new Error("CONSULTANT_FORBIDDEN"));
    await expect(claimAmsAccessSession("synthetic-ticket")).rejects.toThrow("CONSULTANT_FORBIDDEN");
    expect(mock.link).not.toHaveBeenCalled();
    mock.assert.mockResolvedValue(undefined);
    expect(await claimAmsAccessSession("synthetic-ticket")).toMatchObject({nextPath:"/konsultan"});
  });
  it("cannot create access for an inactive associate or reuse a consumed ticket",async()=>{
    await expect(createAmsAccessTicket({id:associate,email:"alice@example.com",fullName:"Alice",status:"suspended"},"/konsultan"))
      .rejects.toThrow("tidak aktif");
    mock.consume.mockResolvedValue({data:[],error:null});
    expect(await claimAmsAccessSession("already-used")).toBeNull();
    expect(mock.link).not.toHaveBeenCalled();
  });
});
