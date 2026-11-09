import "./env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminClient } from "../lib/supabase-admin";
import { parseCsv } from "./csv";

// Loads data/companies.csv into the companies table.
// Safe to run again: existing companies keep their ATS settings.
async function main() {
  const db = adminClient();
  const file = join(process.cwd(), "data", "companies.csv");
  const rows = parseCsv(readFileSync(file, "utf8"));

  const payload = rows
    .filter((r) => r.name && r.slug && r.careers_url && r.segment)
    .map((r) => ({
      name: r.name,
      slug: r.slug,
      careers_url: r.careers_url,
      segment: r.segment,
    }));

  const { error } = await db.from("companies").upsert(payload, { onConflict: "slug" });
  if (error) throw error;

  console.log(`Seeded ${payload.length} companies.`);
  console.log("Next: npm run detect   (finds which hiring platform each company uses)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
