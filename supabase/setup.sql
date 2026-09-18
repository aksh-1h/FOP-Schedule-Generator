-- FRESH DATABASE setup. Run once in Supabase SQL editor. Contains no credentials or personal source data.
begin;
create table if not exists public.fop_migrations(name text primary key,applied_at timestamptz default now());

-- supabase/migrations/001_schema.sql
-- ─────────────────────────────────────────────────────────────
-- Organizational hierarchy
-- ─────────────────────────────────────────────────────────────

CREATE TABLE colleges (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,       -- 'Parul Institute of Pharmacy'
  code  TEXT NOT NULL UNIQUE -- 'PIP'
);

CREATE TABLE courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id   UUID NOT NULL REFERENCES colleges(id),
  name         TEXT NOT NULL,        -- 'BPHARM' | 'MPHARM' | 'PHARMD'
  term_unit    TEXT NOT NULL CHECK (term_unit IN ('semester','year')),
  total_terms  INT  NOT NULL,        -- 8 / 4 / 5
  UNIQUE (college_id, name)
);

CREATE TABLE academic_terms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id      UUID NOT NULL REFERENCES courses(id),
  term_number    INT  NOT NULL,      -- 1..8 / 1..4 / 1..5
  academic_year  TEXT,               -- '2026-27'
  UNIQUE (course_id, term_number, academic_year)
);

-- Generic "Group": Division (BPHARM) | Specialization (MPHARM) | year-group (PHARMD)
CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id     UUID NOT NULL REFERENCES academic_terms(id),
  name        TEXT NOT NULL,         -- 'Division A', 'Pharmacology Spec.', 'Year 3'
  group_type  TEXT NOT NULL CHECK (group_type IN ('division','specialization','year_group'))
);

-- Batch — only ever populated for BPHARM divisions (lab split)
CREATE TABLE batches (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID NOT NULL REFERENCES groups(id),
  name      TEXT NOT NULL            -- 'Batch A' .. 'Batch D'
);

-- Fixed pairing of BPHARM semesters that coordinate lab-window modes.
-- One row per pair: (Sem1,Sem3), (Sem5,Sem7), (Sem2,Sem4), (Sem6,Sem8).
-- BPHARM only — never populated for MPHARM/PHARMD terms.
CREATE TABLE term_pairs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_a_id  UUID NOT NULL REFERENCES academic_terms(id),
  term_b_id  UUID NOT NULL REFERENCES academic_terms(id),
  UNIQUE (term_a_id, term_b_id)
);

-- Pooled batches: covers BOTH Practice School (Special) and Elective
-- offerings — a term-wide population split into named, independently
-- staffed sub-groups. 'kind' distinguishes them for display/filtering;
-- duration is driven by the referencing subject's session_type (§7 subjects).
CREATE TABLE pooled_batches (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id  UUID NOT NULL REFERENCES academic_terms(id),
  kind     TEXT NOT NULL CHECK (kind IN ('practice_school','elective')),
  name     TEXT NOT NULL   -- 'PS Batch 1'..'PS Batch 6', 'Elective: Pharmacoeconomics'
);

-- ─────────────────────────────────────────────────────────────
-- People, rooms, subjects
-- ─────────────────────────────────────────────────────────────

-- "Living" data — will get a Manage Faculty UI later. created_at/updated_at
-- included now so that future UI has an audit trail from day one.
CREATE TABLE faculty (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id                    UUID NOT NULL REFERENCES colleges(id),
  name                          TEXT NOT NULL,
  initials                      TEXT NOT NULL,
  max_workload_slots_per_week   INT  NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Static/fixed by department policy — plain catalog. Room "dedication" and
-- the shared-classroom pattern (§6.1) are properties of how the seed data
-- uses room_id in subject_workload, not constraints stored here.
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id  UUID NOT NULL REFERENCES colleges(id),
  room_no     TEXT NOT NULL,
  room_type   TEXT NOT NULL CHECK (room_type IN ('lecture','lab')),
  UNIQUE (college_id, room_no)
);

-- Theory/lab/practice_school/elective components of "the same" subject are
-- separate rows (different faculty/room/workload), optionally linked via
-- parent_subject_id. Duration is implied by session_type:
--   theory = 1 slot | lab = 3 slots | practice_school = 3 slots | elective = 1 slot
CREATE TABLE subjects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  session_type       TEXT NOT NULL CHECK (session_type IN ('theory','lab','practice_school','elective')),
  parent_subject_id  UUID REFERENCES subjects(id)
);

-- ─────────────────────────────────────────────────────────────
-- THE core input the solver reads — "living" data, see faculty note above
-- ─────────────────────────────────────────────────────────────

CREATE TABLE subject_workload (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id       UUID NOT NULL REFERENCES subjects(id),
  term_id          UUID NOT NULL REFERENCES academic_terms(id),
  scope_type       TEXT NOT NULL CHECK (scope_type IN ('group','batch','pooled')),
  group_id         UUID REFERENCES groups(id),
  batch_id         UUID REFERENCES batches(id),
  pooled_batch_id  UUID REFERENCES pooled_batches(id),
  faculty_id       UUID NOT NULL REFERENCES faculty(id),   -- pre-fixed, not solver-chosen
  room_id          UUID NOT NULL REFERENCES rooms(id),     -- pre-fixed, not solver-chosen
  slots_per_week   INT  NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope_type = 'group'  AND group_id IS NOT NULL AND batch_id IS NULL     AND pooled_batch_id IS NULL) OR
    (scope_type = 'batch'  AND group_id IS NOT NULL AND batch_id IS NOT NULL AND pooled_batch_id IS NULL) OR
    (scope_type = 'pooled' AND group_id IS NULL     AND batch_id IS NULL     AND pooled_batch_id IS NOT NULL)
  )
);

-- ─────────────────────────────────────────────────────────────
-- Fixed grid reference (7 rows: 6 teaching + 1 lunch)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE time_slots (
  id            INT PRIMARY KEY,
  order_index   INT  NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_break      BOOLEAN NOT NULL DEFAULT FALSE
);
-- Seed rows:
-- (1,1,'9:30–10:30', '09:30','10:30', false)  -- morning window: 1-3
-- (2,2,'10:30–11:30','10:30','11:30', false)
-- (3,3,'11:30–12:30','11:30','12:30', false)
-- (4,4,'Lunch',       '12:30','13:30', true)
-- (5,5,'1:30–2:30',   '13:30','14:30', false)  -- afternoon window: 4-6
-- (6,6,'2:30–3:30',   '14:30','15:30', false)
-- (7,7,'3:30–4:25',   '15:30','16:25', false)
-- The solver only ever schedules onto rows where is_break = false; the
-- teaching slot numbers used elsewhere in this doc (1-6) map to
-- order_index values 1,2,3,5,6,7 (skipping 4 = lunch).

-- ─────────────────────────────────────────────────────────────
-- Generation runs & output
-- ─────────────────────────────────────────────────────────────

CREATE TABLE timetable_generations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id       UUID NOT NULL REFERENCES colleges(id),
  active_parity    TEXT CHECK (active_parity IN ('odd','even')), -- which 4 BPHARM sems are live this run
  status           TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  conflict_report  JSONB     -- structured list of conflicts when status = 'failed'
);

-- Which lab-window mode each BPHARM term was assigned for a specific
-- generation run (§6.1). One row per active BPHARM term per generation.
CREATE TABLE generation_term_modes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id  UUID NOT NULL REFERENCES timetable_generations(id),
  term_id        UUID NOT NULL REFERENCES academic_terms(id),
  lab_window     TEXT NOT NULL CHECK (lab_window IN ('morning','afternoon')),
  UNIQUE (generation_id, term_id)
);

-- Every cell the solver produces — either a real placement of a
-- subject_workload row, or a solver-generated idle/free block (§6.3).
CREATE TABLE timetable_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id         UUID NOT NULL REFERENCES timetable_generations(id),
  entry_type            TEXT NOT NULL CHECK (entry_type IN ('placement','idle')),
  subject_workload_id   UUID REFERENCES subject_workload(id),  -- required for 'placement', null for 'idle'
  -- denormalized for fast filtering on the 3 viewer pages; null for 'idle'
  faculty_id            UUID REFERENCES faculty(id),
  room_id                UUID REFERENCES rooms(id),
  -- population this entry covers — whichever of these apply
  term_id               UUID NOT NULL REFERENCES academic_terms(id),
  group_id              UUID REFERENCES groups(id),
  batch_id              UUID REFERENCES batches(id),
  pooled_batch_id       UUID REFERENCES pooled_batches(id),
  -- idle-only fields
  idle_label            TEXT,   -- e.g. 'Practice School' or 'Free Period' — what the admin sees
  idle_reason           TEXT CHECK (idle_reason IN ('practice_school_pool','schedule_adjustment')),
  day_of_week           TEXT NOT NULL CHECK (day_of_week IN ('mon','tue','wed','thu','fri','sat')),
  start_slot            INT  NOT NULL,   -- 1..6 (teaching-slot numbering, see time_slots note above)
  end_slot              INT  NOT NULL,   -- = start_slot for 1-slot entries; start_slot + 2 for 3-slot entries
  CHECK (
    (entry_type = 'placement' AND subject_workload_id IS NOT NULL AND faculty_id IS NOT NULL AND room_id IS NOT NULL AND idle_label IS NULL) OR
    (entry_type = 'idle'      AND subject_workload_id IS NULL     AND faculty_id IS NULL     AND room_id IS NULL     AND idle_label IS NOT NULL)
  )
);

-- ─────────────────────────────────────────────────────────────
-- Auth scoping
-- ─────────────────────────────────────────────────────────────

-- Supabase Auth owns auth.users. college_id = NULL means this user is a
-- Dean (access to every college); a specific college_id scopes a regular
-- Admin to just that one college.
CREATE TABLE admin_profiles (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id),
  college_id  UUID REFERENCES colleges(id)
);


insert into public.fop_migrations(name) values('supabase/migrations/001_schema.sql');

-- supabase/migrations/002_integrity_security.sql
-- Additions to the supplied schema: safe history, soft deletes and tenant isolation.
alter table faculty add column is_active boolean not null default true;
alter table subjects add column college_id uuid not null references colleges(id);
alter table subjects add column is_active boolean not null default true;
alter table subjects add column created_at timestamptz not null default now();
alter table subjects add column updated_at timestamptz not null default now();
alter table academic_terms add column is_active boolean not null default true;
alter table timetable_generations add column input_fingerprint text not null default '';
alter table timetable_generations add column input_snapshot jsonb;
alter table timetable_generations add column adjustments jsonb not null default '[]';
alter table timetable_generations add column requested_by uuid references auth.users(id);
alter table timetable_entries add column snapshot jsonb;
alter table faculty add check (max_workload_slots_per_week between 1 and 36);
alter table subject_workload add check (slots_per_week between 1 and 36);
alter table timetable_entries add check (start_slot between 1 and 6 and end_slot between start_slot and 6 and not (start_slot<=3 and end_slot>=4));
alter table term_pairs add check (term_a_id <> term_b_id);
alter table courses add check ((name='BPHARM' and total_terms=8 and term_unit='semester') or (name='MPHARM' and total_terms=4 and term_unit='semester') or (name='PHARMD' and total_terms=5 and term_unit='year'));
create unique index one_running_generation on timetable_generations(college_id) where status='running';
create index generations_college_time on timetable_generations(college_id,started_at desc);
create index entries_generation on timetable_entries(generation_id);
create index entries_faculty on timetable_entries(generation_id,faculty_id);
create index entries_room on timetable_entries(generation_id,room_id);
create index workload_term on subject_workload(term_id);

create function touch_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger faculty_touch before update on faculty for each row execute function touch_updated_at();
create trigger subject_touch before update on subjects for each row execute function touch_updated_at();
create trigger workload_touch before update on subject_workload for each row execute function touch_updated_at();
create function require_soft_delete() returns trigger language plpgsql as $$ begin raise exception 'Use is_active=false; historical records must be preserved.'; end $$;
create trigger faculty_no_delete before delete on faculty for each row execute function require_soft_delete();
create trigger subject_no_delete before delete on subjects for each row execute function require_soft_delete();

create function validate_workload() returns trigger language plpgsql set search_path=public as $$
declare col uuid; course_name text; sn text; tn int;
begin
 select c.college_id,c.name,t.term_number into col,course_name,tn from academic_terms t join courses c on c.id=t.course_id where t.id=new.term_id;
 select session_type into sn from subjects where id=new.subject_id and college_id=col;
 if sn is null or not exists(select 1 from faculty where id=new.faculty_id and college_id=col) or not exists(select 1 from rooms where id=new.room_id and college_id=col) then raise exception 'Workload resources must belong to the same college'; end if;
 if new.group_id is not null and not exists(select 1 from groups where id=new.group_id and term_id=new.term_id) then raise exception 'Group must belong to workload term'; end if;
 if new.batch_id is not null and (course_name<>'BPHARM' or not exists(select 1 from batches where id=new.batch_id and group_id=new.group_id)) then raise exception 'Invalid BPHARM batch'; end if;
 if new.pooled_batch_id is not null and not exists(select 1 from pooled_batches where id=new.pooled_batch_id and term_id=new.term_id and kind=sn) then raise exception 'Invalid pooled batch kind or term'; end if;
 if sn in ('lab','practice_school') and new.slots_per_week%3<>0 then raise exception 'Long sessions require a multiple of three slots'; end if;
 if sn in ('practice_school','elective') and new.scope_type<>'pooled' then raise exception 'Practice School and electives require pooled scope'; end if;
 if sn='practice_school' and (course_name<>'BPHARM' or tn not in (7,8)) then raise exception 'Practice School requires BPHARM semester 7 or 8'; end if;
 if sn='lab' and course_name='BPHARM' and new.scope_type<>'batch' then raise exception 'BPHARM labs require batch scope'; end if;
 return new;
end $$;
create trigger workload_integrity before insert or update on subject_workload for each row execute function validate_workload();

-- Missing profiles grant no access. Only explicitly provisioned NULL-college profiles are Deans.
create function can_access_college(target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from admin_profiles where user_id=auth.uid() and (college_id is null or college_id=target));
$$;
revoke all on function can_access_college(uuid) from public;
grant execute on function can_access_college(uuid) to authenticated;
alter table admin_profiles enable row level security;
create policy own_profile on admin_profiles for select to authenticated using(user_id=auth.uid());
alter table colleges enable row level security;
create policy college_read on colleges for select to authenticated using(can_access_college(id));
do $$ declare tab text; begin
 foreach tab in array array['courses','faculty','rooms','subjects','timetable_generations'] loop
  execute format('alter table %I enable row level security',tab);
  execute format('create policy tenant_read on %I for select to authenticated using(can_access_college(college_id))',tab);
 end loop;
end $$;
alter table academic_terms enable row level security;
create policy term_read on academic_terms for select to authenticated using(exists(select 1 from courses c where c.id=course_id and can_access_college(c.college_id)));
alter table groups enable row level security;
create policy group_read on groups for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table batches enable row level security;
create policy batch_read on batches for select to authenticated using(exists(select 1 from groups g where g.id=group_id));
alter table pooled_batches enable row level security;
create policy pool_read on pooled_batches for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table term_pairs enable row level security;
create policy pair_read on term_pairs for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_a_id));
alter table subject_workload enable row level security;
create policy workload_read on subject_workload for select to authenticated using(exists(select 1 from academic_terms t where t.id=term_id));
alter table time_slots enable row level security;
create policy slots_read on time_slots for select to authenticated using(exists(select 1 from admin_profiles p where p.user_id=auth.uid()));
alter table timetable_entries enable row level security;
create policy entries_read on timetable_entries for select to authenticated using(exists(select 1 from timetable_generations g where g.id=generation_id));
alter table generation_term_modes enable row level security;
create policy modes_read on generation_term_modes for select to authenticated using(exists(select 1 from timetable_generations g where g.id=generation_id));
grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- One statement gives every generation a consistent input snapshot.
create function college_dataset(target uuid) returns jsonb language sql stable security invoker set search_path=public as $$
with cs as (select * from courses where college_id=target), ts as(select * from academic_terms where course_id in(select id from cs)), gs as(select * from groups where term_id in(select id from ts))
select jsonb_build_object(
 'colleges',coalesce((select jsonb_agg(x) from (select * from colleges where id=target)x),'[]'),
 'courses',coalesce((select jsonb_agg(cs) from cs),'[]'),
 'academic_terms',coalesce((select jsonb_agg(ts) from ts),'[]'),
 'groups',coalesce((select jsonb_agg(gs) from gs),'[]'),
 'batches',coalesce((select jsonb_agg(x) from (select * from batches where group_id in(select id from gs))x),'[]'),
 'pooled_batches',coalesce((select jsonb_agg(x) from (select * from pooled_batches where term_id in(select id from ts))x),'[]'),
 'term_pairs',coalesce((select jsonb_agg(x) from (select * from term_pairs where term_a_id in(select id from ts))x),'[]'),
 'faculty',coalesce((select jsonb_agg(x) from (select * from faculty where college_id=target)x),'[]'),
 'rooms',coalesce((select jsonb_agg(x) from (select * from rooms where college_id=target)x),'[]'),
 'subjects',coalesce((select jsonb_agg(x) from (select * from subjects where college_id=target)x),'[]'),
 'subject_workload',coalesce((select jsonb_agg(x) from (select * from subject_workload where term_id in(select id from ts))x),'[]'));
$$;
revoke all on function college_dataset(uuid) from public;
grant execute on function college_dataset(uuid) to authenticated,service_role;

-- Entire output is committed atomically; ordinary clients cannot write solver output.
create function finish_generation(run_id uuid, result jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare e jsonb; m jsonb;
begin
 perform 1 from timetable_generations where id=run_id and status='running' for update;
 if not found then raise exception 'Run is missing or no longer running'; end if;
 if result->>'status'='success' then
  for e in select * from jsonb_array_elements(result->'entries') loop
   insert into timetable_entries(generation_id,entry_type,subject_workload_id,faculty_id,room_id,term_id,group_id,batch_id,pooled_batch_id,idle_label,idle_reason,day_of_week,start_slot,end_slot,snapshot)
   values(run_id,e->>'entry_type',(e->>'subject_workload_id')::uuid,(e->>'faculty_id')::uuid,(e->>'room_id')::uuid,(e->>'term_id')::uuid,(e->>'group_id')::uuid,(e->>'batch_id')::uuid,(e->>'pooled_batch_id')::uuid,e->>'idle_label',e->>'idle_reason',e->>'day_of_week',(e->>'start_slot')::int,(e->>'end_slot')::int,e->'snapshot');
  end loop;
  for m in select * from jsonb_array_elements(result->'modes') loop
   insert into generation_term_modes(generation_id,term_id,lab_window) values(run_id,(m->>'term_id')::uuid,m->>'lab_window');
  end loop;
 end if;
 update timetable_generations set status=result->>'status',completed_at=clock_timestamp(),conflict_report=result->'conflicts',adjustments=result->'adjustments' where id=run_id;
end $$;
revoke all on function finish_generation(uuid,jsonb) from public;
grant execute on function finish_generation(uuid,jsonb) to service_role;

insert into public.fop_migrations(name) values('supabase/migrations/002_integrity_security.sql');

-- supabase/migrations/003_source_imports.sql
-- Preserve source evidence separately from approved solver inputs.
create table source_import_batches(
 id uuid primary key default gen_random_uuid(),
 college_id uuid not null references colleges(id),
 fingerprint text not null unique,
 imported_at timestamptz not null default now(),
 status text not null default 'needs_review' check(status in ('needs_review','approved')),
 source_files jsonb not null,
 summary jsonb not null
);
create table source_import_records(
 id uuid primary key default gen_random_uuid(),
 import_id uuid not null references source_import_batches(id),
 record_kind text not null check(record_kind in ('catalog','faculty','assignment','issue','raw_workbook')),
 source_key text not null,
 payload jsonb not null,
 unique(import_id,record_kind,source_key)
);
alter table subjects add column source_key text;
create unique index subjects_source_key on subjects(college_id,source_key) where source_key is not null;
alter table source_import_batches enable row level security;
alter table source_import_records enable row level security;
create policy import_batch_read on source_import_batches for select to authenticated using(can_access_college(college_id));
create policy import_record_read on source_import_records for select to authenticated using(exists(select 1 from source_import_batches b where b.id=import_id));
grant select on source_import_batches,source_import_records to authenticated;
grant all on source_import_batches,source_import_records to service_role;

create function import_reviewed_catalog(target uuid, input jsonb, raw_sources jsonb, input_hash text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare run uuid; item jsonb; kind text; idx int; subject_count int:=0; room_count int:=0; existing_room rooms%rowtype; existing_subject subjects%rowtype; sp text; pos int;
begin
 if not exists(select 1 from colleges where id=target and code='PIP') then raise exception 'Source files are for PIP only'; end if;
 select id into run from source_import_batches where fingerprint=input_hash;
 if run is not null then return jsonb_build_object('id',run,'already_imported',true); end if;
 insert into source_import_batches(college_id,fingerprint,source_files,summary)
 values(target,input_hash,(select jsonb_agg(jsonb_build_object('file',x->>'file','sha256',x->>'sha256')) from jsonb_array_elements(raw_sources)x),jsonb_build_object('catalog_components',jsonb_array_length(input->'catalog'),'faculty_blocks',jsonb_array_length(input->'faculty'),'assignments',jsonb_array_length(input->'assignments'),'issues',jsonb_array_length(input->'issues'),'workloads_imported',0)) returning id into run;
 foreach kind in array array['catalog','faculty','assignment','issue','raw_workbook'] loop
  idx:=0;
  for item in select * from jsonb_array_elements(case kind when 'assignment' then input->'assignments' when 'issue' then input->'issues' when 'raw_workbook' then raw_sources else input->kind end) loop
   idx:=idx+1;
   insert into source_import_records(import_id,record_kind,source_key,payload) values(run,kind,coalesce(item->>'key',idx::text),item);
  end loop;
 end loop;
 for item in select * from jsonb_array_elements(input->'rooms') loop
  select * into existing_room from rooms where college_id=target and room_no=item->>'room_no';
  if found and existing_room.room_type<>item->>'room_type' then raise exception 'Room type conflict for %, existing data was not changed',item->>'room_no'; end if;
  if not found then insert into rooms(college_id,room_no,room_type) values(target,item->>'room_no',item->>'room_type'); room_count:=room_count+1; end if;
 end loop;
 for item in select * from jsonb_array_elements(input->'catalog') where value->>'course'<>'PHARMD_PB' loop
  select * into existing_subject from subjects where college_id=target and source_key=item->>'key';
  if found and (existing_subject.code<>item->>'code' or existing_subject.name<>item->>'name' or existing_subject.session_type<>item->>'session_type') then raise exception 'Subject conflict for %, existing data was not changed',item->>'key'; end if;
  if not found then
   insert into subjects(college_id,code,name,session_type,source_key) values(target,item->>'code',item->>'name',item->>'session_type',item->>'key');subject_count:=subject_count+1;
  end if;
 end loop;
 -- The nine specializations come from the M.Pharm source, not guessed names.
 pos:=0;
 for sp in select distinct value->>'specialization' from jsonb_array_elements(input->'catalog') where value->>'course'='MPHARM' order by 1 loop
  pos:=pos+1;
  update groups g set name=sp from academic_terms t join courses c on c.id=t.course_id where g.term_id=t.id and c.college_id=target and c.name='MPHARM' and g.name='Specialization '||pos;
 end loop;
 -- Only M.Pharm semester 2 is supplied as active teaching data.
 update academic_terms t set is_active=(t.term_number=2) from courses c where t.course_id=c.id and c.college_id=target and c.name='MPHARM';
 return jsonb_build_object('id',run,'already_imported',false,'subjects_inserted',subject_count,'rooms_inserted',room_count,'workloads_inserted',0,'status','needs_review');
end $$;
revoke all on function import_reviewed_catalog(uuid,jsonb,jsonb,text) from public;
grant execute on function import_reviewed_catalog(uuid,jsonb,jsonb,text) to service_role;

insert into public.fop_migrations(name) values('supabase/migrations/003_source_imports.sql');

-- supabase/seed.sql
-- Structural data only. The five unnamed colleges are explicitly placeholders.
insert into colleges(code,name) values
 ('PIP','Parul Institute of Pharmacy'),
 ('PENDING-2','College 2 · name pending'),('PENDING-3','College 3 · name pending'),
 ('PENDING-4','College 4 · name pending'),('PENDING-5','College 5 · name pending'),('PENDING-6','College 6 · name pending')
on conflict(code) do nothing;
insert into courses(college_id,name,term_unit,total_terms)
select c.id,v.name,v.unit,v.n from colleges c cross join(values('BPHARM','semester',8),('MPHARM','semester',4),('PHARMD','year',5))v(name,unit,n)
on conflict(college_id,name) do nothing;
insert into academic_terms(course_id,term_number,academic_year)
select c.id,n,'2026-27' from courses c join colleges col on col.id=c.college_id cross join lateral generate_series(1,c.total_terms)n where col.code='PIP'
on conflict(course_id,term_number,academic_year) do nothing;
insert into groups(term_id,name,group_type)
select t.id,v.name,'division' from academic_terms t join courses c on c.id=t.course_id cross join(values('Division A'),('Division B'))v(name)
where c.name='BPHARM' and not exists(select 1 from groups g where g.term_id=t.id and g.name=v.name);
-- Replace specialization labels with department-approved names when supplied.
insert into groups(term_id,name,group_type)
select t.id,'Specialization '||n,'specialization' from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,9)n
where c.name='MPHARM' and not exists(select 1 from groups g where g.term_id=t.id and g.name='Specialization '||n);
insert into groups(term_id,name,group_type)
select t.id,'Year '||t.term_number,'year_group' from academic_terms t join courses c on c.id=t.course_id
where c.name='PHARMD' and not exists(select 1 from groups g where g.term_id=t.id);
insert into batches(group_id,name)
select g.id,'Batch '||case when g.name='Division A' then chr(64+n) else chr(66+n) end from groups g cross join generate_series(1,2)n
where g.group_type='division' and not exists(select 1 from batches b where b.group_id=g.id and b.name='Batch '||case when g.name='Division A' then chr(64+n) else chr(66+n) end);
insert into term_pairs(term_a_id,term_b_id)
select a.id,b.id from academic_terms a join academic_terms b on b.course_id=a.course_id and b.academic_year=a.academic_year join courses c on c.id=a.course_id
where c.name='BPHARM' and (a.term_number,b.term_number) in ((1,3),(5,7),(2,4),(6,8)) on conflict do nothing;
insert into pooled_batches(term_id,kind,name)
select t.id,'practice_school','PS Batch '||n from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,6)n
where c.name='BPHARM' and t.term_number in (7,8) and not exists(select 1 from pooled_batches p where p.term_id=t.id and p.name='PS Batch '||n);
insert into pooled_batches(term_id,kind,name)
select t.id,'elective','Elective pool '||n from academic_terms t join courses c on c.id=t.course_id cross join generate_series(1,2)n
where c.name='BPHARM' and t.term_number in (7,8) and not exists(select 1 from pooled_batches p where p.term_id=t.id and p.name='Elective pool '||n);
insert into time_slots values
 (1,1,'9:30–10:30','09:30','10:30',false),(2,2,'10:30–11:30','10:30','11:30',false),(3,3,'11:30–12:30','11:30','12:30',false),
 (4,4,'Lunch','12:30','13:30',true),(5,5,'1:30–2:30','13:30','14:30',false),(6,6,'2:30–3:30','14:30','15:30',false),(7,7,'3:30–4:25','15:30','16:25',false)
on conflict(id) do nothing;

insert into public.fop_migrations(name) values('supabase/seed.sql');
notify pgrst, 'reload schema';
commit;
