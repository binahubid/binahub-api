import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

const db = new PGlite();
const admin = randomUUID(),
  alice = randomUUID(),
  bob = randomUUID(),
  client = randomUUID();
let lead: string;
async function rpc<T = Record<string, unknown>>(
  name: string,
  values: unknown[] = [],
): Promise<T> {
  const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
  return (
    await db.query<{ value: T }>(
      `select ${name}(${placeholders}) as value`,
      values,
    )
  ).rows[0].value;
}
const amsProof = (userId: string) => ({
  amsAssociateId: userId,
  verifiedAmsEmail: userId === alice ? "alice@example.invalid" : "bob@example.invalid",
});
const syncMember = async (id: string, name: string, active = true, revision = 1) => {
  const email = id === alice ? "alice@example.invalid" : "bob@example.invalid";
  await db.query("insert into ams_identity_links values($1,$1,$2) on conflict do nothing", [id, email]);
  return rpc("consultant_sync_team", [id,id,id,revision,active?"active":"paused","2026-11-01T00:00:00Z","a".repeat(64),"active","2026-11-01T00:00:00Z",name,email]);
};
const manage = (action: string, data: Record<string, unknown>) => action === "member"
  ? syncMember(String(data.userId), String(data.name), Boolean(data.active), data.active ? 1 : 2)
  : rpc("consultant_manage", [admin, action,
    action === "assign" ? { ...data, ...amsProof(String(data.userId)) } : data]);
const save = (actor: string, version: number, action: string, data: unknown) =>
  rpc("consultant_save_work", [actor, lead, version, action, data]);
const read = (actor = alice, owner = "all", page = 0, search = "") =>
  rpc<{
    records: { id: string; canEdit: boolean; assigneeId: string | null }[];
    total: number;
    summary: Record<string, number>;
  }>("consultant_portal_read", [actor, page, search, owner, "all"]);
const proposal = (actor = alice, hash = "a".repeat(64), version = 2) =>
  rpc<{ id: string; revision: number }>("consultant_store_proposal", [
    actor,
    lead,
    version,
    hash,
    { title: "Synthetic program", amount: 50000000 },
  ]);
const queue = (
  id: string,
  proposalId: string,
  actor = alice,
  envelope = { subject: "Synthetic", body: "Synthetic" },
) =>
  rpc("consultant_queue_message", [
    actor,
    lead,
    2,
    id,
    proposalId,
    "proposal",
    envelope,
    "2020-01-01T00:00:00Z",
  ]);

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now());
    create table ams_identity_links(ams_associate_id uuid primary key,profile_id uuid unique,email text);
    create table profiles(id uuid primary key,role text,full_name text);
    create table leads(id uuid primary key,name text,email text,company text,phone text,opportunity_stage text,
      opportunity_owner text,next_action text,next_action_due_at timestamptz,created_at timestamptz default now(),
      outreach_paused boolean,outreach_pause_reason text,outreach_paused_by text,outreach_paused_at timestamptz,
      pipeline_updated_at timestamptz,lost_reason text,won_at timestamptz,lost_at timestamptz);
    create table spin_submissions(id uuid primary key,contact jsonb,answers jsonb,question_version text,submitted_at timestamptz);
    create table calendar_bookings(id uuid primary key,lead_id uuid,title text,attendee_name text,start_time timestamptz,end_time timestamptz,status text,meeting_url text);
    create table opportunity_activities(id uuid primary key default gen_random_uuid(),lead_id uuid,event_type text,actor text,note text,metadata jsonb,created_at timestamptz default now());`);
  await db.exec(
    readFileSync("supabase/migrations/0090_consultant_portal.sql", "utf8"),
  );
  await db.exec(readFileSync("supabase/migrations/0092_consultant_ams_assignment.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0093_consultant_ams_membership.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec(
    "truncate consultant_messages,consultant_proposals,consultant_tasks,consultant_workspaces,consultant_members,opportunity_activities,calendar_bookings,spin_submissions,leads,profiles,auth.users,ams_identity_links cascade",
  );
  for (const [id, role, name] of [
    [admin, "admin", "Admin"],
    [alice, "consultant", "Alice"],
    [bob, "facilitator", "Bob"],
    [client, "client", "Client"],
  ]) {
    await db.query("insert into profiles values($1,$2,$3)", [id, role, name]);
    await db.query("insert into auth.users values($1,$2)", [
      id,
      `${name.toLowerCase()}@example.invalid`,
    ]);
  }
  for (const [userId, name] of [
    [alice, "Alice"],
    [bob, "Bob"],
  ])
    await manage("member", { userId, name, active: true });
  lead = randomUUID();
  await db.query(
    `insert into leads(id,name,email,company,opportunity_stage) values($1,'Client','client@example.invalid','Synthetic Org','consultation')`,
    [lead],
  );
  await manage("assign", { leadId: lead, userId: alice, version: 0 });
});
afterAll(() => db.close());

describe("SQL90/92 consultant portal authorization and workflow", () => {
  it("grants access only from accepted AMS membership and prevents stale activation after revocation", async () => {
    await expect(rpc("consultant_manage",[admin,"member",{userId:bob,name:"Bob",active:true}]))
      .rejects.toThrow("CONSULTANT_MANAGE_IN_AMS");
    await syncMember(alice,"Alice",false,2);
    await expect(read(alice)).rejects.toThrow("CONSULTANT_FORBIDDEN");
    expect(await syncMember(alice,"Alice",true,1)).toMatchObject({stale:true});
    await expect(read(alice)).rejects.toThrow("CONSULTANT_FORBIDDEN");
    await expect(syncMember(alice,"Alice",true,2)).rejects.toThrow("CONSULTANT_CONFLICT");
    await syncMember(alice,"Alice",true,3);
    expect((await read(alice)).total).toBe(1);
    await db.query("update consultant_members set ams_membership_id=null where user_id=$1",[alice]);
    await expect(read(alice)).rejects.toThrow("CONSULTANT_FORBIDDEN");
  });
  it("requires Portal verification for a new consultant owner while preserving Pipeline's regular owners", async () => {
    await expect(db.query("update leads set opportunity_owner=$1 where id=$2", [
      "bob@example.invalid",
      lead,
    ])).rejects.toThrow("CONSULTANT_ASSIGN_VIA_PORTAL");
    expect((await read(alice)).records[0].assigneeId).toBe(alice);
    await manage("assign", { leadId: lead, userId: bob, version: 1 });
    expect((await read(alice)).records[0]).toMatchObject({
      assigneeId: bob,
      canEdit: false,
    });
    expect((await read(bob)).records[0]).toMatchObject({
      assigneeId: bob,
      canEdit: true,
    });
    await db.query("update leads set opportunity_owner=$1 where id=$2", [
      "different@example.invalid",
      lead,
    ]);
    expect((await read(bob)).records[0]).toMatchObject({
      assigneeId: null,
      canEdit: false,
    });
  });

  it("does not assign an unverified or mismatched AMS identity", async () => {
    const data = { leadId: lead, userId: bob, version: 1 };
    await expect(rpc("consultant_manage", [admin, "assign", data]))
      .rejects.toThrow("CONSULTANT_AMS_REQUIRED");
    await expect(rpc("consultant_manage", [admin, "assign", { ...data, ...amsProof(alice) }]))
      .rejects.toThrow("CONSULTANT_AMS_REQUIRED");
    await db.query("update auth.users set email='changed@example.invalid' where id=$1", [bob]);
    expect((await db.query("select * from consultant_ams_roster($1)", [bob])).rows).toEqual([]);
    await expect(manage("assign", data)).rejects.toThrow("CONSULTANT_INVALID_MEMBER");
    expect((await read(alice)).records[0].assigneeId).toBe(alice);
  });

  it("keeps the verified APP roster private and omits unconfirmed logins", async () => {
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [bob]);
    expect((await db.query("select user_id from consultant_ams_roster()")).rows).toEqual([{ user_id: alice }]);
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select * from consultant_ams_roster()")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role"); }
  });

  it("paginates the team agenda and allows a read-only consultant to filter the assigned tasks", async () => {
    for (let n = 1; n <= 21; n++) {
      await save(alice, n, "task", {
        id: randomUUID(),
        title: `Task ${n}`,
        dueAt: "2099-01-01T00:00:00Z",
      });
    }
    expect(
      await rpc("consultant_agenda", [bob, 1, alice, "tasks"]),
    ).toMatchObject({
      total: 21,
      page: 1,
      records: [expect.objectContaining({ lead_id: lead })],
    });
    expect(
      await rpc("consultant_agenda", [bob, 0, "mine", "tasks"]),
    ).toMatchObject({ total: 0, records: [] });
  });

  it("cancels a scheduled proposal when the checklist changes and requires a fresh proposal for handoff", async () => {
    await save(alice, 1, "meeting", {
      answers: {},
      notes: "Initial",
      status: "completed",
    });
    const p = await proposal();
    const id = randomUUID();
    await queue(id, p.id);
    await save(alice, 2, "meeting", {
      answers: {},
      notes: "Updated scope",
      status: "completed",
    });
    expect(
      await rpc("consultant_claim_message", [randomUUID(), id]),
    ).toBeNull();
    await expect(
      rpc("consultant_queue_message", [
        alice,
        lead,
        3,
        randomUUID(),
        p.id,
        "proposal",
        {},
        "2020-01-01T00:00:00Z",
      ]),
    ).rejects.toThrow("CONSULTANT_STALE_PROPOSAL");
    await expect(
      save(alice, 3, "handoff", { note: "Approved" }),
    ).rejects.toThrow("CONSULTANT_PROPOSAL_REQUIRED");
  });
  it("lets every consultant read team work and scopes writes to the assigned account", async () => {
    expect((await read()).records[0]).toMatchObject({
      id: lead,
      assigneeId: alice,
      canEdit: true,
    });
    expect((await read(bob)).records[0]).toMatchObject({
      id: lead,
      assigneeId: alice,
      canEdit: false,
    });
    expect(await read(bob, "mine")).toMatchObject({ total: 0 });
    await expect(
      save(bob, 1, "activity", { note: "Not authorized" }),
    ).rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
    expect(
      await rpc("consultant_portal_detail", [bob, lead, 0]),
    ).toHaveProperty("record");
    await save(alice, 1, "activity", { note: "Client replied" });
    await expect(save(alice, 1, "activity", { note: "Stale" })).rejects.toThrow(
      "CONSULTANT_CONFLICT",
    );
  });
  it("denies client/admin operations even when IDs and RPC names are known", async () => {
    await expect(read(client)).rejects.toThrow("CONSULTANT_FORBIDDEN");
    await expect(
      rpc("consultant_manage", [
        alice,
        "assign",
        { leadId: lead, userId: bob, version: 1 },
      ]),
    ).rejects.toThrow("CONSULTANT_ADMIN_REQUIRED");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(read(admin)).rejects.toThrow(/permission denied/);
      await expect(
        db.query("select * from consultant_workspaces"),
      ).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });
  it("keeps distinct opportunities from the same company independently assigned", async () => {
    const other = randomUUID();
    await db.query(
      `insert into leads(id,name,email,company) values($1,'Client','client@example.invalid','Synthetic Org')`,
      [other],
    );
    await manage("assign", { leadId: other, userId: bob, version: 0 });
    const data = await read();
    expect(data.total).toBe(2);
    expect(data.records.find((row) => row.id === other)?.canEdit).toBe(false);
    expect((await read(alice, "mine")).records.map((row) => row.id)).toEqual([
      lead,
    ]);
  });
  it("counts/searches before pagination and exposes unassigned work read-only", async () => {
    await db.exec(
      `insert into leads(id,name,email,company) select gen_random_uuid(),'Synthetic '||i,'test'||i||'@example.invalid','Other' from generate_series(1,1005)i`,
    );
    expect((await read()).total).toBe(1006);
    expect((await read(alice, "all", 50)).records).toHaveLength(6);
    expect((await read(alice, "all", 0, "Synthetic 1005")).total).toBe(1);
    expect(
      (await read(alice, "unassigned")).records.every(
        (row) => row.canEdit === false,
      ),
    ).toBe(true);
  });
  it("blocks deactivated or downgraded accounts while retaining the shared archive", async () => {
    await manage("member", { userId: alice, name: "Alice", active: false });
    await expect(read()).rejects.toThrow("CONSULTANT_FORBIDDEN");
    expect((await read(bob)).total).toBe(1);
    await db.query("update profiles set role='client' where id=$1", [bob]);
    await expect(read(bob)).rejects.toThrow("CONSULTANT_FORBIDDEN");
  });
  it("preserves source answers and rejects a draft/unrelated submission", async () => {
    const source = randomUUID();
    await db.query(
      `insert into spin_submissions values($1,'{"email":"client@example.invalid"}','{"example":"Original"}','spin-v3.2-ceo-2026-10-22',null)`,
      [source],
    );
    await expect(
      save(alice, 1, "source", { sourceId: source }),
    ).rejects.toThrow("CONSULTANT_INVALID_SOURCE");
    await db.query(
      "update spin_submissions set submitted_at=now() where id=$1",
      [source],
    );
    await save(alice, 1, "source", { sourceId: source });
    await save(alice, 2, "meeting", {
      answers: { example: "Clarification" },
      notes: "",
      status: "completed",
    });
    expect(
      (
        await db.query<{ answers: object }>(
          "select answers from spin_submissions",
        )
      ).rows[0].answers,
    ).toEqual({ example: "Original" });
    await expect(
      save(alice, 3, "source", { sourceId: source }),
    ).rejects.toThrow("CONSULTANT_SOURCE_LOCKED");
  });
  it("validates completion, creates one proposal snapshot per input and protects colleague proposals", async () => {
    await expect(proposal(alice, "a".repeat(64), 1)).rejects.toThrow(
      "CONSULTANT_CHECKLIST_REQUIRED",
    );
    await save(alice, 1, "meeting", {
      answers: {},
      notes: "Ready",
      status: "completed",
    });
    const first = await proposal();
    expect(await proposal()).toEqual(first);
    expect((await proposal(alice, "b".repeat(64))).revision).toBe(2);
    await expect(proposal(bob)).rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
  });
  it("requires task and message IDs to belong to the authorized opportunity", async () => {
    const task = randomUUID();
    await save(alice, 1, "task", {
      id: task,
      title: "Call client",
      dueAt: "2099-01-01",
    });
    await expect(
      save(bob, 2, "complete_task", { taskId: task, revision: 1 }),
    ).rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
    await expect(
      save(alice, 2, "complete_task", { taskId: randomUUID(), revision: 1 }),
    ).rejects.toThrow("CONSULTANT_CONFLICT");
    await save(alice, 2, "complete_task", { taskId: task, revision: 1 });
  });
  it("queues idempotently, claims once and prevents reassignment while a send is in flight", async () => {
    await save(alice, 1, "meeting", {
      answers: {},
      notes: "",
      status: "completed",
    });
    const p = await proposal(),
      message = randomUUID(),
      lease = randomUUID();
    const first = await queue(message, p.id);
    expect(await queue(message, p.id)).toEqual(first);
    await expect(
      queue(message, p.id, alice, { subject: "Changed", body: "Changed" }),
    ).rejects.toThrow("CONSULTANT_CONFLICT");
    expect(
      await rpc("consultant_claim_message", [lease, message]),
    ).toHaveProperty("id", message);
    expect(
      await rpc("consultant_claim_message", [randomUUID(), message]),
    ).toBeNull();
    await expect(
      manage("assign", { leadId: lead, userId: bob, version: 2 }),
    ).rejects.toThrow("CONSULTANT_SEND_IN_FLIGHT");
    expect(
      await rpc("consultant_finish_message", [
        message,
        randomUUID(),
        "accepted",
        "wrong",
        null,
      ]),
    ).toBe(false);
    expect(
      await rpc("consultant_finish_message", [
        message,
        lease,
        "accepted",
        "provider-id",
        null,
      ]),
    ).toBe(true);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from consultant_proposals",
        )
      ).rows[0].status,
    ).toBe("sent");
  });
  it("cancels queued old-owner messages on reassignment and removes old-owner write capability", async () => {
    await save(alice, 1, "meeting", {
      answers: {},
      notes: "",
      status: "completed",
    });
    const p = await proposal(),
      message = randomUUID();
    await queue(message, p.id);
    await manage("assign", { leadId: lead, userId: bob, version: 2 });
    expect((await read()).records[0].canEdit).toBe(false);
    expect((await read(bob)).records[0].canEdit).toBe(true);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from consultant_messages",
        )
      ).rows[0].status,
    ).toBe("cancelled");
    await expect(
      save(alice, 3, "activity", { note: "Old owner" }),
    ).rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
  });
  it("marks interrupted processing uncertain and never blindly resends it", async () => {
    await save(alice, 1, "meeting", {
      answers: {},
      notes: "",
      status: "completed",
    });
    const p = await proposal(),
      message = randomUUID();
    await queue(message, p.id);
    await rpc("consultant_claim_message", [randomUUID(), message]);
    await db.query(
      "update consultant_messages set lease_until=now()-interval '1 minute' where id=$1",
      [message],
    );
    await rpc("consultant_expire_messages");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from consultant_messages",
        )
      ).rows[0].status,
    ).toBe("uncertain");
    expect(
      await rpc("consultant_claim_message", [randomUUID(), message]),
    ).toBeNull();
  });
});
