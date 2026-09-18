import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { solve } from "./solver";
import type { Dataset, Generation } from "../src/lib/types";

export function fingerprint(data: Dataset): string {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x)
      ? x
          .map(canonical)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : x;
  return createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const runColumns =
  "id,college_id,active_parity,status,started_at,completed_at,conflict_report,input_fingerprint,adjustments";
const uuid = (value: unknown) => {
  const p = z.string().uuid().safeParse(value);
  if (!p.success) throw new ApiError(400, "A valid UUID is required.");
  return p.data;
};
export function createApp() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret)
    throw new Error(
      "Missing Supabase configuration. Fill .env.local from .env.example.",
    );
  const service = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", async (req, res, next) => {
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new ApiError(401, "Please sign in.");
      const db = createClient(url, key, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const {
        data: { user },
        error,
      } = await db.auth.getUser(token);
      if (error || !user)
        throw new ApiError(401, "Your session expired. Please sign in again.");
      const { data: profile, error: pe } = await db
        .from("admin_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pe)
        throw new ApiError(
          503,
          "Database setup is incomplete or unavailable. Apply the Supabase migrations.",
        );
      if (!profile)
        throw new ApiError(
          403,
          "Your account has no Admin or Dean profile. Ask your administrator to provision access.",
        );
      res.locals.db = db;
      res.locals.profile = profile;
      res.locals.user = user;
      next();
    } catch (e) {
      next(e);
    }
  });
  const db = (res: Response): SupabaseClient => res.locals.db;
  async function college(res: Response, id: unknown) {
    const target = uuid(id);
    if (
      res.locals.profile.college_id &&
      res.locals.profile.college_id !== target
    )
      throw new ApiError(403, "You cannot access this college.");
    const { data, error } = await db(res)
      .from("colleges")
      .select("*")
      .eq("id", target)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "College not found.");
    return target;
  }
  async function entity(res: Response, table: string, id: unknown) {
    const { data, error } = await db(res)
      .from(table)
      .select("*")
      .eq("id", uuid(id))
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError(404, "Record not found or inaccessible.");
    return data;
  }
  async function dataset(res: Response, id: unknown): Promise<Dataset> {
    const target = await college(res, id);
    const { data, error } = await db(res).rpc("college_dataset", { target });
    if (error) throw error;
    return data;
  }
  async function latest(res: Response, id: string, success = false) {
    let q = db(res)
      .from("timetable_generations")
      .select(runColumns)
      .eq("college_id", id)
      .order("started_at", { ascending: false })
      .limit(1);
    if (success) q = q.eq("status", "success");
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data as Generation | null;
  }
  async function allRows(
    res: Response,
    table: string,
    column: string,
    value: string,
  ) {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db(res)
        .from(table)
        .select("*")
        .eq(column, value)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  async function viewer(
    res: Response,
    id: string,
    filter?: { key: string; value: string },
  ) {
    const generation = await latest(res, id, true);
    if (!generation)
      return { generation: null, entries: [], modes: [], snapshot: null };
    const [entries, modes, run] = await Promise.all([
      allRows(res, "timetable_entries", "generation_id", generation.id),
      allRows(res, "generation_term_modes", "generation_id", generation.id),
      entity(res, "timetable_generations", generation.id),
    ]);
    return {
      generation,
      entries: filter
        ? entries.filter((e) => e[filter.key] === filter.value)
        : entries,
      modes,
      snapshot: run.input_snapshot,
    };
  }
  app.get("/api/me", (req, res) =>
    res.json({ email: res.locals.user.email, ...res.locals.profile }),
  );
  app.get("/api/colleges", async (req, res) => {
    const { data, error } = await db(res)
      .from("colleges")
      .select("*")
      .order("code");
    if (error) throw error;
    res.json(data);
  });
  app.get("/api/colleges/:collegeId/courses", async (req, res) => {
    const d = await dataset(res, req.params.collegeId);
    res.json(d.courses);
  });
  app.get("/api/courses/:courseId/terms", async (req, res) => {
    const c = await entity(res, "courses", req.params.courseId);
    const d = await dataset(res, c.college_id);
    res.json(d.academic_terms.filter((t) => t.course_id === c.id));
  });
  app.get("/api/terms/:termId/groups", async (req, res) => {
    const t = await entity(res, "academic_terms", req.params.termId);
    const { data, error } = await db(res)
      .from("groups")
      .select("*")
      .eq("term_id", t.id);
    if (error) throw error;
    res.json(data);
  });
  app.get("/api/overview", async (req, res) => {
    const d = await dataset(res, req.query.college_id),
      id = d.colleges[0].id;
    const [last, lastSuccess, history] = await Promise.all([
      latest(res, id),
      latest(res, id, true),
      db(res)
        .from("timetable_generations")
        .select(runColumns)
        .eq("college_id", id)
        .order("started_at", { ascending: false })
        .limit(20),
    ]);
    if (history.error) throw history.error;
    res.json({
      dataset: d,
      latest: last,
      latestSuccessful: lastSuccess,
      history: history.data,
      stale: !!lastSuccess && fingerprint(d) !== lastSuccess.input_fingerprint,
    });
  });
  app.get("/api/faculty", async (req, res) => {
    const d = await dataset(res, req.query.college_id);
    const terms = d.academic_terms
      .filter(
        (t) =>
          (!req.query.course_id || t.course_id === req.query.course_id) &&
          (!req.query.term_id || t.id === req.query.term_id),
      )
      .map((t) => t.id);
    res.json(
      d.faculty
        .filter(
          (f) =>
            f.is_active &&
            `${f.name} ${f.initials}`
              .toLowerCase()
              .includes(String(req.query.q || "").toLowerCase()) &&
            ((!req.query.course_id && !req.query.term_id) ||
              d.subject_workload.some(
                (w) => w.faculty_id === f.id && terms.includes(w.term_id),
              )),
        )
        .map((f) => ({
          ...f,
          assigned_workload: d.subject_workload
            .filter(
              (w) =>
                w.faculty_id === f.id &&
                d.subjects.some((s) => s.id === w.subject_id && s.is_active),
            )
            .reduce((n, w) => n + w.slots_per_week, 0),
        })),
    );
  });
  app.get("/api/rooms", async (req, res) => {
    const d = await dataset(res, req.query.college_id);
    const terms = d.academic_terms
      .filter(
        (t) => !req.query.course_id || t.course_id === req.query.course_id,
      )
      .map((t) => t.id);
    res.json(
      d.rooms.filter(
        (r) =>
          (!req.query.type || r.room_type === req.query.type) &&
          r.room_no
            .toLowerCase()
            .includes(String(req.query.q || "").toLowerCase()) &&
          (!req.query.course_id ||
            d.subject_workload.some(
              (w) => w.room_id === r.id && terms.includes(w.term_id),
            )),
      ),
    );
  });
  app.get("/api/subjects", async (req, res) => {
    let collegeId = req.query.college_id;
    if (!collegeId && req.query.course_id)
      collegeId = (await entity(res, "courses", req.query.course_id))
        .college_id;
    if (!collegeId && req.query.term_id) {
      const t = await entity(res, "academic_terms", req.query.term_id);
      collegeId = (await entity(res, "courses", t.course_id)).college_id;
    }
    const d = await dataset(res, collegeId);
    res.json(
      d.subject_workload
        .filter((w) => {
          const s = d.subjects.find((s) => s.id === w.subject_id)!;
          return (
            s.is_active &&
            (!req.query.course_id ||
              d.academic_terms.some(
                (t) =>
                  t.id === w.term_id && t.course_id === req.query.course_id,
              )) &&
            (!req.query.term_id || w.term_id === req.query.term_id) &&
            (!req.query.group_id || w.group_id === req.query.group_id) &&
            (!req.query.session_type ||
              s.session_type === req.query.session_type) &&
            `${s.code} ${s.name}`
              .toLowerCase()
              .includes(String(req.query.q || "").toLowerCase())
          );
        })
        .map((w) => ({
          ...w,
          subject: d.subjects.find((s) => s.id === w.subject_id),
          faculty: d.faculty.find((f) => f.id === w.faculty_id),
          room: d.rooms.find((r) => r.id === w.room_id),
        })),
    );
  });
  app.get("/api/generations/latest", async (req, res) =>
    res.json(await latest(res, await college(res, req.query.college_id))),
  );
  app.get("/api/generations/:id", async (req, res) =>
    res.json(await entity(res, "timetable_generations", req.params.id)),
  );
  app.post("/api/generate", async (req, res) => {
    const body = z
      .object({
        college_id: z.string().uuid(),
        active_parity: z.enum(["odd", "even"]),
      })
      .strict()
      .safeParse(req.body);
    if (!body.success)
      throw new ApiError(
        400,
        "Provide college_id and active_parity (odd or even).",
      );
    const d = await dataset(res, body.data.college_id);
    // Recover abandoned runs only after far more than the bounded solver runtime.
    const recovery = await service
      .from("timetable_generations")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        conflict_report: [
          {
            rule: "INTERRUPTED",
            message:
              "The server stopped before this run completed. Generate again.",
          },
        ],
      })
      .eq("college_id", body.data.college_id)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
    if (recovery.error) throw recovery.error;
    const { data: run, error } = await service
      .from("timetable_generations")
      .insert({
        ...body.data,
        status: "running",
        requested_by: res.locals.user.id,
        input_snapshot: d,
        input_fingerprint: fingerprint(d),
      })
      .select(runColumns)
      .single();
    if (error) {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "A generation is already running for this college.",
        );
      throw error;
    }
    try {
      const result = solve(d, body.data.active_parity);
      const { error: saveError } = await service.rpc("finish_generation", {
        run_id: run.id,
        result,
      });
      if (saveError) throw saveError;
      res.json({
        ...run,
        status: result.status,
        completed_at: new Date().toISOString(),
        conflict_report: result.conflicts,
        adjustments: result.adjustments,
        attempts: result.attempts,
      });
    } catch (e) {
      await service
        .from("timetable_generations")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          conflict_report: [
            {
              rule: "SERVER",
              message: "Generation could not be saved. Please retry.",
            },
          ],
        })
        .eq("id", run.id)
        .eq("status", "running");
      throw e;
    }
  });
  app.get("/api/timetable", async (req, res) => {
    let collegeId = req.query.college_id;
    if (!collegeId && req.query.term_id) {
      const t = await entity(res, "academic_terms", req.query.term_id);
      collegeId = (await entity(res, "courses", t.course_id)).college_id;
    }
    const id = await college(res, collegeId),
      result = await viewer(res, id);
    if (req.query.term_id)
      result.entries = result.entries.filter(
        (e) => e.term_id === req.query.term_id,
      );
    if (req.query.group_id)
      result.entries = result.entries.filter(
        (e) => !e.group_id || e.group_id === req.query.group_id,
      );
    res.json(result);
  });
  app.get("/api/faculty/:id/timetable", async (req, res) => {
    const f = await entity(res, "faculty", req.params.id);
    res.json(
      await viewer(res, f.college_id, { key: "faculty_id", value: f.id }),
    );
  });
  app.get("/api/rooms/:id/timetable", async (req, res) => {
    const r = await entity(res, "rooms", req.params.id);
    res.json(await viewer(res, r.college_id, { key: "room_id", value: r.id }));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = error as { status?: number; message?: string; code?: string };
      if (!(error instanceof ApiError))
        console.error("API error:", e.code || "internal", e.message);
      res
        .status(error instanceof ApiError ? error.status : 500)
        .json({
          error:
            error instanceof ApiError
              ? error.message
              : "The request failed. Check the database setup and server logs.",
        });
    },
  );
  return app;
}
