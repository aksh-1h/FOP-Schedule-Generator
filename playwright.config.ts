import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3100", channel: "msedge", headless: true },
  reporter: "list",
  webServer: [
    {
      env: { DEMO_MODE: "true", DEMO_PASSWORD: "FopDemo!2026" },
      command: "node --env-file=.env.local dist/server.js",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "npx next start -p 3100",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
