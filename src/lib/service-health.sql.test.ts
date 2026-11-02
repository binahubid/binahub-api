import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

const db = new PGlite();
const migration = readFileSync(
  "supabase/migrations/0081_service_health_report_worker.sql",
  "utf8",
);
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table assessment_jobs(status text,available_at timestamptz,updated_at timestamptz);
    create table pe_report_email_jobs(status text,available_at timestamptz,lease_until timestamptz);
    create table spin_submissions(status text,next_attempt_at timestamptz,lease_until timestamptz,contact jsonb,answers jsonb);
    create table spin_mail_jobs(status text,next_attempt_at timestamptz,lease_until timestamptz,recipient text);
  `);
  await db.exec(migration);
}, 30_000);
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(
    "truncate assessment_jobs,pe_report_email_jobs,spin_submissions,spin_mail_jobs,service_worker_heartbeats",
  );
});
const read = async () =>
  (
    await db.query<{
      value: {
        queues: Array<Record<string, unknown>>;
        worker: Record<string, unknown> | null;
      };
    }>("select read_service_health_snapshot() as value")
  ).rows[0].value;

describe("SQL81 aggregate health and heartbeat (isolated synthetic database)", () => {
  it("reports every queue with no invented heartbeat and is read-only", async () => {
    const result = await read();
    expect(result.worker).toBeNull();
    expect(result.queues).toHaveLength(4);
    expect(
      result.queues.every((queue) => queue.pending === 0 && queue.review === 0),
    ).toBe(true);
    expect(
      (await db.query("select count(*)::int n from service_worker_heartbeats"))
        .rows,
    ).toEqual([{ n: 0 }]);
  });
  it("counts beyond page limits, excludes completed/draft data and respects future retry times", async () => {
    await db.exec(`insert into assessment_jobs select 'pending',now()-interval '11 minutes',now() from generate_series(1,125);
      insert into assessment_jobs values ('pending',now()+interval '1 hour',now()),('completed',now()-interval '1 day',now()),
        ('processing',now(),now()-interval '21 minutes'),('emailing',now(),now()-interval '1 minute'),('uncertain',now(),now());
      insert into pe_report_email_jobs values('processing',now(),now()-interval '1 second'),('pending',now()+interval '1 hour',null),('sent',now(),null);
      insert into spin_submissions values('draft',now()-interval '1 day',null,'{"email":"private@example.invalid"}','{"private":"PRIVATE_ANSWERS"}'),
        ('queued',now()-interval '11 minutes',null,null,null),('processing',now(),now()+interval '1 minute',null,null),('failed',now(),null,null,null);
      insert into spin_mail_jobs values('sending',now(),null,'private@example.invalid'),('uncertain',now(),null,'private@example.invalid');`);
    const result = await read();
    expect(
      result.queues.find((queue) => queue.key === "team_analysis"),
    ).toMatchObject({
      pending: 126,
      processing: 2,
      overdue: 125,
      stalled: 1,
      review: 1,
    });
    expect(
      result.queues.find((queue) => queue.key === "individual_email"),
    ).toMatchObject({
      pending: 1,
      processing: 1,
      overdue: 0,
      stalled: 1,
      review: 0,
      oldestDueAt: null,
    });
    expect(
      result.queues.find((queue) => queue.key === "program_analysis"),
    ).toMatchObject({
      pending: 1,
      processing: 1,
      overdue: 1,
      stalled: 0,
      review: 1,
    });
    expect(
      result.queues.find((queue) => queue.key === "program_email"),
    ).toMatchObject({
      pending: 0,
      processing: 1,
      overdue: 0,
      stalled: 1,
      review: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private@example|PRIVATE_ANSWERS|recipient|answers|contact|run_token/,
    );
    expect(
      (await db.query("select count(*)::int n from assessment_jobs")).rows,
    ).toEqual([{ n: 130 }]);
  });
  it("does not let an older overlapping run overwrite the latest heartbeat", async () => {
    const first = randomUUID(),
      second = randomUUID();
    await db.query("select begin_report_worker_heartbeat($1)", [first]);
    await db.query("select begin_report_worker_heartbeat($1)", [second]);
    expect(
      (
        await db.query("select finish_report_worker_heartbeat($1,$2) ok", [
          first,
          "error",
        ])
      ).rows,
    ).toEqual([{ ok: false }]);
    expect((await read()).worker?.outcome).toBe("running");
    await db.query("select finish_report_worker_heartbeat($1,$2)", [
      second,
      "ok",
    ]);
    const result = await read();
    expect(result.worker).toMatchObject({ outcome: "ok" });
    expect(result.worker?.succeededAt).toBeTruthy();
    expect(
      (
        await db.query("select finish_report_worker_heartbeat($1,$2) ok", [
          second,
          "error",
        ])
      ).rows,
    ).toEqual([{ ok: false }]);
    await db.exec(migration);
    expect((await read()).worker).toEqual(result.worker);
  });
  it("rejects invalid updates and grants no browser read/write/RPC access", async () => {
    await expect(
      db.query("select finish_report_worker_heartbeat($1,'invented')", [
        randomUUID(),
      ]),
    ).rejects.toThrow("WORKER_HEARTBEAT_INVALID");
    for (const role of ["anon", "authenticated"]) {
      for (const fn of [
        "read_service_health_snapshot()",
        "begin_report_worker_heartbeat(uuid)",
        "finish_report_worker_heartbeat(uuid,text)",
      ]) {
        expect(
          (
            await db.query(
              `select has_function_privilege('${role}',$1,'execute') ok`,
              [fn],
            )
          ).rows,
        ).toEqual([{ ok: false }]);
      }
      expect(
        (
          await db.query(
            `select has_table_privilege('${role}','service_worker_heartbeats','select,insert,update,delete') ok`,
          )
        ).rows,
      ).toEqual([{ ok: false }]);
    }
    await db.exec("set role service_role");
    try {
      expect((await read()).queues).toHaveLength(4);
      await db.query("select begin_report_worker_heartbeat($1)", [
        randomUUID(),
      ]);
    } finally {
      await db.exec("reset role");
    }
  });
});
