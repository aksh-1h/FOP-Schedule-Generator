"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  DoorOpen,
  BookOpen,
  WandSparkles,
  ChevronRight,
  ArrowUpRight,
  GraduationCap,
  LogOut,
  CircleHelp,
  Building2,
  CheckCircle2,
  Clock3,
  AlertCircle,
  ArrowRight,
  Menu,
  X,
  RefreshCw,
} from "lucide-react";
import { api, hasSession, signOut } from "@/lib/client";
import type { College, Dataset, Generation } from "@/lib/types";
import { MasterData } from "./master-data";
import { TimetableViewer } from "./timetable";

export interface Overview {
  dataset: Dataset;
  latest: Generation | null;
  latestSuccessful: Generation | null;
  history: Generation[];
  stale: boolean;
}
const navigation = [
  {
    label: "Overview",
    items: [
      ["dashboard", "Dashboard", LayoutDashboard],
      ["generate", "Generate timetable", WandSparkles],
    ],
  },
  {
    label: "Master data",
    items: [
      ["faculty", "Faculty", Users],
      ["rooms", "Rooms", DoorOpen],
      ["subjects", "Subjects & workload", BookOpen],
    ],
  },
  {
    label: "Timetables",
    items: [
      ["timetable", "Group timetable", CalendarDays],
      ["faculty-view", "Faculty timetable", Users],
      ["room-view", "Room occupancy", Building2],
    ],
  },
] as const;
export function date(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not generated yet";
}
export function Status({ status }: { status?: string }) {
  return (
    <span className={`status ${status || "none"}`}>
      <span />
      {status === "success"
        ? "Successful"
        : status === "failed"
          ? "Failed"
          : status === "running"
            ? "Running"
            : "No generation"}
    </span>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <CalendarDays size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-stack" aria-label="Loading data">
      <div className="skeleton" />
      <div className="course-grid">
        {[1, 2, 3].map((n) => (
          <div className="skeleton tall" key={n} />
        ))}
      </div>
      <div className="skeleton tall" />
    </div>
  );
}

export function Workspace({
  collegeId,
  page,
}: {
  collegeId?: string;
  page: string;
}) {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]),
    [profile, setProfile] = useState<{
      college_id: string | null;
      email: string;
    } | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [parity, setParity] = useState<"odd" | "even">("odd"),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [help, setHelp] = useState(false);
  const refresh = useCallback(async () => {
    if (!collegeId) return;
    const result = await api<Overview>(`/overview?college_id=${collegeId}`);
    setOverview(result);
  }, [collegeId]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    setOverview(null);
    async function load() {
      try {
        if (!(await hasSession())) {
          router.replace("/login");
          return;
        }
        const [cs, p] = await Promise.all([
          api<College[]>("/colleges"),
          api<{ college_id: string | null; email: string }>("/me"),
        ]);
        if (!mounted) return;
        setColleges(cs);
        setProfile(p);
        if (!collegeId && p.college_id) {
          router.replace(`/college/${p.college_id}`);
          return;
        }
        if (collegeId) {
          const o = await api<Overview>(`/overview?college_id=${collegeId}`);
          if (!mounted) return;
          setOverview(o);
          const saved = localStorage.getItem(`fop-parity-${collegeId}`);
          setParity(
            saved === "odd" || saved === "even"
              ? saved
              : o.latest?.active_parity || "odd",
          );
        }
      } catch (e) {
        console.error("Workspace load failed", e);
        if (mounted)
          setError(
            e instanceof Error && e.message
              ? e.message
              : "Unable to load your workspace. Please sign in again or retry.",
          );
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [collegeId, router]);
  useEffect(() => {
    if (!collegeId) return;
    const check = () => refresh().catch(() => {});
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [collegeId, refresh]);
  const chooseParity = (p: "odd" | "even") => {
    setParity(p);
    if (collegeId) localStorage.setItem(`fop-parity-${collegeId}`, p);
  };
  async function generate() {
    if (!collegeId || busy) return;
    setBusy(true);
    setError("");
    try {
      await api<Generation>("/generate", {
        college_id: collegeId,
        active_parity: parity,
      });
      await refresh();
      router.push(`/college/${collegeId}/generate`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const college = colleges.find((c) => c.id === collegeId),
    title =
      navigation
        .map((n) => n.items.find((item) => item[0] === page)?.[1])
        .find(Boolean) || "Page not found";
  const href = (p: string) =>
    `/college/${collegeId}${p === "dashboard" ? "" : "/" + p}`;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link href="/college" className="brand">
          <span className="brand-icon">
            <CalendarDays size={22} />
          </span>
          <div>
            FOP <span>Timetable studio</span>
          </div>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        >
          <X size={18} />
        </button>
        <div className="college-switch">
          <span className="eyebrow">Workspace</span>
          {profile?.college_id === null ? (
            <select
              aria-label="Active college"
              value={collegeId || ""}
              onChange={(e) => router.push(`/college/${e.target.value}`)}
            >
              <option value="" disabled>
                Select a college
              </option>
              {colleges.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          ) : (
            <strong>
              <Building2 size={17} />
              {college?.code || "Your college"}
            </strong>
          )}
          <small>{college?.name || "Faculty of Pharmacy"}</small>
        </div>
        <nav>
          {navigation.map((section) => (
            <div className="nav-section" key={section.label}>
              <div className="nav-label">{section.label}</div>
              {section.items.map(([key, label, Icon]) => (
                <Link
                  key={key}
                  href={collegeId ? href(key) : "/college"}
                  className={`nav-link ${collegeId && key === page ? "active" : ""}`}
                  onClick={() => setMobile(false)}
                >
                  <Icon size={18} />
                  {label}
                  {collegeId && key === page && <span className="active-dot" />}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={() => setHelp(!help)}>
            <CircleHelp size={17} /> Scheduling guide <ArrowUpRight size={14} />
          </button>
          {help && (
            <p className="help-copy">
              Master data is maintained in SQL. Choose a parity, then generate
              the whole college. A successful run appears in all three timetable
              views. Changes to master data require a new generation.
            </p>
          )}
          <div className="profile">
            <span className="avatar">
              {profile?.email?.slice(0, 1).toUpperCase() || "A"}
            </span>
            <div>
              <strong>
                {profile?.college_id === null ? "Dean" : "Administrator"}
              </strong>
              <small title={profile?.email}>
                {profile?.email || "Signing in…"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumbs">
            <span>Faculty of Pharmacy</span>
            <ChevronRight size={14} />
            <span>{college?.code || "Colleges"}</span>
            {collegeId && (
              <>
                <ChevronRight size={14} />
                <strong>{title}</strong>
              </>
            )}
          </div>
          <span className="topbar-tag">
            <span />
            Academic workspace
          </span>
        </header>
        <main className="content">
          {error && (
            <div role="alert" className="notice danger">
              <AlertCircle size={19} />
              <div>{error}</div>
              <button
                onClick={() => {
                  setError("");
                  refresh().catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <Skeleton />
          ) : !collegeId ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">Your workspace</div>
                  <h1>Select a college</h1>
                  <p>
                    Choose the college whose academic week you’d like to plan.
                  </p>
                </div>
                <span className="pill">Dean access</span>
              </div>
              <div className="college-grid">
                {colleges.map((c) => (
                  <Link
                    href={`/college/${c.id}`}
                    className="panel college-card"
                    key={c.id}
                  >
                    <span className="tile-icon">
                      <Building2 size={24} />
                    </span>
                    <span className="eyebrow">{c.code}</span>
                    <h2>{c.name}</h2>
                    <span className="text-link">
                      Open workspace <ArrowRight size={16} />
                    </span>
                  </Link>
                ))}
              </div>
              {!colleges.length && !error && (
                <Empty
                  title="No colleges available"
                  description="Your administrator needs to provision a college and your access profile."
                />
              )}
            </>
          ) : overview ? (
            <>
              {page === "dashboard" ? (
                <Dashboard
                  overview={overview}
                  college={college!}
                  parity={parity}
                  setParity={chooseParity}
                  generate={generate}
                  busy={busy}
                  href={href}
                />
              ) : page === "generate" ? (
                <GeneratePage
                  overview={overview}
                  parity={parity}
                  setParity={chooseParity}
                  generate={generate}
                  busy={busy}
                  href={href}
                />
              ) : ["faculty", "rooms", "subjects"].includes(page) ? (
                <MasterData
                  key={page}
                  dataset={overview.dataset}
                  kind={page as "faculty" | "rooms" | "subjects"}
                  collegeId={collegeId}
                />
              ) : ["timetable", "faculty-view", "room-view"].includes(page) ? (
                <TimetableViewer
                  key={page}
                  kind={page}
                  collegeId={collegeId}
                  stale={overview.stale}
                />
              ) : (
                <Empty
                  title="Page not found"
                  description="Choose a page from the navigation."
                />
              )}
              <footer className="page-footer">
                <span>Faculty of Pharmacy · {college?.code}</span>
                <span>One college. One connected schedule.</span>
              </footer>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
function Parity({
  value,
  onChange,
}: {
  value: "odd" | "even";
  onChange: (p: "odd" | "even") => void;
}) {
  return (
    <div className="parity">
      <span>BPHARM active semesters</span>
      <div className="segmented">
        {(["odd", "even"] as const).map((p) => (
          <button
            key={p}
            aria-pressed={value === p}
            className={p === value ? "selected" : ""}
            onClick={() => onChange(p)}
          >
            {p === "odd" ? "Odd · 1, 3, 5, 7" : "Even · 2, 4, 6, 8"}
          </button>
        ))}
      </div>
    </div>
  );
}
function Dashboard({
  overview: o,
  college,
  parity,
  setParity,
  generate,
  busy,
  href,
}: {
  overview: Overview;
  college: College;
  parity: "odd" | "even";
  setParity: (p: "odd" | "even") => void;
  generate: () => void;
  busy: boolean;
  href: (p: string) => string;
}) {
  const d = o.dataset;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Academic planning</div>
          <h1>A well-planned week starts here.</h1>
          <p>
            {college.name} <span className="dot-separator">·</span> Your
            scheduling overview
          </p>
        </div>
        <span className="date-chip">
          <CalendarDays size={16} />
          {new Date().toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      {o.stale && (
        <div className="notice warning">
          <RefreshCw size={19} />
          <div>
            <strong>Your data has changed since the last generation.</strong>
            <p>
              The timetable still shows its saved snapshot. Generate again to
              use the latest faculty and workload.
            </p>
          </div>
        </div>
      )}
      <section className="generation-banner">
        <div>
          <div className="eyebrow">The week ahead</div>
          <h2>Every course. All in sync.</h2>
          <p>
            Generate a complete weekly timetable across courses,
            <br className="desktop-break" /> with faculty, rooms and student
            groups kept clash-free.
          </p>
          <div className="banner-meta">
            <span>
              <CheckCircle2 size={15} /> Fixed resources
            </span>
            <span>
              <CalendarDays size={15} /> Monday – Saturday
            </span>
            <span>
              <Clock3 size={15} /> 6 teaching slots / day
            </span>
          </div>
        </div>
        <div className="banner-action">
          <Parity value={parity} onChange={setParity} />
          <button
            className="primary-button"
            onClick={generate}
            disabled={busy || o.latest?.status === "running"}
          >
            <WandSparkles size={18} />
            {busy ? "Generating…" : "Generate timetable"}
            <ArrowRight size={17} />
          </button>
          <small>All active courses · One complete run</small>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>Your courses</h2>
          <p>Three pathways, one shared schedule.</p>
        </div>
        <span className="muted">{d.courses.length} courses</span>
      </div>
      <div className="course-grid">
        {d.courses.map((c, i) => {
          const terms = d.academic_terms.filter((t) => t.course_id === c.id),
            ws = d.subject_workload.filter(
              (w) =>
                terms.some((t) => t.id === w.term_id) &&
                d.subjects.some((s) => s.id === w.subject_id && s.is_active),
            );
          return (
            <Link
              href={href("timetable") + `?course=${c.id}`}
              className="panel course-card"
              key={c.id}
            >
              <div className="course-top">
                <span className={`tile-icon course-${i}`}>
                  <GraduationCap size={24} />
                </span>
                <ArrowUpRight size={19} />
              </div>
              <h3>
                {c.name === "BPHARM"
                  ? "B.Pharm"
                  : c.name === "MPHARM"
                    ? "M.Pharm"
                    : "Pharm.D"}
              </h3>
              <p>
                {c.name === "BPHARM"
                  ? "Bachelor of Pharmacy"
                  : c.name === "MPHARM"
                    ? "Master of Pharmacy"
                    : "Doctor of Pharmacy"}
              </p>
              <div className="course-stats">
                <div>
                  <strong>{terms.length}</strong>
                  <small>
                    {c.term_unit === "year" ? "Years" : "Semesters"}
                  </small>
                </div>
                <div>
                  <strong>{new Set(ws.map((w) => w.subject_id)).size}</strong>
                  <small>Subjects</small>
                </div>
                <div>
                  <strong>{ws.length}</strong>
                  <small>Assignments</small>
                </div>
              </div>
              <div className="course-foot">
                <span>
                  {c.name === "BPHARM"
                    ? `${parity === "odd" ? "Odd" : "Even"} semesters selected`
                    : c.name === "MPHARM"
                      ? "9 specializations / term"
                      : "Annual cohorts"}
                </span>
                <ChevronRight size={15} />
              </div>
            </Link>
          );
        })}
      </div>
      <div className="dashboard-bottom">
        <section className="panel latest-panel">
          <div className="section-heading">
            <h2>Latest generation</h2>
            <Link className="text-link" href={href("generate")}>
              View history <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="latest-body">
            <span className="generation-icon">
              <CalendarDays size={26} />
            </span>
            <div>
              <Status status={o.latest?.status} />
              <h3>{date(o.latest?.started_at)}</h3>
              <p>
                {o.latest
                  ? `${o.latest.active_parity === "odd" ? "Odd" : "Even"} semester cycle · ${o.latest.status === "failed" ? `${o.latest.conflict_report?.length || 0} conflicts to review` : o.latest.status === "success" ? "Saved timetable available" : "Generation in progress"}`
                  : "Your first timetable is one generation away."}
              </p>
            </div>
          </div>
          {o.latestSuccessful && (
            <Link className="secondary-button" href={href("timetable")}>
              Open group timetable <ArrowRight size={16} />
            </Link>
          )}
        </section>
        <section className="panel master-summary">
          <div className="section-heading">
            <h2>Master data</h2>
            <span className="pill small">Read only</span>
          </div>
          {[
            {
              p: "faculty",
              label: "Faculty members",
              n: d.faculty.filter((f) => f.is_active).length,
              icon: Users,
            },
            {
              p: "rooms",
              label: "Rooms & laboratories",
              n: d.rooms.length,
              icon: DoorOpen,
            },
            {
              p: "subjects",
              label: "Subject workloads",
              n: d.subject_workload.filter((w) =>
                d.subjects.some((s) => s.id === w.subject_id && s.is_active),
              ).length,
              icon: BookOpen,
            },
          ].map(({ p, label, n, icon: Icon }) => (
            <Link className="summary-row" href={href(p)} key={p}>
              <Icon size={18} />
              <span>{label}</span>
              <strong>{n}</strong>
              <ChevronRight size={16} />
            </Link>
          ))}
        </section>
      </div>
      <div className="quiet-note">
        <ShieldIcon />
        <span>
          Timetables are saved snapshots. Updating master data takes effect on
          your next generation.
        </span>
      </div>
    </>
  );
}
function ShieldIcon() {
  return <CheckCircle2 size={16} />;
}
function GeneratePage({
  overview: o,
  parity,
  setParity,
  generate,
  busy,
  href,
}: {
  overview: Overview;
  parity: "odd" | "even";
  setParity: (p: "odd" | "even") => void;
  generate: () => void;
  busy: boolean;
  href: (p: string) => string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Whole-college scheduling</div>
          <h1>Generate timetable</h1>
          <p>
            All active courses, shared resources and student groups, planned
            together.
          </p>
        </div>
      </div>
      <section className="panel generate-controls">
        <div>
          <h2>Ready to plan the week?</h2>
          <p className="muted">
            Faculty and room assignments stay fixed. The solver decides when
            each session runs.
          </p>
          <Parity value={parity} onChange={setParity} />
        </div>
        <button
          onClick={generate}
          disabled={busy || o.latest?.status === "running"}
          className="primary-button"
        >
          <WandSparkles size={18} />
          {busy ? "Generating…" : "Generate timetable"}
        </button>
      </section>
      {busy && (
        <div role="status" className="notice">
          <span className="spinner" />
          Checking workload and searching for a complete, clash-free schedule…
        </div>
      )}
      {o.latest && (
        <section className="panel result-panel">
          <div className="section-heading">
            <h2>Latest result</h2>
            <Status status={o.latest.status} />
          </div>
          <p className="muted">
            {date(o.latest.completed_at || o.latest.started_at)}
          </p>
          {o.latest.status === "success" ? (
            <>
              <h3>Your weekly timetable is ready.</h3>
              <p>
                Every requested slot has been placed and checked against the
                hard constraints.
              </p>
              <div className="button-row">
                {[
                  ["timetable", "Group timetable"],
                  ["faculty-view", "Faculty timetable"],
                  ["room-view", "Room occupancy"],
                ].map(([p, label]) => (
                  <Link className="secondary-button" key={p} href={href(p)}>
                    {label}
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
            </>
          ) : o.latest.status === "failed" ? (
            <>
              <h3>The timetable could not be completed.</h3>
              <p>
                Review these issues, update the underlying SQL data, then
                generate again. Previous successful timetables remain available.
              </p>
              <div className="conflict-list">
                {o.latest.conflict_report?.map((c, i) => (
                  <div className="conflict" key={i}>
                    <span className="pill">{c.rule}</span>
                    <div>
                      {c.message}
                      {c.workload_ids?.length ? (
                        <details>
                          <summary>Affected workload IDs</summary>
                          <code>{c.workload_ids.join(", ")}</code>
                        </details>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p>
              A generation is running. This page refreshes automatically. If the
              server was interrupted, retry after five minutes.
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <div className="section-heading table-heading">
          <h2>Generation history</h2>
          <span className="muted">Latest 20 runs</span>
        </div>
        {o.history.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Cycle</th>
                  <th>Status</th>
                  <th>Conflicts</th>
                </tr>
              </thead>
              <tbody>
                {o.history.map((g) => (
                  <tr key={g.id}>
                    <td>{date(g.started_at)}</td>
                    <td>{g.active_parity} semesters</td>
                    <td>
                      <Status status={g.status} />
                    </td>
                    <td>{g.conflict_report?.length || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No generation history yet"
            description="Choose your active BPHARM semesters and click Generate timetable."
          />
        )}
      </section>
    </>
  );
}
