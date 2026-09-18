"use client";
import { Fragment, useEffect, useState } from "react";
import { Search, ChevronDown, Clock3, AlertCircle } from "lucide-react";
import { api } from "@/lib/client";
import {
  DAYS,
  TIMES,
  type Dataset,
  type Entry,
  type Generation,
  type Mode,
} from "@/lib/types";
import { Empty, Skeleton, Status, date } from "./workspace";
interface ViewData {
  generation: Generation | null;
  entries: Entry[];
  modes: Mode[];
  snapshot: Dataset | null;
}
function Combobox({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const selected = items.find((i) => i.id === value);
  const matches = items.filter((i) =>
    i.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="combobox">
      <label>
        {label}
        <div className="search-field">
          <Search size={17} />
          <input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="resource-options"
            aria-activedescendant={
              open && matches[active] ? `resource-option-${active}` : undefined
            }
            value={open ? query : selected?.label || ""}
            placeholder={`Search ${label.toLowerCase()}…`}
            onFocus={() => {
              setOpen(true);
              setQuery("");
              setActive(0);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((n) => Math.min(n + 1, matches.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((n) => Math.max(0, n - 1));
              }
              if (e.key === "Enter" && open && matches[active]) {
                e.preventDefault();
                onChange(matches[active].id);
                setOpen(false);
              }
            }}
          />
          <ChevronDown size={15} />
        </div>
      </label>
      {open && (
        <div className="combo-options" id="resource-options" role="listbox">
          {matches.length ? (
            matches.map((item, i) => (
              <button
                id={`resource-option-${i}`}
                role="option"
                aria-selected={item.id === value}
                className={i === active ? "highlighted" : ""}
                key={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(item.id);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))
          ) : (
            <span>No matching results</span>
          )}
        </div>
      )}
    </div>
  );
}
export function TimetableViewer({
  kind,
  collegeId,
  stale,
}: {
  kind: string;
  collegeId: string;
  stale: boolean;
}) {
  const [data, setData] = useState<ViewData | null>(null),
    [error, setError] = useState(""),
    [course, setCourse] = useState(""),
    [term, setTerm] = useState(""),
    [group, setGroup] = useState(""),
    [resource, setResource] = useState("");
  useEffect(() => {
    let live = true;
    api<ViewData>(`/timetable?college_id=${collegeId}`)
      .then((d) => {
        if (!live) return;
        setData(d);
        const q = new URLSearchParams(window.location.search),
          snapshot = d.snapshot;
        if (snapshot) {
          const first =
            snapshot.courses.find((c) => c.id === q.get("course")) ||
            snapshot.courses[0];
          setCourse(first?.id || "");
          const t = snapshot.academic_terms
            .filter(
              (t) =>
                t.course_id === first?.id &&
                d.entries.some((e) => e.term_id === t.id),
            )
            .sort((a, b) => a.term_number - b.term_number)[0];
          setTerm(t?.id || "");
          setGroup(snapshot.groups.find((g) => g.term_id === t?.id)?.id || "");
          const rs =
            kind === "faculty-view" ? snapshot.faculty : snapshot.rooms;
          setResource(
            rs.find((r) => r.id === q.get("id"))?.id || rs[0]?.id || "",
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [collegeId, kind]);
  if (error)
    return (
      <div role="alert" className="notice danger">
        {error}
      </div>
    );
  if (!data) return <Skeleton />;
  const title =
    kind === "timetable"
      ? "Group timetable"
      : kind === "faculty-view"
        ? "Faculty timetable"
        : "Room occupancy";
  if (!data.generation || !data.snapshot)
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{title}</h1>
          </div>
        </div>
        <div className="panel">
          <Empty
            title="No timetable generated yet"
            description="Click Generate to create a timetable. Your latest successful generation will appear here."
          />
        </div>
      </>
    );
  const d = data.snapshot,
    terms = d.academic_terms
      .filter(
        (t) =>
          t.course_id === course &&
          data.entries.some((e) => e.term_id === t.id),
      )
      .sort((a, b) => a.term_number - b.term_number),
    groups = d.groups.filter((g) => g.term_id === term),
    mode = data.modes.find((m) => m.term_id === term);
  const entries = data.entries.filter((e) =>
    kind === "timetable"
      ? e.term_id === term && (!e.group_id || e.group_id === group)
      : kind === "faculty-view"
        ? e.faculty_id === resource
        : e.room_id === resource,
  );
  const context =
    kind === "timetable"
      ? `${d.courses.find((c) => c.id === course)?.name || ""} / ${d.courses.find((c) => c.id === course)?.term_unit || "Term"} ${terms.find((t) => t.id === term)?.term_number || ""} / ${groups.find((g) => g.id === group)?.name || ""}`
      : kind === "faculty-view"
        ? d.faculty.find((f) => f.id === resource)?.name
        : `Room ${d.rooms.find((r) => r.id === resource)?.room_no || ""}`;
  const items =
    kind === "faculty-view"
      ? d.faculty.map((f) => ({ id: f.id, label: `${f.name} (${f.initials})` }))
      : d.rooms.map((r) => ({
          id: r.id,
          label: `${r.room_no} · ${r.room_type}`,
        }));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Weekly schedule</div>
          <h1>{title}</h1>
          <p>
            {kind === "timetable"
              ? "A complete view of the academic week."
              : kind === "faculty-view"
                ? "Teaching assignments across every course and student group."
                : "Every scheduled session in a single space."}
          </p>
        </div>
        <Status status="success" />
      </div>
      {stale && (
        <div className="notice warning">
          <AlertCircle size={18} />
          You’re viewing a saved timetable. Master data has changed since this
          generation.
        </div>
      )}
      <section className="panel timetable-panel">
        <div className="viewer-controls">
          {kind === "timetable" ? (
            <>
              {[
                {
                  label: "Course",
                  value: course,
                  options: d.courses.map((c) => ({ id: c.id, label: c.name })),
                  change: (id: string) => {
                    setCourse(id);
                    const t = d.academic_terms
                      .filter(
                        (t) =>
                          t.course_id === id &&
                          data.entries.some((e) => e.term_id === t.id),
                      )
                      .sort((a, b) => a.term_number - b.term_number)[0];
                    setTerm(t?.id || "");
                    setGroup(
                      d.groups.find((g) => g.term_id === t?.id)?.id || "",
                    );
                  },
                },
                {
                  label: "Term",
                  value: term,
                  options: terms.map((t) => ({
                    id: t.id,
                    label: `${d.courses.find((c) => c.id === course)?.term_unit} ${t.term_number}`,
                  })),
                  change: (id: string) => {
                    setTerm(id);
                    setGroup(d.groups.find((g) => g.term_id === id)?.id || "");
                  },
                },
                {
                  label: "Group",
                  value: group,
                  options: groups.map((g) => ({ id: g.id, label: g.name })),
                  change: setGroup,
                },
              ].map((s) => (
                <label key={s.label}>
                  {s.label}
                  <select
                    value={s.value}
                    onChange={(e) => s.change(e.target.value)}
                  >
                    {!s.options.length && (
                      <option value="">
                        No scheduled {s.label.toLowerCase()}
                      </option>
                    )}
                    {s.options.map((o) => (
                      <option value={o.id} key={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          ) : (
            <Combobox
              label={kind === "faculty-view" ? "Faculty" : "Room"}
              items={items}
              value={resource}
              onChange={setResource}
            />
          )}
          <div className="viewer-meta">
            <Clock3 size={15} />
            <span>Generated {date(data.generation.completed_at)}</span>
          </div>
        </div>
        <div className="grid-title">
          <div>
            <h2>{context}</h2>
            <span className="muted">
              Monday – Saturday · {data.generation.active_parity} semester cycle
            </span>
          </div>
          {kind === "timetable" && mode && (
            <span className="mode-badge">Labs: {mode.lab_window}</span>
          )}
        </div>
        <div className="legend">
          {[
            ["theory", "Theory"],
            ["lab", "Lab"],
            ["practice_school", "Practice School"],
            ["elective", "Elective"],
            ["idle", "Idle / free"],
          ].map(([type, label]) => (
            <span key={type}>
              <i className={type} />
              {label}
            </span>
          ))}
        </div>
        <div className="timetable-scroll">
          <table className="timetable">
            <thead>
              <tr>
                <th>Time</th>
                {DAYS.map((day) => (
                  <th key={day}>
                    {day[0].toUpperCase() + day.slice(1)}
                    {kind === "timetable" &&
                      data.generation!.adjustments?.some(
                        (a) =>
                          (a.term_id === term || a.partner_term_id === term) &&
                          a.day_of_week === day,
                      ) && <small className="adjusted">Adjusted</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIMES.map((time, i) => (
                <Fragment key={time}>
                  {i === 3 && (
                    <tr className="lunch">
                      <th>12:30 – 1:30</th>
                      <td colSpan={6}>Lunch break</td>
                    </tr>
                  )}
                  <tr>
                    <th>
                      {time}
                      <small>Slot {i + 1}</small>
                    </th>
                    {DAYS.map((day) => {
                      const cells = entries.filter(
                        (e) =>
                          e.day_of_week === day &&
                          e.start_slot <= i + 1 &&
                          e.end_slot >= i + 1,
                      );
                      return (
                        <td key={day}>
                          {cells.length ? (
                            <TimetableCell
                              entries={cells}
                              showPopulation={kind !== "timetable"}
                            />
                          ) : (
                            <span className="free-cell">
                              {kind === "timetable" ? "—" : "Free"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted snapshot-caption">
        Read-only generation snapshot. Each 3-slot session occupies one full
        morning or afternoon window.
      </p>
    </>
  );
}
export function TimetableCell({
  entries,
  showPopulation,
}: {
  entries: Entry[];
  showPopulation: boolean;
}) {
  const pooled =
    entries.length > 1 &&
    entries.every((e) => e.pooled_batch_id && e.entry_type === "placement");
  if (pooled)
    return (
      <details
        className={`schedule-cell pooled ${entries[0].snapshot?.session_type}`}
      >
        <summary>
          <strong>
            {entries[0].snapshot?.session_type === "practice_school"
              ? "Practice School"
              : "Elective offerings"}
          </strong>
          <span>
            {entries.length} batches <ChevronDown size={13} />
          </span>
        </summary>
        <div className="pool-details">
          {entries.map((e, i) => (
            <div key={e.id || i}>
              <strong>{e.snapshot?.population}</strong>
              <span>{e.snapshot?.subject_name}</span>
              <span>
                {e.snapshot?.faculty_initials} · {e.snapshot?.room_no}
              </span>
            </div>
          ))}
        </div>
      </details>
    );
  return (
    <div className="cell-stack">
      {entries.map((e, i) => (
        <div
          className={`schedule-cell ${e.entry_type === "idle" ? "idle" : e.snapshot?.session_type}`}
          key={e.id || i}
        >
          {e.entry_type === "idle" ? (
            <strong>{e.idle_label}</strong>
          ) : (
            <>
              {(showPopulation || entries.length > 1) && (
                <span className="population-label">
                  {showPopulation
                    ? `${e.snapshot?.course_name} · ${e.snapshot?.term_name} · `
                    : ""}
                  {e.snapshot?.population}
                </span>
              )}
              <strong>{e.snapshot?.subject_name}</strong>
              <div className="cell-resource">
                <span title={e.snapshot?.faculty_name}>
                  {e.snapshot?.faculty_initials}
                </span>
                <span>{e.snapshot?.room_no}</span>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
