import fs from "node:fs";
import postgres from "postgres";
if (!process.env.DATABASE_URL) {
  console.error(
    "Set DATABASE_URL in .env.local, or run the SQL files in the Supabase SQL editor. API keys cannot apply schema migrations.",
  );
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
try {
  await sql`create table if not exists public.fop_migrations(name text primary key,applied_at timestamptz default now())`;
  const files = process.argv.includes("--demo")
    ? ["supabase/demo.sql"]
    : process.argv.includes("--seed")
      ? ["supabase/seed.sql"]
      : fs
          .readdirSync("supabase/migrations")
          .sort()
          .map((f) => "supabase/migrations/" + f);
  for (const file of files) {
    if (
      (await sql`select name from public.fop_migrations where name=${file}`)
        .length
    ) {
      console.log("Already applied:", file);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      await tx`insert into public.fop_migrations(name) values(${file})`;
    });
    console.log("Applied:", file);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
