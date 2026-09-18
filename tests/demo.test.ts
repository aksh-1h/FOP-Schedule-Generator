import { it, expect } from "vitest";
import express from "express";
import { once } from "node:events";
import { demoRouter } from "../server/demo";
async function withServer(
  enabled: boolean,
  run: (base: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use("/api", demoRouter(enabled));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${addr.port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}
it("demo credentials create an isolated session that can generate and sign out", async () => {
  await withServer(true, async (base) => {
    const login = async (password = "FopDemo!2026") =>
      fetch(base + "/demo/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "demo@fop.local", password }),
      });
    expect((await login("wrong")).status).toBe(401);
    const { token } = await (await login()).json();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const overview = await (
      await fetch(base + "/overview?college_id=college", { headers })
    ).json();
    expect(overview.dataset.colleges[0].code).toBe("DEMO");
    expect(overview.latest).toBe(null);
    const generated = await (
      await fetch(base + "/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ college_id: "college", active_parity: "even" }),
      })
    ).json();
    expect(generated.status).toBe("success");
    const grid = await (await fetch(base + "/timetable", { headers })).json();
    expect(grid.entries.length).toBeGreaterThan(0);
    const second = await (await login()).json();
    const other = await (
      await fetch(base + "/overview", {
        headers: { Authorization: `Bearer ${second.token}` },
      })
    ).json();
    expect(other.latest).toBe(null);
    expect(
      (await fetch(base + "/demo/logout", { method: "POST", headers })).status,
    ).toBe(200);
    expect((await fetch(base + "/overview", { headers })).status).toBe(401);
  });
});
it("disabled demo rejects both login and forged demo tokens", async () => {
  await withServer(false, async (base) => {
    expect((await (await fetch(base + "/demo/config")).json()).enabled).toBe(
      false,
    );
    expect(
      (
        await fetch(base + "/demo/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "demo@fop.local",
            password: "FopDemo!2026",
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(base + "/overview", {
          headers: { Authorization: "Bearer demo_forged" },
        })
      ).status,
    ).toBe(401);
  });
});
