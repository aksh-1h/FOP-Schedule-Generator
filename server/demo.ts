import { Router } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { fixture, add } from "./demo-data";
import { solve } from "./solver";
import type { Generation, SolveResult } from "../src/lib/types";

export function demoRouter(enabled: boolean) {
  const router = Router();
  const email = "demo@fop.local";
  const password = process.env.DEMO_PASSWORD || "FopDemo!2026";
  const sessions = new Map<
    string,
    {
      expires: number;
      history: Generation[];
      results: Map<string, SolveResult>;
    }
  >();
  const data = fixture();
  data.colleges[0].name = "Demo College of Pharmacy (sample data)";
  data.colleges[0].code = "DEMO";
  for (const term of data.academic_terms) {
    if (term.course_id === "MPHARM" && term.term_number !== 2) {
      term.is_active = false;
      continue;
    }
    for (const group of data.groups.filter((g) => g.term_id === term.id)) {
      group.name =
        term.course_id === "BPHARM"
          ? `Division ${group.id.endsWith("g0") ? "A" : "B"}`
          : term.course_id === "MPHARM"
            ? `Sample specialization ${Number(group.id.split("g").at(-1)) + 1}`
            : `Year ${term.term_number}`;
      add(data, `${group.id}-theory`, "theory", 3, term.id, "group", {
        group_id: group.id,
      });
      if (term.course_id === "BPHARM")
        for (const batch of data.batches.filter((b) => b.group_id === group.id))
          add(data, `${batch.id}-lab`, "lab", 3, term.id, "batch", {
            group_id: group.id,
            batch_id: batch.id,
          });
      else
        add(data, `${group.id}-lab`, "lab", 3, term.id, "group", {
          group_id: group.id,
        });
    }
  }
  data.subjects.forEach((s, i) => {
    s.name =
      s.session_type === "lab"
        ? "Sample pharmaceutical laboratory"
        : "Sample pharmaceutical science";
    s.code = `DEMO-${i + 1}`;
  });
  data.faculty.forEach((f, i) => {
    f.name = `Sample faculty ${i + 1}`;
    f.initials = `F${i + 1}`;
  });
  data.rooms.forEach((r, i) => {
    r.room_no = `D-${101 + i}`;
  });
  router.get("/demo/config", (_req, res) =>
    res.json({ enabled, email: enabled ? email : null }),
  );
  router.post("/demo/login", (req, res) => {
    if (!enabled) {
      res.status(404).json({ error: "Demo access is disabled." });
      return;
    }
    if (req.body?.email !== email || req.body?.password !== password) {
      res.status(401).json({ error: "Incorrect demo email or password." });
      return;
    }
    for (const [key, s] of sessions)
      if (s.expires < Date.now()) sessions.delete(key);
    if (sessions.size >= 100) {
      res.status(429).json({ error: "Demo session limit reached. Try later." });
      return;
    }
    const token = `demo_${randomBytes(32).toString("hex")}`;
    sessions.set(token, {
      expires: Date.now() + 8 * 60 * 60 * 1000,
      history: [],
      results: new Map(),
    });
    res.json({ token, email });
  });
  router.use((req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token?.startsWith("demo_")) {
      next();
      return;
    }
    const session = sessions.get(token);
    if (!enabled || !session || session.expires < Date.now()) {
      res
        .status(401)
        .json({ error: "Your demo session expired. Sign in again." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.path === "/demo/logout" && req.method === "POST") {
      sessions.delete(token);
      res.json({ ok: true });
      return;
    }
    const latest = session.history[0] || null;
    const successful =
      session.history.find((g) => g.status === "success") || null;
    if (req.path === "/me") {
      res.json({ email, college_id: "college", demo: true });
      return;
    }
    if (req.path === "/colleges") {
      res.json(data.colleges);
      return;
    }
    if (req.path === "/overview") {
      res.json({
        dataset: data,
        latest,
        latestSuccessful: successful,
        history: session.history,
        stale: false,
      });
      return;
    }
    if (req.path === "/generate" && req.method === "POST") {
      if (
        req.body?.college_id !== "college" ||
        !["odd", "even"].includes(req.body?.active_parity)
      ) {
        res
          .status(400)
          .json({ error: "Choose the demo college and a valid parity." });
        return;
      }
      const started_at = new Date().toISOString();
      const result = solve(data, req.body.active_parity);
      const run: Generation = {
        id: randomUUID(),
        college_id: "college",
        active_parity: req.body.active_parity,
        status: result.status,
        started_at,
        completed_at: new Date().toISOString(),
        conflict_report: result.conflicts,
        adjustments: result.adjustments,
        input_fingerprint: "demo",
        input_snapshot: structuredClone(data),
      };
      session.history.unshift(run);
      session.results.set(run.id, result);
      if (session.history.length > 20) {
        const removed = session.history.pop()!;
        session.results.delete(removed.id);
      }
      res.json(run);
      return;
    }
    if (req.path === "/timetable") {
      const result = successful ? session.results.get(successful.id) : null;
      res.json({
        generation: successful,
        entries: result?.entries || [],
        modes: result?.modes || [],
        snapshot: successful?.input_snapshot || null,
      });
      return;
    }
    res
      .status(404)
      .json({ error: "This endpoint is not available in the isolated demo." });
  });
  return router;
}
