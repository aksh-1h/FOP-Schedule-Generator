import { describe, it, expect } from "vitest";
import { fixture, add } from "./fixtures";
import {
  solve,
  precheck,
  populationClash,
  validateSchedule,
} from "../server/solver";
import { fingerprint } from "../server/app";
describe("hard constraints and snapshot safety", () => {
  it("schedules all three courses with shared resources without clashes", () => {
    const d = fixture();
    const a = add(d, "a", "theory", 6);
    add(d, "b", "lab", 6, "BPHARM-1", "batch");
    add(d, "c", "lab", 3, "MPHARM-2", "group", { faculty_id: a.faculty_id });
    add(d, "d", "theory", 4, "PHARMD-1", "group", { room_id: a.room_id });
    const r = solve(d, "odd");
    expect(r.status).toBe("success");
    expect(validateSchedule(d, "odd", r.entries)).toEqual([]);
    expect(
      r.entries
        .filter((e) => e.entry_type === "placement")
        .reduce((n, e) => n + e.end_slot - e.start_slot + 1, 0),
    ).toBe(19);
  });
  it("reports all overloads before search", () => {
    const d = fixture();
    const a = add(d, "a", "theory", 20);
    add(d, "b", "theory", 20, "BPHARM-3", "group", {
      faculty_id: a.faculty_id,
      room_id: a.room_id,
    });
    const r = solve(d, "odd");
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(0);
    expect(r.conflicts.some((c) => c.rule === "H3/H6")).toBe(true);
    expect(r.conflicts.some((c) => c.rule === "H4/H6")).toBe(true);
    expect(r.entries).toHaveLength(0);
  });
  it("rejects incomplete 3-slot labs", () => {
    const d = fixture();
    add(d, "a", "lab", 4, "BPHARM-1", "batch");
    expect(precheck(d, "odd").some((c) => c.rule === "H7")).toBe(true);
  });
  it("ignores inactive subjects but rejects assignments to inactive faculty", () => {
    const d = fixture();
    add(d, "a");
    add(d, "b");
    d.subjects[0].is_active = false;
    d.faculty[0].is_active = false;
    expect(solve(d, "odd").status).toBe("success");
    d.faculty[1].is_active = false;
    expect(precheck(d, "odd").some((c) => c.rule === "H8")).toBe(true);
  });
  it("uses only the chosen BPHARM parity and keeps all active other courses", () => {
    const d = fixture();
    add(d, "odd");
    add(d, "even", "theory", 3, "BPHARM-2");
    add(d, "mph", "theory", 3, "MPHARM-1");
    const r = solve(d, "even");
    expect(r.status).toBe("success");
    expect(r.entries.map((e) => e.subject_workload_id)).not.toContain("odd");
    expect(r.entries.map((e) => e.subject_workload_id)).toContain("mph");
  });
  it("permits parallel sibling batch labs and rejects whole-group overlap", () => {
    const d = fixture();
    const a = add(d, "a", "lab", 3, "BPHARM-1", "batch"),
      b = add(d, "b", "lab", 3, "BPHARM-1", "batch", {
        batch_id: "BPHARM-1-g0-b1",
      }),
      c = add(d, "c");
    expect(populationClash(a, b, d)).toBe(false);
    expect(populationClash(a, c, d)).toBe(true);
  });
  it("allows PS alongside batch labs, generates Normal PS idle with no faculty or room", () => {
    const d = fixture();
    const a = add(d, "a", "lab", 3, "BPHARM-7", "batch");
    let r = solve(d, "odd");
    expect(r.status).toBe("success");
    expect(
      r.entries.some(
        (e) =>
          e.idle_label === "Practice School" &&
          !e.faculty_id &&
          !e.room_id &&
          e.end_slot - e.start_slot === 2,
      ),
    ).toBe(true);
    const p = add(d, "p", "practice_school", 3, "BPHARM-7", "pooled");
    expect(populationClash(a, p, d)).toBe(false);
    r = solve(d, "odd");
    expect(r.status).toBe("success");
  });
  it("permits parallel electives and a disjoint batch-scoped main class", () => {
    const d = fixture();
    const a = add(d, "a", "elective", 3, "BPHARM-7", "pooled"),
      b = add(d, "b", "elective", 3, "BPHARM-7", "pooled"),
      main = add(d, "main", "theory", 3, "BPHARM-7", "batch"),
      whole = add(d, "whole", "theory", 3, "BPHARM-7");
    expect(populationClash(a, b, d)).toBe(false);
    expect(populationClash(a, main, d)).toBe(false);
    expect(populationClash(a, whole, d)).toBe(true);
  });
  it("records opposite BPHARM modes with no unnecessary adjustments", () => {
    const d = fixture();
    add(d, "a", "lab", 3, "BPHARM-1", "batch");
    add(d, "b", "lab", 3, "BPHARM-3", "batch");
    const r = solve(d, "odd");
    expect(r.status).toBe("success");
    expect(r.modes.find((m) => m.term_id === "BPHARM-1")?.lab_window).not.toBe(
      r.modes.find((m) => m.term_id === "BPHARM-3")?.lab_window,
    );
    expect(r.adjustments).toHaveLength(0);
  });
  it("relaxes only a day when a seventh lab window compensates paired theory", () => {
    const d = fixture();
    add(d, "labs", "lab", 21, "BPHARM-1", "batch");
    add(d, "theory", "theory", 20, "BPHARM-3");
    const r = solve(d, "odd");
    expect(r.status).toBe("success");
    expect(r.adjustments.filter((a) => a.term_id === "BPHARM-1")).toHaveLength(
      1,
    );
    expect(validateSchedule(d, "odd", r.entries)).toEqual([]);
  });
  it("keeps display snapshots stable after master data changes", () => {
    const d = fixture();
    add(d, "a");
    const r = solve(d, "odd"),
      before = JSON.stringify(r.entries);
    d.faculty[0].name = "New name";
    d.subjects[0].name = "New subject";
    d.rooms[0].room_no = "Other";
    expect(JSON.stringify(r.entries)).toBe(before);
  });
  it("fingerprints are order independent and detect updates and soft deletes", () => {
    const d = fixture();
    add(d, "a");
    const initial = fingerprint(d);
    d.groups.reverse();
    expect(fingerprint(d)).toBe(initial);
    d.faculty[0].is_active = false;
    expect(fingerprint(d)).not.toBe(initial);
  });
  it("never saves a partial schedule after budget exhaustion", () => {
    const d = fixture();
    add(d, "a");
    const r = solve(d, "odd", { maxNodes: 0 });
    expect(r.status).toBe("failed");
    expect(r.entries).toEqual([]);
    expect(r.conflicts[0].message).toContain("not a proof of infeasibility");
  });
  it("the independent validator catches corrupted fixed resources", () => {
    const d = fixture();
    add(d, "a");
    const r = solve(d, "odd");
    r.entries[0].room_id = "wrong";
    expect(
      validateSchedule(d, "odd", r.entries).some((c) => c.rule === "H8"),
    ).toBe(true);
  });
});
