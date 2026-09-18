import { test, expect } from "@playwright/test";
import { fixture, add } from "../fixtures";
import { solve } from "../../server/solver";
const d = fixture();
add(d, "PT", "theory", 3);
add(d, "PH", "lab", 3, "BPHARM-1", "batch");
add(d, "EL", "elective", 3, "BPHARM-7", "pooled");
add(d, "EL2", "elective", 3, "BPHARM-7", "pooled");
const solved = solve(d, "odd");
const generation = {
  id: "run",
  college_id: "college",
  active_parity: "odd",
  status: "success",
  started_at: "2026-09-18T09:00:00Z",
  completed_at: "2026-09-18T09:00:01Z",
  conflict_report: [],
  adjustments: solved.adjustments,
  input_fingerprint: "hash",
};
async function signedIn(page: import("@playwright/test").Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sb-ljxnneomrukyvtulskoh-auth-token",
      JSON.stringify({
        access_token: btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:'00000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'}))+'.testsignature',
        refresh_token: "test-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id: "test-user",
          email: "admin@example.test",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    ),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/colleges"
        ? d.colleges
        : path === "/api/me"
          ? { college_id: null, email: "admin@example.test" }
          : path === "/api/overview"
            ? {
                dataset: d,
                latest: generation,
                latestSuccessful: generation,
                history: [generation],
                stale: true,
              }
            : path === "/api/timetable"
              ? {
                  generation,
                  entries: solved.entries,
                  modes: solved.modes,
                  snapshot: d,
                }
              : path === "/api/generate"
                ? generation
                : null;
    await route.fulfill({ json: data });
  });
}
test("login has accessible fields and keeps mobile content within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/login-mobile.png",
    fullPage: true,
  });
});
test("dashboard, master filters, generation, timetable and comboboxes", async ({
  page,
}) => {
  await signedIn(page);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/college/college");
  await expect(
    page.getByRole("heading", { name: "A well-planned week starts here." }),
  ).toBeVisible();
  await expect(
    page.getByText("Your data has changed since the last generation."),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Faculty", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search faculty" })
    .fill("Faculty PT");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Group timetable", exact: true })
    .click();
  await expect(page.getByText("Lunch break")).toBeVisible();
  await expect(page.locator(".timetable tbody tr")).toHaveCount(7);
  await expect(page.getByText("Labs: morning")).toBeVisible();
  await page.screenshot({ path: "test-results/timetable.png", fullPage: true });
  await page
    .getByRole("link", { name: "Faculty timetable", exact: true })
    .click();
  const combo = page.getByRole("combobox",{name:'Faculty',exact:true});
  await combo.fill("Faculty PH");
  await page.getByRole("option", { name: "Faculty PH (PH)" }).click();
  await expect(
    page.locator(".timetable").getByText("Subject PH").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Room occupancy", exact: true }).click();
  await page.getByRole("combobox",{name:'Room',exact:true}).fill("PH");
  await page.getByRole("option", { name: "PH · lab" }).click();
  await expect(
    page.locator(".timetable").getByText("Subject PH").first(),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Generate timetable", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate timetable", exact: true })
    .click();
  await expect(page.getByText("Your weekly timetable is ready.")).toBeVisible();
});
test("mobile workspace navigation is usable", async ({ page }) => {
  await signedIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/college/college");
  await expect(
    page.getByRole("heading", { name: "A well-planned week starts here." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("link", { name: "Subjects & workload", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Subjects & workload" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/master-mobile.png",
    fullPage: true,
  });
});
test("API rejects unauthenticated generation", async ({ request }) => {
  const r = await request.post("/api/generate", {
    data: { college_id: "college", active_parity: "odd" },
  });
  expect(r.status()).toBe(401);
});
