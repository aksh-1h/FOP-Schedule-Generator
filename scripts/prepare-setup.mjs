import fs from "node:fs";
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const files = fs
  .readdirSync("supabase/migrations")
  .sort()
  .map((f) => "supabase/migrations/" + f)
  .concat("supabase/seed.sql");
let sql =
  "-- FRESH DATABASE setup. Run once in Supabase SQL editor. Contains no credentials or personal source data.\nbegin;\ncreate table if not exists public.fop_migrations(name text primary key,applied_at timestamptz default now());\n";
for (const file of files)
  sql += `\n-- ${file}\n${fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")}\ninsert into public.fop_migrations(name) values(${quote(file)});\n`;
sql += "notify pgrst, 'reload schema';\ncommit;\n";
fs.writeFileSync("supabase/setup.sql", sql);
if (fs.existsSync("data/import-review/normalized-staging.json")) {
  const normalized = JSON.parse(
    fs.readFileSync("data/import-review/normalized-staging.json", "utf8"),
  );
  const sources = JSON.parse(
    fs.readFileSync("data/import-review/source-extraction.json", "utf8"),
  );
  const { createHash } = await import("node:crypto");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ input: normalized, sources }))
    .digest("hex");
  const statement = `-- Reviewed catalog and lossless source staging. No faculty/workload assignments are invented.\nbegin;\nselect import_reviewed_catalog((select id from colleges where code='PIP'),${quote(JSON.stringify(normalized))}::jsonb,${quote(JSON.stringify(sources))}::jsonb,${quote(fingerprint)});\ncommit;\n`;
  fs.writeFileSync("data/import-review/import.sql", statement);
}
console.log(
  "Prepared supabase/setup.sql and, when source analysis exists, data/import-review/import.sql.",
);
