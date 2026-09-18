import fs from "node:fs";
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.private = true;
p.type = "module";
p.description = "Faculty of Pharmacy timetable generator";
p.scripts = {
  dev: 'concurrently -k -n web,api "next dev" "tsx watch --env-file=.env.local server/index.ts"',
  build:
    "next build && esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js",
  start:
    'concurrently -k -n web,api "next start" "node --env-file=.env.local dist/server.js"',
  test: "vitest run",
  typecheck: "tsc --noEmit",
  "db:migrate": "node --env-file=.env.local scripts/migrate.mjs",
  "db:seed": "node --env-file=.env.local scripts/migrate.mjs --seed",
  "db:demo": "node --env-file=.env.local scripts/migrate.mjs --demo",
  "test:db": "tsx tests/database-check.ts",
  "test:e2e": "playwright test",
};
fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
