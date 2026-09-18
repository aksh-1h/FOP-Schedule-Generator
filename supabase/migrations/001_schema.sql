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

