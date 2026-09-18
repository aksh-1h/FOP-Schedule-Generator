import { createClient } from "@supabase/supabase-js";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
for (const table of [
  "colleges",
  "courses",
  "faculty",
  "subjects",
  "rooms",
  "subject_workload",
]) {
  const { count, error, status, data } = await db
    .from(table)
    .select("id", { count: "exact" })
    .limit(1);
  console.log(table, {
    status,
    count,
    error: error ? { code: error.code, message: error.message } : null,
    rows: data?.length,
  });
}
