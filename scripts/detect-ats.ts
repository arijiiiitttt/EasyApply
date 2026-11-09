import "./env";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { adapters, detectFromText } from "../lib/ats";
import { greenhouseBoardName } from "../lib/ats/greenhouse";
import { HttpError, getText } from "../lib/http";
import type { AtsType, CompanyRow } from "../lib/types";
import { adminClient } from "../lib/supabase-admin";

/**
 * Works out which hiring platform each company uses.
 *
 *   1. Look for a Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Workday
 *      link in the careers URL, then inside the careers page HTML.
 *   2. Otherwise probe each platform with guessed board names. A guess is only saved
 *      automatically when Greenhouse reports a board name matching the company.
 *      All other guesses are written to data/ats-guesses.json for you to review.
 *
 * Flags:
 *   --force            re-check companies that already have an ATS
 *   --no-guess         skip step 2
 *   --accept-guesses   save every guess that returned jobs (review the report first)
 */

const FORCE = process.argv.includes("--force");
const NO_GUESS = process.argv.includes("--no-guess");
const ACCEPT_GUESSES = process.argv.includes("--accept-guesses");
const GUESS_ORDER: AtsType[] = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Found {
  ats: AtsType;
  token: string;
  jobs: number;
}

async function verify(ats: AtsType, token: string): Promise<number | null> {
  try {
    const jobs = await adapters[ats].fetchJobs(token);
    return jobs.length;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
    return null;
  }
}

async function detectLinked(c: CompanyRow): Promise<Found | null> {
  let hit = detectFromText(c.careers_url);
  if (!hit) {
    try {
      hit = detectFromText(await getText(c.careers_url));
    } catch {
      hit = null;
    }
  }
  if (!hit) return null;
  const jobs = await verify(hit.ats, hit.token);
  return jobs === null ? null : { ...hit, jobs };
}

async function detectGuess(c: CompanyRow): Promise<{ found: Found; trusted: boolean } | null> {
  const firstWord = c.name.split(/[\s(]/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = [...new Set([c.slug, c.slug.replace(/-/g, ""), firstWord])].filter(
    (t) => t.length >= 3,
  );

  for (const ats of GUESS_ORDER) {
    for (const token of tokens) {
      await sleep(150);
      const jobs = await verify(ats, token);
      if (jobs === null || jobs === 0) continue;

      let trusted = false;
      if (ats === "greenhouse") {
        const boardName = await greenhouseBoardName(token);
        if (boardName) {
          const a = norm(boardName);
          const b = norm(c.name);
          trusted = a.startsWith(b) || b.startsWith(a);
        }
      }
      return { found: { ats, token, jobs }, trusted };
    }
  }
  return null;
}

async function main() {
  const db = adminClient();
  let query = db.from("companies").select("*").eq("active", true).order("name");
  if (!FORCE) query = query.is("ats", null);
  const { data, error } = await query;
  if (error) throw error;
  const companies = (data ?? []) as CompanyRow[];
  console.log(`Checking ${companies.length} companies...`);

  const saved: string[] = [];
  const guesses: Record<string, Found> = {};
  const unmatched: string[] = [];

  for (const c of companies) {
    let result: Found | null = await detectLinked(c);
    let how = "link";

    if (!result && !NO_GUESS) {
      const guess = await detectGuess(c);
      if (guess) {
        if (guess.trusted || ACCEPT_GUESSES) {
          result = guess.found;
          how = guess.trusted ? "verified guess" : "accepted guess";
        } else {
          guesses[c.slug] = guess.found;
        }
      }
    }

    if (result) {
      const { error: updateError } = await db
        .from("companies")
        .update({ ats: result.ats, ats_token: result.token, last_error: null })
        .eq("id", c.id);
      if (updateError) throw updateError;
      saved.push(c.name);
      console.log(`  ok    ${c.name}: ${result.ats} / ${result.token} (${result.jobs} jobs, ${how})`);
    } else if (guesses[c.slug]) {
      const g = guesses[c.slug];
      console.log(`  guess ${c.name}: ${g.ats} / ${g.token} (${g.jobs} jobs) needs review`);
    } else {
      unmatched.push(c.name);
      console.log(`  none  ${c.name}`);
    }
  }

  const reportPath = join(process.cwd(), "data", "ats-guesses.json");
  writeFileSync(reportPath, JSON.stringify({ guesses, unmatched }, null, 2));

  console.log(`\nSaved ${saved.length}, ${Object.keys(guesses).length} guesses to review, ${unmatched.length} not found.`);
  console.log(`Report: ${reportPath}`);
  console.log("Unmatched companies have custom career sites. See README, 'Adding a company or platform'.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
