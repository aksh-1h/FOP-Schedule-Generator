# FOP timetable generator

Next.js App Router frontend, Express API, Supabase Auth/PostgreSQL and a bounded whole-college constraint solver. The original specification is preserved in `docs/original-spec.md`.

## Local setup

Requires Node.js 22 or newer. The repository uses a locked npm dependency tree.

```sh
npm ci
cp .env.example .env.local
```

Set the public Supabase URL and publishable key, and the server-only `SUPABASE_SECRET_KEY`. The supplied project credentials have already been configured locally in the ignored `.env.local`. Never add that file to Git. The browser only receives `NEXT_PUBLIC_` variables.

Apply the database schema before signing in:

1. Set `DATABASE_URL` to the Supabase PostgreSQL connection string, then run `npm run db:migrate` and `npm run db:seed`.
2. Alternatively, run `node scripts/prepare-setup.mjs` and execute `supabase/setup.sql` once in the Supabase SQL editor on a **fresh database**. The bundle includes the migration ledger and structural seed. Do not run it on an already-migrated database.
3. Provision an email/password user in Supabase Authentication. Insert their user ID into `admin_profiles`:

```sql
-- One-college administrator:
insert into public.admin_profiles(user_id,college_id)
select 'REPLACE_WITH_AUTH_USER_UUID'::uuid,id from public.colleges where code='PIP';
-- Or Dean (all colleges):
insert into public.admin_profiles(user_id,college_id)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid,null);
```

An absent profile grants no access. Clients have read-only RLS access; only the authenticated API can invoke generation writes with its server credential.

```sh
npm run dev
```

Open http://localhost:3000. Next.js proxies `/api` to Express at `127.0.0.1:4000`. `API_INTERNAL_URL` can target a separately deployed API; the API must be reachable from the Next.js server. For a same-machine deployment:

```sh
npm run build
npm start
```

Use an HTTPS reverse proxy for a public deployment. No hosting account or deployment target was supplied.

## Provided workbooks

The four original workbooks are read without modification. Analysis scripts use `openpyxl` for extraction; it is an analysis-only Python dependency, not an application dependency. Source paths are configured at the top of `scripts/analyze_workbooks.py` and `scripts/reconcile_data.py`.

```sh
python scripts/analyze_workbooks.py
python scripts/reconcile_data.py
node scripts/prepare-setup.mjs
node --env-file=.env.local scripts/import-reviewed.mjs
```

The import command requires migrations and structural seed first. It atomically imports verified subject/room catalogs and lossless source staging. It deliberately does **not** fabricate unresolved faculty maximums, B.Pharm divisions/batches, or conflicting weekly hours. Full source extraction, normalized candidates, discrepancies, and an equivalent SQL-editor import live in ignored `data/import-review/`.

Source audit: 148 subject components (132 in v1, 16 Pharm.D P.B.), 32 room labels, 49 faculty blocks (45 named, 4 unfilled positions), 136 allocation rows, and 591 aggregate faculty slots. All faculty-reported totals reconcile. The B.Pharm sheets duplicated in the M.Pharm workbook are identical and counted once.

The user confirmed that course-wise hours are authoritative, B.Pharm population workloads are equal, and Clerkship uses ten one-hour sessions. Remaining source issues include how to distribute faculty credit allocations, absent exact division/batch assignments and faculty maximums, Biology's missing room/population treatment, and P.B. shared cohorts. Rooms 404 and 407 each require 37 slots against a 36-slot grid. Read the generated reconciliation report before approving live workloads. The `source_import_batches` and `source_import_records` tables preserve this evidence under college RLS.

## Scheduling behavior

- H1–H9 enforce the fixed six-day grid, lunch separation, exact slots, fixed faculty/rooms, and population compatibility. Every successful result passes an independent output validator before it can be saved.
- B.Pharm uses the selected parity and fixed opposite-mode term pairs. M.Pharm and Pharm.D use `academic_terms.is_active`; their lab windows are unrestricted. All terms exist structurally; the reviewed source import marks only M.Pharm semester 2 active.
- Labs and Practice School last exactly three slots and start at slot 1 or 4. Theory and electives last one slot.
- S3 orders candidates to favor faculty gaps. Normal paired modes are tried first, then limited day-level relaxation. At most ten attempts run within a 15-second search budget. Failure after that budget is reported as an incomplete search, **not** proof that no solution exists. No partial timetable is saved.
- Room changes are never used as a relaxation: the user confirmed H8 takes precedence over conflicting S4 wording. Whole-group rows never overlap pooled rows. Elective/main merges require explicit batch scope for the disjoint main population.
- Input datasets and display labels are snapshots. Historical faculty names, subject names, rooms, and populations do not change when current catalogs change. Viewers use the latest successful generation; a failed run leaves it available.
- A SHA-256 fingerprint compares current inputs with the latest successful generation. The Dashboard checks every 30 seconds and on focus. This is a stale-data indicator, not timetable live editing.
- Faculty and subjects use `is_active=false`; deletion is blocked. Active workload assigned to an inactive faculty member fails with an actionable precheck. Inactive subject workload is excluded from new runs.
- A unique running-generation index prevents concurrent runs per college. Results commit through one PostgreSQL transaction. Abandoned runs become retryable after five minutes.

## Data maintenance

There is no CRUD or manual timetable editing UI in v1. Use SQL to maintain fixed faculty/room assignments and workload. `created_at`/`updated_at` track faculty, subject and workload changes. The five unknown college names and unprovided specializations are explicitly labeled placeholders in the structural seed. The reviewed import replaces specialization placeholders with the nine supplied names.

`supabase/demo.sql` is optional **synthetic development data**, never real PIP data. `npm run db:demo` requires an otherwise empty PIP workload and must not be used for the real import.

## Verification

```sh
npm run typecheck
npm test
npm run test:db
npm run test:e2e
npm run build
```

The database integration test uses isolated in-memory PostgreSQL (PGlite); it does not write to Supabase. It verifies schema, seed, full sample generation, atomic persistence, immutable snapshots, soft deletes, Admin/Dean isolation, and source-import idempotency when local source analysis exists. Run `npm run build` before `npm run test:e2e`: browser checks start the production server. They use explicit API fixtures for authenticated UI flows and a real unauthenticated API rejection check. They require Microsoft Edge; change `channel` in `playwright.config.ts` if needed. They do not claim verification of live Supabase accounts or production data.

## Official implementation references

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
