import {
  DAYS,
  type Dataset,
  type Workload,
  type Entry,
  type Mode,
  type Adjustment,
  type SolveResult,
  type Conflict,
  type Day,
  type Window,
} from "../src/lib/types";

export function activeWorkloads(data: Dataset, parity: "odd" | "even") {
  const terms = new Set(
    data.academic_terms
      .filter(
        (t) =>
          t.is_active &&
          (data.courses.find((c) => c.id === t.course_id)?.name !== "BPHARM" ||
            t.term_number % 2 === (parity === "odd" ? 1 : 0)),
      )
      .map((t) => t.id),
  );
  return data.subject_workload.filter(
    (w) =>
      terms.has(w.term_id) &&
      data.subjects.find((s) => s.id === w.subject_id)?.is_active !== false,
  );
}

// H9: resource compatibility and population compatibility are separate checks.
export function populationClash(
  a: Workload,
  b: Workload,
  data: Dataset,
): boolean {
  if (a.term_id !== b.term_id) return false;
  if (a.scope_type === "pooled" || b.scope_type === "pooled") {
    if (a.scope_type === "group" || b.scope_type === "group") return true;
    const sa = data.subjects.find((s) => s.id === a.subject_id)!;
    const sb = data.subjects.find((s) => s.id === b.subject_id)!;
    if (a.scope_type === "pooled" && b.scope_type === "pooled")
      return (
        a.pooled_batch_id === b.pooled_batch_id ||
        sa.session_type !== sb.session_type
      );
    const pooled = a.scope_type === "pooled" ? sa : sb;
    const batch = a.scope_type === "batch" ? sa : sb;
    return !(
      (pooled.session_type === "practice_school" &&
        batch.session_type === "lab") ||
      (pooled.session_type === "elective" && batch.session_type === "theory")
    );
  }
  if (a.group_id !== b.group_id) return false;
  return (
    a.scope_type === "group" ||
    b.scope_type === "group" ||
    a.batch_id === b.batch_id
  );
}

export function precheck(data: Dataset, parity: "odd" | "even"): Conflict[] {
  const ws = activeWorkloads(data, parity),
    issues: Conflict[] = [];
  if (!ws.length)
    issues.push({
      rule: "H6",
      message:
        "No active subject workload is configured for this college and parity.",
    });
  for (const w of ws) {
    const s = data.subjects.find((s) => s.id === w.subject_id),
      f = data.faculty.find((f) => f.id === w.faculty_id),
      r = data.rooms.find((r) => r.id === w.room_id);
    const t = data.academic_terms.find((t) => t.id === w.term_id),
      c = data.courses.find((c) => c.id === t?.course_id);
    const issue = (rule: string, message: string) =>
      issues.push({ rule, message, workload_ids: [w.id] });
    if (!s || !f || !r || !t || !c) {
      issue(
        "H8",
        `Workload ${w.id}: a referenced subject, faculty, room, term or course is missing.`,
      );
      continue;
    }
    if (!f.is_active)
      issue(
        "H8",
        `${s.code}: assigned faculty ${f.name} is inactive. Reassign this workload before generating.`,
      );
    if (
      s.college_id !== c.college_id ||
      f.college_id !== c.college_id ||
      r.college_id !== c.college_id
    )
      issue("H8", `${s.code}: resources must belong to the same college.`);
    if (
      !Number.isInteger(w.slots_per_week) ||
      w.slots_per_week <= 0 ||
      w.slots_per_week > 36
    )
      issue("H6", `${s.code}: slots/week must be an integer between 1 and 36.`);
    if (
      ["lab", "practice_school"].includes(s.session_type) &&
      w.slots_per_week % 3 !== 0
    )
      issue(
        "H7",
        `${s.code}: ${w.slots_per_week} slots cannot form complete 3-slot sessions.`,
      );
    const g = data.groups.find((g) => g.id === w.group_id),
      b = data.batches.find((b) => b.id === w.batch_id),
      p = data.pooled_batches.find((p) => p.id === w.pooled_batch_id);
    if (
      (w.scope_type === "group" &&
        (!g || g.term_id !== w.term_id || w.batch_id || w.pooled_batch_id)) ||
      (w.scope_type === "batch" &&
        (!g ||
          g.term_id !== w.term_id ||
          !b ||
          b.group_id !== w.group_id ||
          w.pooled_batch_id ||
          c.name !== "BPHARM")) ||
      (w.scope_type === "pooled" &&
        (!p ||
          p.term_id !== w.term_id ||
          p.kind !== s.session_type ||
          w.group_id ||
          w.batch_id))
    )
      issue("H5/H9", `${s.code}: invalid student population scope.`);
    if (
      ["practice_school", "elective"].includes(s.session_type) &&
      w.scope_type !== "pooled"
    )
      issue("H9", `${s.code}: ${s.session_type} must use a pooled batch.`);
    if (
      s.session_type === "practice_school" &&
      (c.name !== "BPHARM" || ![7, 8].includes(t.term_number))
    )
      issue(
        "H5",
        `${s.code}: Practice School is restricted to BPHARM semesters 7 and 8.`,
      );
    if (
      s.session_type === "lab" &&
      c.name === "BPHARM" &&
      w.scope_type !== "batch"
    )
      issue("H5", `${s.code}: BPHARM labs must use batch scope.`);
  }
  for (const f of data.faculty) {
    const rows = ws.filter((w) => w.faculty_id === f.id),
      n = rows.reduce((a, w) => a + w.slots_per_week, 0),
      max = Math.min(36, f.max_workload_slots_per_week);
    if (n > max)
      issues.push({
        rule: "H3/H6",
        message: `Faculty ${f.initials}: assigned ${n} slots/week, max is ${max}.`,
        workload_ids: rows.map((w) => w.id),
      });
  }
  for (const r of data.rooms) {
    const rows = ws.filter((w) => w.room_id === r.id),
      n = rows.reduce((a, w) => a + w.slots_per_week, 0);
    if (n > 36)
      issues.push({
        rule: "H4/H6",
        message: `Room ${r.room_no}: needs ${n} slots/week; only 36 exist (${n / 3} equivalent windows; maximum 12).`,
        workload_ids: rows.map((w) => w.id),
      });
  }
  for (const g of data.groups) {
    const shared = ws
      .filter((w) => w.group_id === g.id && w.scope_type === "group")
      .reduce((a, w) => a + w.slots_per_week, 0);
    const batches = data.batches.filter((b) => b.group_id === g.id);
    for (const b of batches.length ? batches : [{ id: "", name: g.name }]) {
      const n =
        shared +
        ws
          .filter((w) => w.batch_id === b.id)
          .reduce((a, w) => a + w.slots_per_week, 0);
      if (n > 36)
        issues.push({
          rule: "H6/H9",
          message: `${g.name} ${b.name}: students need ${n} slots/week; only 36 exist.`,
        });
    }
  }
  for (const t of data.academic_terms.filter((t) => t.is_active)) {
    const c = data.courses.find((c) => c.id === t.course_id);
    if (!c) continue;
    const gs = data.groups.filter((g) => g.term_id === t.id);
    const expected = c.name === "BPHARM" ? 2 : c.name === "MPHARM" ? 9 : 1;
    if (
      gs.length !== expected ||
      (c.name === "BPHARM" &&
        gs.some(
          (g) => data.batches.filter((b) => b.group_id === g.id).length !== 2,
        ))
    )
      issues.push({
        rule: "H5",
        message: `${c.name} term ${t.term_number}: requires ${expected} groups${c.name === "BPHARM" ? " with two batches each" : ""}.`,
      });
    if (
      c.name === "BPHARM" &&
      data.term_pairs.filter(
        (p) => p.term_a_id === t.id || p.term_b_id === t.id,
      ).length !== 1
    )
      issues.push({
        rule: "H5",
        message: `BPHARM term ${t.term_number}: must belong to exactly one fixed term pair.`,
      });
  }
  for (const p of data.term_pairs) {
    const a = data.academic_terms.find((t) => t.id === p.term_a_id),
      b = data.academic_terms.find((t) => t.id === p.term_b_id);
    const c = data.courses.find((c) => c.id === a?.course_id);
    if (
      !a ||
      !b ||
      c?.name !== "BPHARM" ||
      a.course_id !== b.course_id ||
      a.academic_year !== b.academic_year ||
      ![
        [1, 3],
        [2, 4],
        [5, 7],
        [6, 8],
      ].some(
        ([x, y]) =>
          Math.min(a.term_number, b.term_number) === x &&
          Math.max(a.term_number, b.term_number) === y,
      )
    )
      issues.push({ rule: "H5", message: "Invalid fixed BPHARM term pair." });
  }
  return issues;
}

interface Placement {
  w: Workload;
  day: Day;
  start: number;
  end: number;
}
interface Candidate {
  day: Day;
  start: number;
  end: number;
}
export function solve(
  data: Dataset,
  parity: "odd" | "even",
  options: { maxMs?: number; maxNodes?: number } = {},
): SolveResult {
  const conflicts = precheck(data, parity);
  const fail = (conflicts: Conflict[], attempts: number): SolveResult => ({
    status: "failed",
    entries: [],
    modes: [],
    adjustments: [],
    conflicts,
    attempts,
  });
  if (conflicts.length) return fail(conflicts, 0);
  const ws = activeWorkloads(data, parity),
    deadline = Date.now() + (options.maxMs ?? 15000);
  const bterms = data.academic_terms.filter(
    (t) =>
      t.is_active &&
      t.term_number % 2 === (parity === "odd" ? 1 : 0) &&
      data.courses.find((c) => c.id === t.course_id)?.name === "BPHARM",
  );
  const pairs = data.term_pairs.filter(
    (p) =>
      bterms.some((t) => t.id === p.term_a_id) &&
      bterms.some((t) => t.id === p.term_b_id),
  );
  const duration = (w: Workload) =>
    ["lab", "practice_school"].includes(
      data.subjects.find((s) => s.id === w.subject_id)!.session_type,
    )
      ? 3
      : 1;
  const durations = new Map(ws.map((w) => [w.id, duration(w)]));
  const clashes = new Map(
    ws.map((w) => [
      w.id,
      new Set(
        ws
          .filter((other) => populationClash(w, other, data))
          .map((other) => other.id),
      ),
    ]),
  );
  let best: Placement[] = [],
    lastModes: Mode[] = [],
    attempts = 0,
    exhausted = false;
  // Enumerate opposite modes first. Then increase the number of changed days.
  const orientations = Math.max(1, 2 ** pairs.length);
  for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
    attempts++;
    const modes: Mode[] = pairs.flatMap((p, i) => [
      {
        term_id: p.term_a_id,
        lab_window:
          ((attempt % orientations) >> i) & 1
            ? ("afternoon" as Window)
            : ("morning" as Window),
      },
      {
        term_id: p.term_b_id,
        lab_window:
          ((attempt % orientations) >> i) & 1
            ? ("morning" as Window)
            : ("afternoon" as Window),
      },
    ]);
    lastModes = modes;
    const relaxBudget =
      attempt < orientations
        ? 0
        : Math.min(6, 1 + Math.floor((attempt - orientations) / 2));
    const placed: Placement[] = [];
    const occupancy = new Map<string, Placement[]>();
    const changes = new Map<string, number>();
    const rowPlacements = new Map<string, Placement[]>();
    let nodes = 0;
    const modeStart = (term: string) =>
      modes.find((m) => m.term_id === term)?.lab_window === "afternoon" ? 4 : 1;
    const offMode = (p: Placement) =>
      durations.get(p.w.id) === 3 &&
      modes.some((m) => m.term_id === p.w.term_id) &&
      p.start !== modeStart(p.w.term_id);
    const changedDays = () => new Set(changes.keys());
    const compatible = (w: Workload, c: Candidate) => {
      for (let slot = c.start; slot <= c.end; slot++)
        for (const p of occupancy.get(`${c.day}:${slot}`) || [])
          if (
            p.w.faculty_id === w.faculty_id ||
            p.w.room_id === w.room_id ||
            clashes.get(w.id)!.has(p.w.id)
          )
            return false;
      return true;
    };
    const push = (p: Placement) => {
      placed.push(p);
      const rp = rowPlacements.get(p.w.id) || [];
      rp.push(p);
      rowPlacements.set(p.w.id, rp);
      for (let s = p.start; s <= p.end; s++) {
        const key = `${p.day}:${s}`,
          list = occupancy.get(key) || [];
        list.push(p);
        occupancy.set(key, list);
      }
      if (offMode(p)) {
        const key = `${p.w.term_id}:${p.day}`;
        changes.set(key, (changes.get(key) || 0) + 1);
      }
    };
    const pop = () => {
      const p = placed.pop()!;
      rowPlacements.get(p.w.id)!.pop();
      for (let s = p.start; s <= p.end; s++)
        occupancy.get(`${p.day}:${s}`)!.pop();
      if (offMode(p)) {
        const key = `${p.w.term_id}:${p.day}`,
          n = changes.get(key)! - 1;
        if (n) changes.set(key, n);
        else changes.delete(key);
      }
    };
    const rows = ws.map((w) => ({ w, count: w.slots_per_week / duration(w) }));
    const domain = (w: Workload): Candidate[] => {
      const dur = duration(w),
        normal = modeStart(w.term_id),
        hasMode = modes.some((m) => m.term_id === w.term_id);
      const starts =
        dur === 1
          ? [1, 2, 3, 4, 5, 6]
          : hasMode && !relaxBudget
            ? [normal]
            : [normal, normal === 1 ? 4 : 1];
      const previous = rowPlacements.get(w.id)?.at(-1);
      return DAYS.flatMap((day, di) =>
        starts.map((start) => ({ day, start, end: start + dur - 1, di })),
      )
        .filter((c) => {
          if (
            previous &&
            c.di * 6 + c.start <=
              DAYS.indexOf(previous.day) * 6 + previous.start
          )
            return false;
          if (!compatible(w, c)) return false;
          if (
            offMode({ w, ...c }) &&
            !changes.has(`${w.term_id}:${c.day}`) &&
            changes.size >= relaxBudget
          )
            return false;
          return true;
        })
        .sort((a, b) => score(w, a) - score(w, b));
    };
    const score = (w: Workload, c: Candidate) => {
      const adjacent =
        (c.start !== 4 &&
        (occupancy.get(`${c.day}:${c.start - 1}`) || []).some(
          (p) => p.w.faculty_id === w.faculty_id,
        )
          ? 1
          : 0) +
        (c.end !== 3 &&
        (occupancy.get(`${c.day}:${c.end + 1}`) || []).some(
          (p) => p.w.faculty_id === w.faculty_id,
        )
          ? 1
          : 0);
      const dayLoad = (rowPlacements.get(w.id) || []).filter(
        (p) => p.day === c.day,
      ).length;
      const theoryInLabWindow =
        durations.get(w.id) === 1 &&
        modes.some((m) => m.term_id === w.term_id) &&
        c.start >= modeStart(w.term_id) &&
        c.start < modeStart(w.term_id) + 3;
      return (
        (offMode({ w, ...c }) ? 100 : 0) +
        (theoryInLabWindow ? 8 : 0) +
        adjacent * 4 +
        dayLoad * 2 +
        ((DAYS.indexOf(c.day) + attempt) % 6) * 0.01
      );
    };
    const search = (): boolean => {
      nodes++;
      if (nodes > (options.maxNodes ?? 60000) || Date.now() > deadline) {
        exhausted = true;
        return false;
      }
      if (placed.length > best.length) best = [...placed];
      const pending = rows.filter((r) => r.count > 0);
      if (!pending.length) return validRelaxation();
      let selected = pending[0],
        values = domain(selected.w);
      for (const r of pending.slice(1)) {
        const d = domain(r.w);
        if (d.length < r.count) return false;
        if (
          d.length / r.count < values.length / selected.count ||
          (d.length / r.count === values.length / selected.count &&
            duration(r.w) > duration(selected.w))
        ) {
          selected = r;
          values = d;
        }
      }
      if (values.length < selected.count) return false;
      for (const v of values) {
        push({ w: selected.w, ...v });
        selected.count--;
        if (search()) return true;
        selected.count++;
        pop();
        if (nodes > (options.maxNodes ?? 60000) || Date.now() > deadline)
          return false;
      }
      return false;
    };
    // S1/S2 may bend only for a partner's theory overflow on that day.
    const validRelaxation = () =>
      placed.filter(offMode).every((p) => {
        const pair = pairs.find(
          (pair) =>
            pair.term_a_id === p.w.term_id || pair.term_b_id === p.w.term_id,
        );
        const partner =
          pair?.term_a_id === p.w.term_id ? pair.term_b_id : pair?.term_a_id;
        return placed.some(
          (q) =>
            q.w.term_id === partner &&
            q.day === p.day &&
            duration(q.w) === 1 &&
            q.start >= modeStart(partner!) &&
            q.start < modeStart(partner!) + 3,
        );
      });
    if (search()) {
      const adjustments: Adjustment[] = [...changedDays()].map((key) => {
        const [term, day] = key.split(":");
        const pair = pairs.find(
          (p) => p.term_a_id === term || p.term_b_id === term,
        )!;
        return {
          term_id: term,
          partner_term_id:
            pair.term_a_id === term ? pair.term_b_id : pair.term_a_id,
          day_of_week: day as Day,
          reason:
            "Additional lab window to accommodate paired-term theory overflow.",
        };
      });
      const entries: Entry[] = placed.map((p) => toEntry(p, data));
      // Shared-classroom overflow can also leave the partner idle without an extra lab.
      for (const pair of pairs)
        for (const [claimant, partner] of [
          [pair.term_a_id, pair.term_b_id],
          [pair.term_b_id, pair.term_a_id],
        ])
          for (const day of DAYS) {
            const theory = placed.filter(
              (p) =>
                p.w.term_id === claimant &&
                p.day === day &&
                durations.get(p.w.id) === 1,
            );
            const sharedRooms = new Set(
              ws
                .filter(
                  (w) => w.term_id === partner && durations.get(w.id) === 1,
                )
                .map((w) => w.room_id),
            );
            if (
              theory.some(
                (p) =>
                  sharedRooms.has(p.w.room_id) &&
                  theory.some(
                    (q) =>
                      q.w.room_id === p.w.room_id &&
                      q.start <= 3 !== p.start <= 3,
                  ),
              ) &&
              !adjustments.some(
                (a) => a.term_id === partner && a.day_of_week === day,
              )
            )
              adjustments.push({
                term_id: partner,
                partner_term_id: claimant,
                day_of_week: day,
                reason:
                  "Paired term uses its shared theory classroom in both windows; uncovered partner slots are free.",
              });
          }
      addIdle(entries, data, modes, adjustments);
      const validation = validateSchedule(data, parity, entries);
      if (validation.length) return fail(validation, attempts);
      return {
        status: "success",
        entries,
        modes,
        adjustments,
        conflicts: [],
        attempts,
      };
    }
  }
  const missing = ws.filter(
    (w) =>
      best
        .filter((p) => p.w.id === w.id)
        .reduce((a, p) => a + p.end - p.start + 1, 0) < w.slots_per_week,
  );
  return fail(
    [
      {
        rule: "SEARCH",
        message: `No complete timetable found in ${attempts} attempts${exhausted ? " within the search budget" : ""}. This is not a proof of infeasibility. Fixed resources, student overlap, or BPHARM windows blocked the best partial schedule. No partial timetable was saved.`,
        workload_ids: missing.map((w) => w.id),
      },
      ...missing.map((w) => ({
        rule: "H3/H4/H6/H9",
        message: `${data.subjects.find((s) => s.id === w.subject_id)?.code}: could not place every requested slot with faculty ${data.faculty.find((f) => f.id === w.faculty_id)?.initials}, room ${data.rooms.find((r) => r.id === w.room_id)?.room_no}${lastModes.some((m) => m.term_id === w.term_id) ? " and the BPHARM window constraints" : ""}.`,
        workload_ids: [w.id],
      })),
    ],
    attempts,
  );
}

function toEntry(p: Placement, data: Dataset): Entry {
  const w = p.w,
    s = data.subjects.find((s) => s.id === w.subject_id)!,
    f = data.faculty.find((f) => f.id === w.faculty_id)!,
    r = data.rooms.find((r) => r.id === w.room_id)!;
  const t = data.academic_terms.find((t) => t.id === w.term_id)!,
    c = data.courses.find((c) => c.id === t.course_id)!;
  const group = data.groups.find((g) => g.id === w.group_id)?.name ?? "";
  return {
    entry_type: "placement",
    subject_workload_id: w.id,
    faculty_id: w.faculty_id,
    room_id: w.room_id,
    term_id: w.term_id,
    group_id: w.group_id,
    batch_id: w.batch_id,
    pooled_batch_id: w.pooled_batch_id,
    idle_label: null,
    idle_reason: null,
    day_of_week: p.day,
    start_slot: p.start,
    end_slot: p.end,
    snapshot: {
      subject_name: s.name,
      subject_code: s.code,
      session_type: s.session_type,
      faculty_name: f.name,
      faculty_initials: f.initials,
      room_no: r.room_no,
      population:
        data.pooled_batches.find((b) => b.id === w.pooled_batch_id)?.name ??
        [group, data.batches.find((b) => b.id === w.batch_id)?.name]
          .filter(Boolean)
          .join(" · "),
      course_name: c.name,
      term_name: `${c.term_unit} ${t.term_number}`,
      group_name: group,
    },
  };
}
function addIdle(
  entries: Entry[],
  data: Dataset,
  modes: Mode[],
  adjustments: Adjustment[],
) {
  const idle = (
    term: string,
    group: string | null,
    day: Day,
    start: number,
    end: number,
    ps: boolean,
  ) =>
    entries.push({
      entry_type: "idle",
      subject_workload_id: null,
      faculty_id: null,
      room_id: null,
      term_id: term,
      group_id: group,
      batch_id: null,
      pooled_batch_id: null,
      idle_label: ps ? "Practice School" : "Free Period",
      idle_reason: ps ? "practice_school_pool" : "schedule_adjustment",
      day_of_week: day,
      start_slot: start,
      end_slot: end,
      snapshot: null,
    });
  for (const t of data.academic_terms.filter(
    (t) =>
      [7, 8].includes(t.term_number) &&
      data.courses.find((c) => c.id === t.course_id)?.name === "BPHARM",
  ))
    for (const day of DAYS) {
      const mode = modes.find((m) => m.term_id === t.id);
      if (!mode) continue;
      const start = mode.lab_window === "morning" ? 1 : 4;
      const es = entries.filter(
        (e) =>
          e.term_id === t.id && e.day_of_week === day && e.start_slot === start,
      );
      if (
        es.some((e) => e.batch_id && e.snapshot?.session_type === "lab") &&
        !es.some((e) => e.snapshot?.session_type === "practice_school")
      )
        idle(t.id, null, day, start, start + 2, true);
    }
  for (const a of adjustments)
    for (const g of data.groups.filter((g) => g.term_id === a.term_id)) {
      const mode = modes.find((m) => m.term_id === a.term_id)!;
      const start = mode.lab_window === "morning" ? 4 : 1;
      for (let slot = start; slot < start + 3; slot++)
        if (
          !entries.some(
            (e) =>
              e.term_id === a.term_id &&
              e.day_of_week === a.day_of_week &&
              (!e.group_id || e.group_id === g.id) &&
              e.start_slot <= slot &&
              e.end_slot >= slot,
          )
        )
          idle(a.term_id, g.id, a.day_of_week, slot, slot, false);
    }
}

// Independent postcondition check: never persist partial or invalid solver output.
export function validateSchedule(
  data: Dataset,
  parity: "odd" | "even",
  entries: Entry[],
): Conflict[] {
  const errors: Conflict[] = [],
    ws = activeWorkloads(data, parity),
    ps = entries.filter((e) => e.entry_type === "placement");
  for (const w of ws)
    if (
      ps
        .filter((e) => e.subject_workload_id === w.id)
        .reduce((n, e) => n + e.end_slot - e.start_slot + 1, 0) !==
      w.slots_per_week
    )
      errors.push({ rule: "H6", message: `Incorrect slot count for ${w.id}.` });
  for (let i = 0; i < ps.length; i++) {
    const e = ps[i],
      w = ws.find((w) => w.id === e.subject_workload_id);
    if (!w) {
      errors.push({ rule: "H6", message: "Unknown workload in output." });
      continue;
    }
    const s = data.subjects.find((s) => s.id === w.subject_id)!;
    const long = ["lab", "practice_school"].includes(s.session_type);
    if (
      !DAYS.includes(e.day_of_week) ||
      e.start_slot < 1 ||
      e.end_slot > 6 ||
      (long
        ? ![1, 4].includes(e.start_slot) || e.end_slot !== e.start_slot + 2
        : e.start_slot !== e.end_slot)
    )
      errors.push({ rule: "H1/H2/H7", message: "Invalid session span." });
    if (e.faculty_id !== w.faculty_id || e.room_id !== w.room_id)
      errors.push({ rule: "H8", message: "Fixed resource changed." });
    for (const other of ps.slice(i + 1))
      if (
        e.day_of_week === other.day_of_week &&
        e.start_slot <= other.end_slot &&
        other.start_slot <= e.end_slot
      ) {
        const ow = ws.find((w) => w.id === other.subject_workload_id);
        if (!ow) continue;
        if (
          e.faculty_id === other.faculty_id ||
          e.room_id === other.room_id ||
          populationClash(w, ow, data)
        )
          errors.push({
            rule: "H3/H4/H9",
            message: `Overlap between ${w.id} and ${ow.id}.`,
          });
      }
  }
  return errors;
}
