import type { Dataset, Workload, SessionType } from "../src/lib/types";
export function fixture(): Dataset {
  const d: Dataset = {
    colleges: [{ id: "college", code: "PIP", name: "Test college" }],
    courses: [],
    academic_terms: [],
    groups: [],
    batches: [],
    pooled_batches: [],
    faculty: [],
    rooms: [],
    subjects: [],
    subject_workload: [],
    term_pairs: [],
  };
  for (const name of ["BPHARM", "MPHARM", "PHARMD"] as const) {
    const count = name === "BPHARM" ? 8 : name === "MPHARM" ? 4 : 5;
    d.courses.push({
      id: name,
      college_id: "college",
      name,
      term_unit: name === "PHARMD" ? "year" : "semester",
      total_terms: count,
    });
    for (let n = 1; n <= count; n++) {
      const id = `${name}-${n}`;
      d.academic_terms.push({
        id,
        course_id: name,
        term_number: n,
        academic_year: "2026-27",
        is_active: true,
      });
      for (
        let g = 0;
        g < (name === "BPHARM" ? 2 : name === "MPHARM" ? 9 : 1);
        g++
      ) {
        const gid = `${id}-g${g}`;
        d.groups.push({
          id: gid,
          term_id: id,
          name: `Group ${g}`,
          group_type:
            name === "BPHARM"
              ? "division"
              : name === "MPHARM"
                ? "specialization"
                : "year_group",
        });
        if (name === "BPHARM")
          for (let b = 0; b < 2; b++)
            d.batches.push({
              id: `${gid}-b${b}`,
              group_id: gid,
              name: `Batch ${g * 2 + b}`,
            });
      }
    }
  }
  for (const [a, b] of [
    [1, 3],
    [5, 7],
    [2, 4],
    [6, 8],
  ])
    d.term_pairs.push({ term_a_id: `BPHARM-${a}`, term_b_id: `BPHARM-${b}` });
  return d;
}
export function add(
  d: Dataset,
  id: string,
  type: SessionType = "theory",
  slots = 3,
  term = "BPHARM-1",
  scope: Workload["scope_type"] = "group",
  overrides: Partial<Workload> = {},
): Workload {
  const fid = `f-${id}`,
    rid = `r-${id}`,
    sid = `s-${id}`,
    gid = `${term}-g0`,
    pid = `p-${id}`;
  d.faculty.push({
    id: fid,
    college_id: "college",
    name: `Faculty ${id}`,
    initials: id,
    max_workload_slots_per_week: 36,
    is_active: true,
    updated_at: "2026-01-01",
  });
  d.rooms.push({
    id: rid,
    college_id: "college",
    room_no: id,
    room_type: type === "lab" ? "lab" : "lecture",
  });
  d.subjects.push({
    id: sid,
    college_id: "college",
    code: id,
    name: `Subject ${id}`,
    session_type: type,
    is_active: true,
    updated_at: "2026-01-01",
  });
  if (scope === "pooled")
    d.pooled_batches.push({
      id: pid,
      term_id: term,
      name: `Pool ${id}`,
      kind: type as "elective" | "practice_school",
    });
  const w: Workload = {
    id,
    subject_id: sid,
    term_id: term,
    scope_type: scope,
    group_id: scope === "pooled" ? null : gid,
    batch_id: scope === "batch" ? `${gid}-b0` : null,
    pooled_batch_id: scope === "pooled" ? pid : null,
    faculty_id: fid,
    room_id: rid,
    slots_per_week: slots,
    updated_at: "2026-01-01",
    ...overrides,
  };
  d.subject_workload.push(w);
  return w;
}
