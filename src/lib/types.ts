export type CourseName = "BPHARM" | "MPHARM" | "PHARMD";
export type SessionType = "theory" | "lab" | "practice_school" | "elective";
export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type Window = "morning" | "afternoon";
export interface College {
  id: string;
  code: string;
  name: string;
}
export interface Course {
  id: string;
  college_id: string;
  name: CourseName;
  term_unit: string;
  total_terms: number;
}
export interface Term {
  id: string;
  course_id: string;
  term_number: number;
  academic_year: string;
  is_active: boolean;
}
export interface Group {
  id: string;
  term_id: string;
  name: string;
  group_type: string;
}
export interface Batch {
  id: string;
  group_id: string;
  name: string;
}
export interface Pool {
  id: string;
  term_id: string;
  name: string;
  kind: "elective" | "practice_school";
}
export interface Faculty {
  id: string;
  college_id: string;
  name: string;
  initials: string;
  max_workload_slots_per_week: number;
  is_active: boolean;
  updated_at: string;
}
export interface Room {
  id: string;
  college_id: string;
  room_no: string;
  room_type: "lecture" | "lab";
}
export interface Subject {
  id: string;
  college_id: string;
  code: string;
  name: string;
  session_type: SessionType;
  is_active: boolean;
  updated_at: string;
}
export interface Workload {
  id: string;
  subject_id: string;
  term_id: string;
  scope_type: "group" | "batch" | "pooled";
  group_id: string | null;
  batch_id: string | null;
  pooled_batch_id: string | null;
  faculty_id: string;
  room_id: string;
  slots_per_week: number;
  updated_at: string;
}
export interface Pair {
  term_a_id: string;
  term_b_id: string;
}
export interface Dataset {
  colleges: College[];
  courses: Course[];
  academic_terms: Term[];
  groups: Group[];
  batches: Batch[];
  pooled_batches: Pool[];
  faculty: Faculty[];
  rooms: Room[];
  subjects: Subject[];
  subject_workload: Workload[];
  term_pairs: Pair[];
}
export interface Conflict {
  rule: string;
  message: string;
  workload_ids?: string[];
}
export interface Snapshot {
  subject_name: string;
  subject_code: string;
  session_type: SessionType;
  faculty_name: string;
  faculty_initials: string;
  room_no: string;
  population: string;
  course_name: string;
  term_name: string;
  group_name: string;
}
export interface Entry {
  id?: string;
  entry_type: "placement" | "idle";
  subject_workload_id: string | null;
  faculty_id: string | null;
  room_id: string | null;
  term_id: string;
  group_id: string | null;
  batch_id: string | null;
  pooled_batch_id: string | null;
  idle_label: string | null;
  idle_reason: "practice_school_pool" | "schedule_adjustment" | null;
  day_of_week: Day;
  start_slot: number;
  end_slot: number;
  snapshot: Snapshot | null;
}
export interface Mode {
  term_id: string;
  lab_window: Window;
}
export interface Adjustment {
  term_id: string;
  partner_term_id: string;
  day_of_week: Day;
  reason: string;
}
export interface SolveResult {
  status: "success" | "failed";
  entries: Entry[];
  modes: Mode[];
  adjustments: Adjustment[];
  conflicts: Conflict[];
  attempts: number;
}
export interface Generation {
  id: string;
  college_id: string;
  active_parity: "odd" | "even";
  status: "running" | "success" | "failed";
  started_at: string;
  completed_at: string | null;
  conflict_report: Conflict[];
  input_fingerprint: string;
  adjustments: Adjustment[];
  input_snapshot?: Dataset;
}
export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
export const TIMES = [
  "9:30 – 10:30",
  "10:30 – 11:30",
  "11:30 – 12:30",
  "1:30 – 2:30",
  "2:30 – 3:30",
  "3:30 – 4:25",
];
