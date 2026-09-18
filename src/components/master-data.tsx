"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, ArrowUpRight } from "lucide-react";
import type { Dataset } from "@/lib/types";
import { Empty, date } from "./workspace";
export function MasterData({
  dataset: d,
  kind,
  collegeId,
}: {
  dataset: Dataset;
  kind: "faculty" | "rooms" | "subjects";
  collegeId: string;
}) {
  const [query, setQuery] = useState(""),
    [course, setCourse] = useState(""),
    [term, setTerm] = useState(""),
    [group, setGroup] = useState(""),
    [type, setType] = useState("");
  const courseTerms = d.academic_terms
    .filter((t) => !course || t.course_id === course)
    .sort((a, b) => a.term_number - b.term_number);
  const terms = courseTerms.filter((t) => !term || t.id === term),
    groups = d.groups.filter((g) => terms.some((t) => t.id === g.term_id));
  const workloads = d.subject_workload.filter((w) =>
    d.subjects.some((s) => s.id === w.subject_id && s.is_active),
  );
  const ws = workloads.filter(
    (w) =>
      terms.some((t) => t.id === w.term_id) && (!group || w.group_id === group),
  );
  const search = (s: string) => s.toLowerCase().includes(query.toLowerCase());
  const faculty = d.faculty.filter(
    (f) =>
      f.is_active &&
      search(`${f.name} ${f.initials}`) &&
      ((!course && !term) || ws.some((w) => w.faculty_id === f.id)),
  );
  const rooms = d.rooms.filter(
    (r) =>
      search(r.room_no) &&
      (!type || r.room_type === type) &&
      (!course || ws.some((w) => w.room_id === r.id)),
  );
  const subjects = ws.filter((w) => {
    const s = d.subjects.find((s) => s.id === w.subject_id)!;
    return search(`${s.name} ${s.code}`) && (!type || s.session_type === type);
  });
  const count =
    kind === "faculty"
      ? faculty.length
      : kind === "rooms"
        ? rooms.length
        : subjects.length;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Master data</div>
          <h1>
            {kind === "faculty"
              ? "Faculty directory"
              : kind === "rooms"
                ? "Rooms & laboratories"
                : "Subjects & workload"}
          </h1>
          <p>
            {kind === "faculty"
              ? "The people behind every class."
              : kind === "rooms"
                ? "Fixed spaces shared across your college."
                : "Review the exact inputs used to build your timetable."}
          </p>
        </div>
        <span className="pill">Read only · SQL managed</span>
      </div>
      <section className="panel">
        <div className="filterbar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label={`Search ${kind}`}
              placeholder={
                kind === "faculty"
                  ? "Search name or initials…"
                  : kind === "rooms"
                    ? "Search room number…"
                    : "Search subject or code…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter by course"
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setTerm("");
              setGroup("");
            }}
          >
            <option value="">All courses</option>
            {d.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {kind !== "rooms" && (
            <select
              aria-label="Filter by term"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setGroup("");
              }}
            >
              <option value="">All terms</option>
              {courseTerms.map((t) => (
                <option value={t.id} key={t.id}>
                  {d.courses.find((c) => c.id === t.course_id)?.name} ·{" "}
                  {t.term_number}
                </option>
              ))}
            </select>
          )}
          {kind === "subjects" && (
            <select
              aria-label="Filter by group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · term{" "}
                  {
                    d.academic_terms.find((t) => t.id === g.term_id)
                      ?.term_number
                  }
                </option>
              ))}
            </select>
          )}
          {kind !== "faculty" && (
            <select
              aria-label="Filter by type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">All types</option>
              {(kind === "rooms"
                ? ["lecture", "lab"]
                : ["theory", "lab", "practice_school", "elective"]
              ).map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="table-count">
          {count}{" "}
          {kind === "subjects"
            ? "workload assignments"
            : kind === "faculty"
              ? "faculty members"
              : "rooms"}
          <span>Inactive faculty and subjects are hidden</span>
        </div>
        {count ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {(kind === "faculty"
                    ? [
                        "Faculty",
                        "Max slots / week",
                        "Assigned slots / week",
                        "Subjects taught",
                        "Last updated",
                        "",
                      ]
                    : kind === "rooms"
                      ? [
                          "Room",
                          "Type",
                          "Fixed subject / group assignments",
                          "",
                        ]
                      : [
                          "Subject",
                          "Course / term",
                          "Group / batch",
                          "Type / scope",
                          "Slots / week",
                          "Faculty",
                          "Room",
                          "Last updated",
                        ]
                  ).map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {kind === "faculty"
                  ? faculty.map((f) => {
                      const assignments = workloads.filter(
                        (w) => w.faculty_id === f.id,
                      );
                      const total = assignments.reduce(
                        (n, w) => n + w.slots_per_week,
                        0,
                      );
                      return (
                        <tr key={f.id}>
                          <td>
                            <Link
                              href={`/college/${collegeId}/faculty-view?id=${f.id}`}
                              className="person-cell"
                            >
                              <span className="avatar">{f.initials}</span>
                              <span>
                                <strong>{f.name}</strong>
                                <small>{f.initials}</small>
                              </span>
                            </Link>
                          </td>
                          <td>{f.max_workload_slots_per_week}</td>
                          <td>
                            {total}
                            <small className="cell-note">
                              All configured terms
                            </small>
                          </td>
                          <td>
                            {[
                              ...new Set(
                                assignments.map(
                                  (w) =>
                                    d.subjects.find(
                                      (s) => s.id === w.subject_id,
                                    )?.code,
                                ),
                              ),
                            ].join(", ") || "Unassigned"}
                          </td>
                          <td>{date(f.updated_at)}</td>
                          <td>
                            <Link
                              aria-label={`View ${f.name} timetable`}
                              href={`/college/${collegeId}/faculty-view?id=${f.id}`}
                            >
                              <ArrowUpRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  : kind === "rooms"
                    ? rooms.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link
                              className="strong-link"
                              href={`/college/${collegeId}/room-view?id=${r.id}`}
                            >
                              {r.room_no}
                            </Link>
                          </td>
                          <td>
                            <span
                              className={`session-tag ${r.room_type === "lab" ? "lab" : "theory"}`}
                            >
                              {r.room_type === "lab" ? "Lab" : "Lecture"}
                            </span>
                          </td>
                          <td>
                            {workloads
                              .filter((w) => w.room_id === r.id)
                              .map(
                                (w) =>
                                  `${d.subjects.find((s) => s.id === w.subject_id)?.code} · ${d.groups.find((g) => g.id === w.group_id)?.name || d.pooled_batches.find((p) => p.id === w.pooled_batch_id)?.name}`,
                              )
                              .join("; ") || "Unassigned"}
                          </td>
                          <td>
                            <Link
                              aria-label={`View room ${r.room_no}`}
                              href={`/college/${collegeId}/room-view?id=${r.id}`}
                            >
                              <ArrowUpRight size={16} />
                            </Link>
                          </td>
                        </tr>
                      ))
                    : subjects.map((w) => {
                        const s = d.subjects.find(
                            (s) => s.id === w.subject_id,
                          )!,
                          t = d.academic_terms.find((t) => t.id === w.term_id)!,
                          c = d.courses.find((c) => c.id === t.course_id)!,
                          f = d.faculty.find((f) => f.id === w.faculty_id);
                        return (
                          <tr key={w.id}>
                            <td>
                              <strong>{s.name}</strong>
                              <small className="cell-note">{s.code}</small>
                            </td>
                            <td>
                              {c.name}
                              <small className="cell-note">
                                {c.term_unit} {t.term_number}
                              </small>
                            </td>
                            <td>
                              {d.groups.find((g) => g.id === w.group_id)
                                ?.name ||
                                d.pooled_batches.find(
                                  (p) => p.id === w.pooled_batch_id,
                                )?.name}
                              <small className="cell-note">
                                {
                                  d.batches.find((b) => b.id === w.batch_id)
                                    ?.name
                                }
                              </small>
                            </td>
                            <td>
                              <span className={`session-tag ${s.session_type}`}>
                                {s.session_type.replace("_", " ")}
                              </span>
                              <small className="cell-note">
                                {w.scope_type}
                              </small>
                            </td>
                            <td>{w.slots_per_week}</td>
                            <td>
                              {f?.name}
                              {f && !f.is_active && (
                                <small className="text-danger">
                                  Inactive · reassign required
                                </small>
                              )}
                            </td>
                            <td>
                              {d.rooms.find((r) => r.id === w.room_id)?.room_no}
                            </td>
                            <td>{date(w.updated_at)}</td>
                          </tr>
                        );
                      })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              query || course || term || type
                ? "No matching records"
                : "No data configured yet"
            }
            description="Master data is seeded through SQL. Try changing the filters or check your college’s data setup."
          />
        )}
      </section>
    </>
  );
}
