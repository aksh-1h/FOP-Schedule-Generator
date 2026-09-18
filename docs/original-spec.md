# FOP Timetable Generator — Project Specification

## 0. Purpose of this document

This is the complete build spec for a single-college-at-a-time, admin-run
timetable generator for the Faculty of Pharmacy (FOP). It is written to be
handed directly to an AI coding assistant (or a human developer) to
scaffold and implement the project with no further requirements-gathering
needed. Every business rule below was confirmed directly with the project
owner — nothing here is speculative except where explicitly marked
**(assumption)**.

---

## 1. Overview

A web application that:

1. Stores three input datasets — **faculty**, **subject workload**,
   **rooms**. Faculty and subject workload are treated as **living data**
   (subjects change, faculty join/leave, workload hours get revised) and
   will get a "Manage Faculty" / "Manage Subject" admin UI in a later
   version. Rooms are static/fixed by department policy. All three are
   SQL-seeded directly for v1 — no CRUD UI yet for any of them.
2. Runs a **fully automatic constraint solver** that generates a clash-free
   weekly timetable for a college in a single pass — every course, every
   active semester/year, every group, every batch, every pooled offering.
3. Lets an admin view the result three ways: by group (the classic
   timetable grid), by faculty, and by room.
4. Classifies every scheduling rule as either a **hard rule** (never
   broken) or a **soft rule** (may bend, but only as far as needed to keep
   every hard rule intact) — see §6.4.

There is no manual editing of generated timetables in v1. If the solver
cannot produce a hard-rule-compliant result, it reports exactly why
instead of guessing.

---

## 2. Scope for v1

**In scope**
- The Faculty of Pharmacy as a whole: **6 colleges**, one of which — **PIP**
  (Parul Institute of Pharmacy) — has real seeded data for v1. The other 5
  exist as rows an admin *could* populate later; the schema doesn't treat
  PIP as special.
- All three courses, under any college: **BPHARM**, **MPHARM**, **PHARMD**.
- Admin login (Supabase Auth), scoped per college, plus a **Dean** role
  with access across every college.
- Read-only master data views (faculty / rooms / subjects).
- One-click, whole-college timetable generation.
- Three read-only timetable views (by group, by faculty, by room).

**Out of scope for v1 (explicitly deferred)**
- Add/edit UI for faculty, subjects, or rooms — SQL-seeded only for now,
  though faculty/subject data is modeled to support that UI later (§7).
- Manual drag-and-drop editing of a generated timetable.
- Export/print, notifications, or academic-calendar-aware scheduling
  (every week is treated identically — no biweekly Saturday logic, etc.).

---

## 3. Domain model & terminology

The three courses have structurally different internal groupings. Rather
than model each separately, the schema uses two generic entities:

- **Group** — whichever unit of students shares a single timetable at the
  top level: a BPHARM **Division**, an MPHARM **Specialization**, or a
  PharmD single yearly cohort. Every course/term has at least one Group.
- **Batch** — a sub-split of a Group, used **only** for BPHARM labs (a
  Division splits into 2 batches for lab sessions). MPHARM and PharmD never
  have batches.

A third, unrelated kind of sub-group — a **pooled batch** — covers both
Practice School (Special) and Elective offerings; see §6.2.

```
Faculty of Pharmacy (the one department — not a stored table, just a label)
└── 6 Colleges (PIP is the only one seeded with real data today)
    └── PIP
        ├── BPHARM — 4 years / 8 semesters
        │     └── each semester → Division A (Batch A, Batch B)
        │                       → Division B (Batch C, Batch D)
        │     (semesters 7 & 8 also carry Practice School & Elective
        │      pooled batches — §6.2 — and Practice School's "Normal/idle"
        │      variant — §6.3)
        │     (semester pairing & lab-window modes — BPHARM only — §6.1)
        ├── MPHARM — 2 years / 4 semesters
        │     └── each semester → 9 Specializations (each = 1 Group, no batches)
        │     (no pairing, no mode restriction — any window, any day)
        └── PHARMD — 5 years, annual system (not semester-based)
              └── each year → 1 Group (no division, no batch)
              (no pairing, no mode restriction — any window, any day)
```

**Access**: an **Admin** is scoped to one college; a **Dean** has the same
capabilities as an Admin but across every college — see §7's
`admin_profiles` table.

---

## 4. The weekly grid

Identical for every course and every college. Monday through Saturday, every
day treated the same — no academic-calendar or biweekly-Saturday logic.

| # | Time | Type |
|---|---|---|
| 1 | 9:30 – 10:30 | teaching |
| 2 | 10:30 – 11:30 | teaching |
| 3 | 11:30 – 12:30 | teaching |
| — | 12:30 – 1:30 | **lunch — mandatory, nothing may start or continue through it** |
| 4 | 1:30 – 2:30 | teaching |
| 5 | 2:30 – 3:30 | teaching |
| 6 | 3:30 – 4:25 | teaching |

Slots 1–3 are the **morning window**; slots 4–6 are the **afternoon
window** — this split is what BPHARM's lab-window mode (§6.1) refers to.

All 6 teaching slots are otherwise interchangeable — no rule ties any
particular slot number to batches or to a session type on its own.

Each filled cell displays exactly three things: **subject name**, **faculty
name/initials**, **room no.** — except an idle/free cell (§6.3), which
shows only a label and no faculty/room, by definition.

---

## 5. Session types & placement rules

| Session type | Duration | Where it can go |
|---|---|---|
| Theory | 1 slot | Any of the 6 slots |
| Lab | fixed 3 consecutive slots | **Only** the morning window (1–3) or the afternoon window (4–6). Never spans lunch, never starts elsewhere. For BPHARM, further restricted to that semester's assigned mode window — §6.1. |
| Practice School | fixed 3 consecutive slots | Same window rule as Lab. Runs as a **pooled** offering (§6.2) — BPHARM semesters 7 & 8 only. |
| Elective | 1 slot | Any of the 6 slots. Runs as a **pooled** offering (§6.2), same population scope as Practice School but 1-hour duration, not 3. |

Slot **counts per week** for any subject/lab/practice-school/elective are
never hardcoded in the app — they come entirely from the seeded
subject-workload data.

Two batches under the same Division **can** run labs at the exact same
time — that's expected, not a clash, because each batch's lab has a
different subject, faculty, and room. §6.2 generalizes this idea further.

---

## 6. Workload scoping — the `scope_type` field

Every row of subject workload is scoped to whichever unit of students
actually attends it:

| `scope_type` | Meaning | `group_id` | `batch_id` | `pooled_batch_id` |
|---|---|---|---|---|
| `group` | Whole Division / Specialization / year-group attends together | required | null | null |
| `batch` | Only one BPHARM batch attends (a Division's lab split) | required | required | null |
| `pooled` | Only one named pooled batch attends — either a Practice School batch or an Elective batch (BPHARM sem 7/8 mainly, not exclusively) | null | null | required |

(`pooled` replaces two earlier, separate ideas — a bare `semester` scope,
and later a `practice_school`-only scope — once it became clear Practice
School and Electives are the *same kind* of sub-grouping, just differing
in session duration. See §14.)

### 6.1 BPHARM semester pairing & lab-window mode

**Applies to BPHARM only.** MPHARM and PharmD have none of this — their
labs can be placed in either window, on any day, per subject, with no
coordination between semesters.

- At any real point in time only **4 of BPHARM's 8 semesters are actually
  running**: the odd set {1, 3, 5, 7} or the even set {2, 4, 6, 8},
  depending on the academic-term period. The schema stores all 8 terms;
  a given generation run only schedules whichever 4 are currently active
  **(assumption — pass an `active_parity: 'odd' | 'even'` parameter into
  the generate call so the solver knows which 4 to schedule)**.
- Within whichever set is active, semesters pair up: **{1↔3, 5↔7}** (odd
  set) and **{2↔4, 6↔8}** (even set). This pairing is fixed data, stored
  explicitly — not derived by formula — in a `term_pairs` table.
- Each semester has a single **lab-window mode for the entire week**:
  either `morning` (all its labs/pooled-Practice-School sit in slots 1–3,
  every day they occur) or `afternoon` (slots 4–6). This mode:
  - is the **same for both Divisions** of that semester;
  - is always the **opposite** of its paired semester's mode;
  - restricts every lab-type row (including pooled Practice School) for
    that semester — none of them may ever be placed in the non-mode
    window, **except under the day-level relaxation below**.
  - does **not** restrict theory or Elective placement — those stay free
    across all 6 slots regardless of mode.
- **Shared theory classroom, per Division letter**: because paired
  semesters never have labs at the same window, each Division letter (A,
  B) of a pair can share one fixed classroom for theory — e.g. Sem2-DivA
  and Sem4-DivA both use the same room for theory, just at their
  respective (opposite) windows. **This needs no new schema mechanism** —
  it falls out automatically once (a) the admin seeds the *same*
  `room_id` on both semesters' theory `subject_workload` rows for that
  Division letter, and (b) the mode-opposition rule is enforced, so the
  existing no-room-clash rule never actually has to reject anything.
- **Where the mode decision happens**: recorded per generation run in
  `generation_term_modes`, decided once per active term-pair before
  individual placement (Layer 2, §8.2) — not a permanent property of the
  term. **(assumption — flag for the department if this should instead be
  policy-fixed rather than freshly decided each run.)**

**Day-level relaxation (soft rule S1/S2 — see §6.4)**: the mode rule
normally holds for the whole week, but can bend for a **single day** when
a semester's leftover workload genuinely can't fit otherwise. Worked
example, as given directly: Sem6 and Sem8 are paired, sharing one
classroom. Sem6 has more theory hours than its normal theory-window
allocation can hold. If the overflow is concentrated on, say, Friday,
then **only for Friday**, Sem6 may claim the shared classroom for the
*entire day* (both windows) instead of just its usual theory window. Its
pair, Sem8, is then compensated for losing the room that day in one of
two ways, chosen by whichever fits Sem8's remaining workload:
- **a second lab window that day** — if Sem8 still has unplaced lab slots
  to use, it gets two lab windows on that one day instead of one theory +
  one lab, using its normal (already-fixed) lab rooms, not the shared
  classroom; or
- **an idle/free block** (§6.3) for that window, if Sem8 has nothing left
  to place there.

Every other day of the week, both semesters keep following the normal
S1/S2 pattern untouched — the relaxation is scoped to exactly the day(s)
that need it, never the whole week.

### 6.2 Merge slots & pooled batches

A **merge slot** is a (day, window) that legitimately holds **more than
one** `timetable_entries` row at once, because the rows claim
non-overlapping groups of students — this is distinct from a genuine
clash, and the solver must allow it rather than reject it.

Three shapes of this exist:

1. **Parallel batch labs**: two batches under the same Division run
   different labs at the same window — always fine, since they're
   disjoint by definition (siblings under one Division).
2. **Batch lab + pooled Practice School**: a batch runs its own lab while
   the rest of that semester's students attend Practice School. As stated
   directly: *"students who are in batch A will have to attend the lab,
   and other students who are not in batch A have to go for practice
   school."* A `pooled` row (Practice School kind) is always compatible
   with a `batch` row under the same term at the same window — the
   population split is derived structurally, not looked up from extra
   data.
3. **Elective + main subject**: when Electives run, the merge is *"a pair
   of elective subject and other main subject — those [students] who have
   the elective go for that elective, and the rest take the main subject
   class."* Several different electives can run in parallel in the same
   window (each its own pooled batch, own subject, own faculty/room),
   alongside one "main subject" row for everyone not taking any elective
   that period. **An elective does not have to be in a merge slot** — if
   nothing else needs that window at the same time, it's just placed
   under the ordinary single-occupancy rules like any other subject.

**Pooled batches**, covering both Practice School and Electives, are
modeled as one shared table (`pooled_batches`) rather than two separate
ones, since they're the same *kind* of thing — a term-wide population
split into named, independently-staffed sub-offerings. They differ only
in **duration**, which follows directly from the referencing subject's
`session_type` (practice_school = 3-slot window; elective = 1 slot) — no
extra schema needed to express that difference. Both scope to the whole
**term** (both Divisions pooled together), not to one Division.

A `pooled` row is **never** compatible with a `group`-scope (whole-
Division) row at the same window — a full, un-split Division still blocks
that window entirely, whether the pooled activity is Practice School or
an Elective.

### 6.3 Idle / free periods

Two situations need a block of time that's claimed by **nobody** — no
faculty, no room, genuinely idle:

1. **Practice School (Normal)** — whenever a batch's lab is carving
   students out of a Practice-School-designated window and no "Special"
   (fully-staffed, 6-batch) session was seeded for the rest, the
   remaining students' time is simply unclaimed. Duration: a full 3-hour
   window.
2. **Schedule-adjustment free time** — the S1/S2 relaxation fallback in
   §6.1, when a pair's partner semester has nothing left to place in a
   window it's lost to its pair for the day. Duration: whatever's left
   uncovered, typically 1 hour.

These are modeled as **one mechanism**, not two, since both are
structurally "nobody's assigned here" — but they must still **display
differently to the admin** (Practice School never shows as a generic
"free slot," and vice versa), and their durations genuinely differ. Both
needs are met without extra complexity: `timetable_entries` gains an
`entry_type` of `'idle'` (alongside the normal `'placement'` type), with
an `idle_label` field carrying the exact display text (`'Practice
School'` vs `'Free Period'`), while the entry's own `start_slot`/
`end_slot` already naturally accommodates either a 1-slot or 3-slot span
— no separate table, no separate duration field needed. See §7 for the
exact columns.

These idle entries are always **generated by the solver**, never
pre-seeded — nobody hand-enters "this is a free period" as workload data;
it falls out automatically wherever a window is left partially or wholly
unclaimed after normal placement.

### 6.4 Hard rules vs. soft rules

Every scheduling rule in this project is one of the two below. **Hard**
rules are never broken, under any circumstances. **Soft** rules may bend,
but only as far as necessary to keep every hard rule satisfied — and the
solver should always try the least disruptive bend first (a single day,
not a whole week; one semester, not both).

**Hard rules**

| ID | Rule |
|---|---|
| H1 | The weekly grid is fixed — Mon–Sat, 6 teaching slots (9:30–10:30, 10:30–11:30, 11:30–12:30, 1:30–2:30, 2:30–3:30, 3:30–4:25) plus mandatory 12:30–1:30 lunch. Never varies by course or college. |
| H2 | Nothing may start or continue through the lunch block. |
| H3 | No faculty is ever scheduled in two places at the same (day, slot) — no exceptions. |
| H4 | No room is ever double-booked at the same (day, slot) — no exceptions. |
| H5 | Course structures are fixed and never restructured by the solver — BPHARM's 4yr/8sem/2 Div/2 Batch-each, MPHARM's 2yr/4sem/9 Specializations, PharmD's 5yr/1 Group-each. |
| H6 | Every `subject_workload` row gets **exactly** its specified slots/week — never more, never less. If that's impossible, it's a reported conflict, not something quietly under- or over-filled. |
| H7 | A Lab or pooled-Practice-School session is always exactly 3 continuous slots inside one window (1–3 or 4–6) — never split, never spans lunch, never starts elsewhere. Applies to every course. |
| H8 | Faculty and room for a given workload row are fixed external inputs — the solver decides only *when*, never *who* or *where*. |
| H9 | A window can only be shared by more than one entry (a merge slot) when the entries' student-populations are genuinely disjoint — §6.2's three shapes. A whole, un-split Group never shares its window with anything else. |

**Soft rules** — bend only as far as needed, at the smallest possible
scope (prefer one day over one week, one semester over both):

| ID | Rule | When it can bend |
|---|---|---|
| S1 | *(BPHARM only)* A semester keeps its labs/pooled-Practice-School on one side of the grid for the entire week. | At single-day granularity, when that day's leftover theory workload genuinely can't fit otherwise — §6.1's worked example. |
| S2 | *(BPHARM only)* The two semesters in a pair always run opposite modes. | On the same day S1 bends for one semester, its pair is compensated with a second lab window or an idle block (§6.1), chosen by whichever its remaining workload needs. |
| S3 | A faculty member gets a gap rather than back-to-back sessions where possible. | Whenever the gap genuinely isn't available without breaking H3/H6. |
| S4 | *(BPHARM only, consequence of S1/S2)* Paired semesters share one theory classroom per Division letter. | If S1/S2 bend for a day, the solver may need to fall back to a different available lecture room that day instead of the usual paired one. |

**Open for review**: if more than one soft rule could resolve the same
conflict, should the solver always try a fixed priority order (e.g. S1
before S3), or just search for whichever combination reaches a valid,
hard-rule-compliant result fastest? Flagged for your review alongside the
rest of this table.

---

## 7. Database schema (PostgreSQL / Supabase)

Requires the `pgcrypto` extension for `gen_random_uuid()` (enabled by
default on Supabase). No `departments` table — there is only one
department (Pharmacy) and it isn't modeled as data, just a label used in
the UI.

```sql
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
```

**(assumption)** Row Level Security: recommend enabling RLS on all tables,
scoped via `admin_profiles.college_id` (bypassed entirely for a Dean, i.e.
`college_id IS NULL`), once auth is wired up. With a small number of
admins in v1 this is a light safeguard rather than a hard requirement —
fine to add after the core app works.

---

## 8. Solver design

The solver runs **once per click**, across every currently-active term in
the selected college — every course, every active semester/year, every
group, and every batch/pooled-batch together — because faculty and rooms
are shared resources across the whole college and only a global pass can
guarantee zero cross-semester clashes. For BPHARM, "currently active"
means whichever 4-semester set (`active_parity`) was passed in — see §6.1.

Every rule enforced below is tagged with its ID from §6.4 (H = hard,
S = soft) so the mapping from "rule" to "code" stays traceable.

### 8.1 Layer 1 — static feasibility pre-check (no search, instant)

Because faculty and room assignments are **fixed inputs**, most infeasible
data can be caught with arithmetic alone, before any search runs:

1. **Per faculty** (H3, H6): sum `slots_per_week` across every
   `subject_workload` row assigned to them. If the sum exceeds
   `max_workload_slots_per_week`, record a conflict:
   `"Faculty {name}: assigned {X} slots/week, max is {Y}"`.
2. **Per room** (H4, H6):
   - `lecture` room: sum theory slots/week requested. Max = 36 (6×6).
   - `lab` room: sum `slots_per_week / 3` (windows needed). Max = 12
     windows/week (2/day × 6 days). Over → conflict:
     `"Room {room_no}: needs {X} lab windows/week, only 12 exist"`.
3. If **any** conflicts are found, stop immediately — do not run the
   search — and return `status = 'failed'` with the full list of
   conflicts as `conflict_report`.

### 8.2 Layer 2 — BPHARM lab-window mode assignment

Only runs for BPHARM terms in the active set. Implements S1/S2 (§6.4).

- For each active `term_pairs` row, assign `morning` to one term and
  `afternoon` to the other (2 possible assignments per pair — try both if
  the first leads to a dead end in Layer 3).
- Record the result in `generation_term_modes`.
- **Day-level relaxation** (§6.1 worked example): if Layer 3 can't place
  all of a semester's workload within its assigned mode-window across the
  week, Layer 2 identifies the smallest number of specific days where
  that semester may claim the full day (both windows) instead, and flags
  its pair's corresponding windows on those same days as needing a Layer 3
  fallback (second lab window, or an idle entry — whichever the pair's
  remaining workload needs). This decision happens **before** Layer 3
  places the affected rows, since it defines their domain.

### 8.3 Layer 3 — backtracking placement search

At this point the data is *theoretically* solvable and (for BPHARM) modes
are assigned; the remaining job is finding a valid day/slot arrangement
for every row, then filling any leftover pooled-Practice-School gaps with
idle entries (§6.3).

- **Variables**: each unplaced `subject_workload` row.
- **Domain**:
  - Theory / Elective row → any of 36 (day, slot) pairs (H1).
  - Lab / pooled-Practice-School row (MPHARM, PharmD, or BPHARM outside
    §6.1) → any of 12 (day, window) pairs (H7).
  - Lab / pooled-Practice-School row **for an active BPHARM term** → only
    the 6 (day, window) pairs matching that term's assigned mode from
    Layer 2, plus any day(s) Layer 2 flagged for relaxation (S1).
- **Hard constraints checked on every placement**: H3 (no faculty
  overlap), H4 (no room overlap), "no two `group`-scope rows for the same
  `group_id` overlap" (part of H9's exclusivity), H9's merge-slot
  compatibility rule (§6.2's three shapes), H7 (full-window-only
  placement for 3-slot session types).
- **Soft constraint** (S3): prefer a placement that leaves a gap after a
  faculty member's previous session — a scoring/ordering preference, not
  a hard blocker.
- **Heuristic**: place lab / pooled / Elective rows first (fewer valid
  domain values → "most constrained variable first"), then theory rows.
- **Retry policy**: if a full valid assignment isn't found, retry with a
  different variable/value ordering (and, for BPHARM, try the other mode
  assignment or a different relaxation day from Layer 2) up to **10
  attempts total** before giving up.
- **Post-placement fill** (§6.3): for every (term, day, window) that falls
  within a BPHARM PS-term's mode window where a batch-lab was placed but
  no pooled-Practice-School row covers the rest of the semester, insert an
  `entry_type = 'idle'` row (`idle_label = 'Practice School'`,
  `idle_reason = 'practice_school_pool'`) spanning that same 3-slot
  window. Similarly, wherever a Layer 2 relaxation left a pair's window
  uncovered with no remaining workload to place there, insert an idle row
  (`idle_label = 'Free Period'`, `idle_reason = 'schedule_adjustment'`)
  for exactly the uncovered span.
- **On success**: write every `timetable_entries` row (placements + idle
  fills) under a new `timetable_generations` row (`status = 'success'`),
  plus the `generation_term_modes` rows from Layer 2.
- **On failure after all retries**: return `status = 'failed'` with a
  `conflict_report` listing the specific rows that couldn't be placed and
  the best-known reason.

**(assumption)** Implement Layers 2 and 3 as hand-rolled functions in the
Express backend (not a generic CSP library) — the domain-specific rules
above are specific enough that a general-purpose solver would need heavy
customization anyway.

---

## 9. Backend API (Node.js / Express)

All endpoints are scoped to the logged-in user's accessible college(s) — a
Dean's requests may specify any `college_id`; an Admin's are restricted to
their own.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/colleges` | List colleges the logged-in user can access |
| GET | `/api/colleges/:collegeId/courses` | List courses under a college |
| GET | `/api/courses/:courseId/terms` | List terms (semesters/years) under a course |
| GET | `/api/terms/:termId/groups` | List groups under a term |
| GET | `/api/faculty?college_id=&q=&course_id=` | Faculty list, searchable/filterable |
| GET | `/api/faculty/:facultyId/timetable` | That faculty's full weekly grid (latest successful generation) |
| GET | `/api/rooms?college_id=&type=&course_id=` | Room list, searchable/filterable |
| GET | `/api/rooms/:roomId/timetable` | That room's full weekly grid |
| GET | `/api/subjects?course_id=&term_id=&group_id=` | Subject workload list (readable view of solver input) |
| POST | `/api/generate` `{ college_id, active_parity }` | Kick off a full-college generation run (`active_parity` only meaningful for BPHARM — see §6.1) |
| GET | `/api/generations/:id` | Status + conflict report (if failed) for one run |
| GET | `/api/generations/latest?college_id=` | Latest run for a college |
| GET | `/api/timetable?term_id=&group_id=` | The grid for one Group — merges batch/pooled/idle entries into split cells where applicable, and includes that term's assigned `lab_window` if BPHARM |

`POST /api/generate` can run synchronously and return the final result
directly, given the expected scale (see §8) — no background job queue
needed for v1 **(assumption)**.

---

## 10. Frontend architecture (React / Next.js)

- App-router style routing: `/login`, `/college`, `/college/[collegeId]`,
  `/college/[collegeId]/faculty`, `/college/[collegeId]/rooms`,
  `/college/[collegeId]/subjects`, `/college/[collegeId]/generate`,
  `/college/[collegeId]/timetable`, `/college/[collegeId]/faculty-view`,
  `/college/[collegeId]/room-view`.
- Persistent left sidebar (visible on every page after login) linking to
  all of the above, plus a breadcrumb bar showing current
  College ▸ Course ▸ Term ▸ Group context where relevant. A Dean sees a
  college switcher at the top of the sidebar; an Admin doesn't need one.
- Global light theme; Tailwind CSS recommended for styling (pairs cleanly
  with Next.js and makes the light color-coding in §11 easy to implement
  as utility classes) **(assumption — not explicitly requested, but a
  practical default)**.
- Loading states: skeleton placeholders, not blank screens, on every
  data-fetching page.
- Empty states written explicitly, e.g. "No timetable generated yet —
  click Generate to create one" rather than an empty grid.

---

## 11. Visual design system

### 11.1 Timetable cell colors (by session type)

Light, low-saturation fills so text stays easy to read; a slightly
stronger left-border accent in the same hue for quick scanning.

| Session type | Fill | Border accent |
|---|---|---|
| Theory | `#E7F1FC` (very light blue) | `#3B82F6` |
| Lab | `#E4F7ED` (very light green) | `#22C55E` |
| Practice School (staffed) | `#FDF1DE` (very light amber) | `#F59E0B` |
| Elective | `#F3EAFB` (very light purple) | `#A855F7` |
| Idle / free block | `#F1F1EF` (light neutral gray), dashed border, shows `idle_label` text only | `#9CA3AF` |
| Lunch row | `#F1F1EF`, spans all 6 day-columns, label "Lunch break", not clickable | `#9CA3AF` |

**Merge-slot rendering (§6.2)**: when a window has 2+ co-occupants (batch
lab + idle Practice School, batch lab + batch lab, elective(s) + main
subject), split the cell into labeled sections with thin dividers, each
colored per its own session type/idle status. When a window is a plain
multi-way pooled block with no carve-out (e.g. 6 staffed Practice School
batches, or several parallel Electives with no "main subject" remainder),
render it as a single cell tagged with the pool's name and a "N batches ▾"
disclosure that expands (tooltip or popover) to the individual
faculty/room pairs, rather than cramming many blocks into one grid cell.

**BPHARM mode badge**: on the Timetable Viewer, show a small badge next to
a BPHARM term's name indicating its assigned lab-window mode for that
generation (e.g. "Labs: Morning"), plus a small indicator on any day where
S1/S2 relaxation was applied (e.g. a dot or "adjusted" tag on Friday).

### 11.2 General UI conventions

- One primary action color (e.g. a solid blue button) reserved for
  **Generate** — the only "action" button in the app; everything else is
  a neutral secondary style.
- Status badges: green for a successful generation, red for failed, gray
  for "running."
- Sentence case throughout; no ALL CAPS headers.

---

## 12. Page-by-page specification

### Page 1 — Login
Email + password (Supabase Auth). No self-registration; accounts are
provisioned directly in Supabase, each tagged Admin (one college) or Dean
(all colleges) via `admin_profiles`. On success → College Selection.

### Page 2 — College selection
Card grid of colleges the logged-in user can access. An Admin sees just
their one college and can skip straight to its Dashboard; a Dean sees all
6 (only PIP has real data today — the other 5 render normally once
seeded). Selecting a college sets it active in the URL and goes to
Dashboard.

### Page 3 — Dashboard
- Course cards (BPHARM / MPHARM / PHARMD) with quick counts (terms,
  subjects, faculty-assignments).
- For BPHARM: an `active_parity` toggle (odd/even) the admin sets before
  generating, since only 4 of 8 semesters run at once (§6.1).
- Generation status panel: last run timestamp, success/failure badge,
  conflict count if failed, and the **Generate** button.
- Quick counts linking into Master Data (faculty / rooms / subjects).

### Page 4 — Faculty list
Read-only table: name, initials, max workload, computed assigned workload
(sum from subject_workload — computed, not stored), subjects taught, last
updated. **Search box** (name/initials, live client-side filter) plus
**filter dropdowns** for course and term. Row click → that faculty's page
in the Faculty View (Page 9).

### Page 5 — Room list
Read-only table: room no., type (Lecture/Lab), which subject/group it's
fixed to. **Search box** (room no.) plus **filter dropdown** for type and
course. Row click → that room's page in Room View (Page 10).

### Page 6 — Subject list
Read-only table mirroring `subject_workload`: code, name, course, term,
group, session type (including Elective), scope (including `pooled`),
slots/week, faculty, room, last updated. **Search box** (subject
code/name) plus **filter dropdowns** for course/term/group/session-type.
Doubles as a sanity-check screen before generating.

### Page 7 — Generate
- One **Generate** button — runs the whole-college solver (§8). For
  BPHARM, uses the `active_parity` chosen on the Dashboard.
- While running: a non-blocking "Generating…" state with a spinner.
- **On success**: confirmation + timestamp, with links straight into the
  three viewer pages.
- **On failure**: a structured **conflict report**, one row per issue,
  e.g. `Faculty NK: assigned 32 slots/week, max is 30`. No inline editing
  — the admin fixes the underlying SQL data and clicks Generate again.
- A short history list of past runs (timestamp, status, conflict count).

### Page 8 — Timetable viewer
- Cascading selects: **Course → Term → Group**, defaulting to the first
  valid combination on load.
- 7-row × 6-column grid (6 teaching rows + the lunch row from §11), color-
  coded per §11.1.
- Merge-slot cells render as split sections; plain multi-way pooled blocks
  render with the disclosure pattern from §11.1; idle blocks render as
  dashed gray cells labeled per `idle_label`.
- BPHARM terms show the mode badge and any day-level relaxation indicator
  from §11.1.
- Pure display — no editing controls.

### Page 9 — Faculty view
- **Searchable combobox** (type-ahead, not a plain long dropdown) listing
  every faculty member.
- On selection: their personal weekly grid, aggregated across every
  course/term/group they teach. Each filled cell also shows which Group/
  Batch/pooled-batch it's for. Empty cells = free periods (distinct from
  the labeled idle/free blocks shown on the group-level Timetable Viewer,
  which represent *students'* free time, not the faculty's).

### Page 10 — Room view
- **Searchable combobox** listing every room.
- On selection: that room's weekly occupancy grid — subject, faculty, and
  which group/batch/pooled-batch is using it, per cell.

---

## 13. Suggested build order

1. Supabase project: run the schema in §7, write a seed script skeleton
   for PIP → the three courses, including `term_pairs` and
   `pooled_batches` seed data for BPHARM.
2. Auth: Supabase Auth wiring + `admin_profiles` (Admin vs Dean).
3. Backend: read-only endpoints for colleges/courses/terms/groups/faculty/
   rooms/subjects (§9), backed by the schema.
4. Frontend: Login → College Select → Dashboard → the three Master Data
   pages, wired to the read endpoints, with search/filter per §12.
5. Solver: implement Layer 1 (pre-check), Layer 2 (BPHARM mode assignment
   + day-level relaxation), and Layer 3 (backtracking search + idle-fill)
   from §8 as a standalone, independently-testable module — feed it
   sample `subject_workload` data (including a BPHARM pair with an
   overflow day, a Practice-School merge case, and an Elective merge
   case) before wiring it to the API.
6. Wire `POST /api/generate` to the solver; build the Generate page (§12,
   Page 7) including the `active_parity` toggle and conflict-report UI.
7. Build the three viewer pages (Timetable / Faculty / Room views),
   applying the color system, merge-slot rendering, and idle-block
   rendering in §11.
8. Polish: loading/empty states, responsive tweaks, breadcrumb navigation.

---

## 14. Key decisions log (for future reference)

- "Group" and "Batch" are the two generic entities standing in for
  Division / Specialization / year-group, and BPHARM's lab-batch split,
  respectively.
- Room and faculty assignment are **inputs**, never solver decisions —
  the solver only ever decides *when*, never *who* or *where*.
- Practice School's scope went through three iterations: a bare
  `semester` scope, then a `practice_school`-only scope with its own
  batches, and finally today's `pooled` scope — once it became clear
  Electives are structurally the *same* pattern (term-wide population
  split into named sub-offerings), just differing in duration.
- The static pre-check (Layer 1) exists specifically so that faculty/room
  overload is reported instantly and deterministically, rather than only
  discovered after the search layer exhausts its retries.
- BPHARM semesters run in two mutually-exclusive sets (odd {1,3,5,7} /
  even {2,4,6,8}); within a set they pair up ({1↔3, 5↔7} / {2↔4, 6↔8})
  and coordinate a week-wide lab-window mode so they can share one
  theory classroom per Division letter. This pattern is BPHARM-only, and
  can relax at single-day granularity under workload pressure (§6.1).
- Introduced the general "merge slot" concept: a window can legally hold
  multiple entries when they claim disjoint student populations. Three
  shapes exist today — parallel batch labs, a batch lab merging with
  pooled Practice School, and Elective offerings merging with a main
  subject.
- Introduced "idle" entries as a single mechanism (not two) covering both
  Practice School (Normal) and S1/S2's schedule-adjustment free time —
  same underlying idea (nobody assigned), different display label and
  duration, both handled without extra tables.
- Removed the `departments` table entirely — there's only one department
  (Pharmacy) and it isn't worth modeling as data; colleges are now
  top-level. Admin access is scoped per college, with a Dean role added
  for access across all colleges (`admin_profiles.college_id IS NULL`).
- Faculty and subject-workload data are explicitly "living" data (subject
  hours change, faculty join/leave) and will get a management UI later;
  `created_at`/`updated_at` were added now so that UI has an audit trail
  from day one. Rooms remain static by contrast.
- Formalized every scheduling rule as hard (H1–H9) or soft (S1–S4) in
  §6.4, with the solver's constraint list in §8 now traceable back to
  specific rule IDs.
- v1 deliberately has no admin data-entry UI yet for any of the three
  datasets; the app's only "write" action is triggering a generation run.
