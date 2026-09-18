import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { strict as assert } from "node:assert";
import { solve } from "../server/solver";
import type { Dataset } from "../src/lib/types";
const pg = new PGlite();
await pg.exec(
  `create schema auth; create table auth.users(id uuid primary key); create role authenticated; create role service_role; create role anon; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
);
for (const f of readdirSync("supabase/migrations").sort())
  await pg.exec(
    readFileSync(`supabase/migrations/${f}`, "utf8").replace(/^\uFEFF/, ""),
  );
await pg.exec(readFileSync("supabase/seed.sql", "utf8"));
await pg.exec(readFileSync("supabase/demo.sql", "utf8"));
const [{ id: col }] = (
  await pg.query<{ id: string }>(`select id from colleges where code='PIP'`)
).rows;
const [{ data }] = (
  await pg.query<{ data: Dataset }>(`select college_dataset($1) as data`, [col])
).rows;
assert.equal(data.groups.length, 57);
assert.equal(data.subject_workload.length, 146);
const result = solve(data, "even", { maxMs: 20000 });
assert.equal(result.status, "success", JSON.stringify(result.conflicts));
const [{ id: run }] = (
  await pg.query<{ id: string }>(
    `insert into timetable_generations(college_id,status,active_parity,input_snapshot) values($1,'running','even',$2) returning id`,
    [col, JSON.stringify(data)],
  )
).rows;
await pg.query(`select finish_generation($1,$2)`, [
  run,
  JSON.stringify(result),
]);
const status = (
  await pg.query<{ status: string }>(
    `select status from timetable_generations where id=$1`,
    [run],
  )
).rows[0].status;
assert.equal(status, "success");
const f = data.faculty[0];
await pg.query(
  `update faculty set is_active=false,name='Changed after generation' where id=$1`,
  [f.id],
);
const snapshot = (
  await pg.query<{ input_snapshot: Dataset }>(
    `select input_snapshot from timetable_generations where id=$1`,
    [run],
  )
).rows[0].input_snapshot;
assert.notEqual(snapshot.faculty[0].name, "Changed after generation");
await assert.rejects(
  () => pg.query(`delete from faculty where id=$1`, [f.id]),
  /is_active=false/,
);
const admin = "00000000-0000-4000-8000-000000000001",
  dean = "00000000-0000-4000-8000-000000000002",
  outsider = "00000000-0000-4000-8000-000000000003";
await pg.query(`insert into auth.users(id) values($1),($2),($3)`, [
  admin,
  dean,
  outsider,
]);
await pg.query(
  `insert into admin_profiles(user_id,college_id) values($1,$2),($3,null)`,
  [admin, col, dean],
);
await pg.exec(`set role authenticated`);
await pg.query(`select set_config('request.jwt.claim.sub',$1,false)`, [admin]);
assert.equal((await pg.query("select * from colleges")).rows.length, 1);
assert.equal(
  (await pg.query("select * from faculty")).rows.length,
  data.faculty.length,
);
await assert.rejects(() =>
  pg.query(`insert into colleges(code,name) values('BAD','BAD')`),
);
await assert.rejects(() =>
  pg.query(`select finish_generation($1,$2)`, [run, JSON.stringify(result)]),
);
await pg.query(`select set_config('request.jwt.claim.sub',$1,false)`, [dean]);
assert.equal((await pg.query("select * from colleges")).rows.length, 6);
await pg.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
  outsider,
]);
assert.equal((await pg.query("select * from colleges")).rows.length, 0);
assert.equal((await pg.query("select * from subjects")).rows.length, 0);
assert.equal(
  (await pg.query("select * from timetable_entries")).rows.length,
  0,
);
await pg.exec("reset role");
if (existsSync("data/import-review/normalized-staging.json")) {
  const input = JSON.parse(
      readFileSync("data/import-review/normalized-staging.json", "utf8"),
    ),
    raw = JSON.parse(
      readFileSync("data/import-review/source-extraction.json", "utf8"),
    );
  const result = (
    await pg.query<{
      r: {
        subjects_inserted: number;
        rooms_inserted: number;
        workloads_inserted: number;
      };
    }>("select import_reviewed_catalog($1,$2,$3,$4) r", [
      col,
      JSON.stringify(input),
      JSON.stringify(raw),
      "local-test-hash",
    ])
  ).rows[0].r;
  assert.equal(result.subjects_inserted, 132);
  assert.equal(result.rooms_inserted, 32);
  assert.equal(result.workloads_inserted, 0);
  const again = (
    await pg.query<{ r: { already_imported: boolean } }>(
      "select import_reviewed_catalog($1,$2,$3,$4) r",
      [col, JSON.stringify(input), JSON.stringify(raw), "local-test-hash"],
    )
  ).rows[0].r;
  assert.equal(again.already_imported, true);
  assert.equal(
    (await pg.query("select * from subject_workload")).rows.length,
    146,
  );
  console.log(
    "Actual source catalog import and idempotency verified locally; no disputed workload rows inserted.",
  );
}
await pg.close();
console.log(
  "Database migrations, full demo solve, transactional output, soft deletes, immutable display snapshots and RLS checks passed.",
);
