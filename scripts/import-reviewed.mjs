import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const input = JSON.parse(
  fs.readFileSync("data/import-review/normalized-staging.json", "utf8"),
);
const sources = JSON.parse(
  fs.readFileSync("data/import-review/source-extraction.json", "utf8"),
);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
const { data: college, error } = await db
  .from("colleges")
  .select("id")
  .eq("code", "PIP")
  .single();
if (error)
  throw new Error(
    "PIP is not available. Apply migrations and structural seed first. " +
      error.message,
  );
const input_hash = createHash("sha256")
  .update(JSON.stringify({ input, sources }))
  .digest("hex");
const { data, error: importError } = await db.rpc("import_reviewed_catalog", {
  target: college.id,
  input,
  raw_sources: sources,
  input_hash,
});
if (importError) throw new Error(importError.message);
console.log(JSON.stringify(data, null, 2));
const { count, error: verifyError } = await db
  .from("source_import_records")
  .select("id", { count: "exact", head: true })
  .eq("import_id", data.id);
if (verifyError) throw new Error(verifyError.message);
const expected =
  input.catalog.length +
  input.faculty.length +
  input.assignments.length +
  input.issues.length +
  sources.length;
if (count !== expected)
  throw new Error(
    `Import row-count verification failed: expected ${expected}, received ${count}`,
  );
console.log(
  `Verified ${count} staged records. Disputed assignments remain staged; no fabricated workload rows were inserted.`,
);
