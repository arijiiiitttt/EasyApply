import "./env";
import { adapters } from "../lib/ats";
import { isIndia } from "../lib/india";
import { matchesAlert } from "../lib/matcher";
import {
  buildEmail,
  buildTelegramMessages,
  buildWhatsAppTemplateParams,
  buildWhatsAppText,
  emailConfigured,
  sendEmail,
  sendTelegram,
  sendWhatsApp,
  telegramConfigured,
  whatsappConfigured,
} from "../lib/notify";
import { adminClient } from "../lib/supabase-admin";
import type { AlertRow, CompanyRow, JobWithCompany, ProfileRow } from "../lib/types";

/**
 * One run does two things:
 *   1. For every company with a known hiring platform, fetch its jobs and store new ones.
 *   2. Match recent jobs against everyone's alerts and send the ones not yet sent.
 *
 * The first time a company is fetched, its existing jobs are stored as a baseline
 * and do not trigger alerts. Only jobs that appear afterwards do.
 */

const db = adminClient();
const CONCURRENCY = Math.max(1, Number(process.env.FETCH_CONCURRENCY ?? 5));
const INGEST_ALL = process.env.INGEST_ALL === "true";
const NOTIFY_WINDOW_HOURS = 48;
const MAX_JOBS_PER_MESSAGE = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Reads every row of a query, 1000 at a time. */
async function selectAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}

// ---------------------------------------------------------------
// Step 1: fetch and store jobs
// ---------------------------------------------------------------

interface ExistingJob {
  id: string;
  external_id: string;
  active: boolean;
}

async function processCompany(c: CompanyRow): Promise<number> {
  try {
    const fetched = await adapters[c.ats!].fetchJobs(c.ats_token!);
    const wanted = fetched.filter(
      (j) => j.applyUrl && j.title && (INGEST_ALL || isIndia(j.location)),
    );
    const byId = new Map(wanted.map((j) => [j.externalId, j]));

    const existing = await selectAll<ExistingJob>((from, to) =>
      db
        .from("jobs")
        .select("id,external_id,active")
        .eq("company_id", c.id)
        .range(from, to),
    );
    const existingByExternal = new Map(existing.map((e) => [e.external_id, e]));
    const baseline = !c.baseline_done;

    const toInsert = [...byId.values()]
      .filter((j) => !existingByExternal.has(j.externalId))
      .map((j) => ({
        company_id: c.id,
        external_id: j.externalId,
        title: j.title.slice(0, 300),
        location: j.location.slice(0, 300),
        department: j.department,
        is_remote: j.isRemote,
        apply_url: j.applyUrl,
        posted_at: j.postedAt,
        is_baseline: baseline,
      }));

    for (const batch of chunk(toInsert, 500)) {
      const { error } = await db.from("jobs").insert(batch);
      if (error) throw new Error(`insert: ${error.message}`);
    }

    const reactivate = existing
      .filter((e) => !e.active && byId.has(e.external_id))
      .map((e) => e.id);
    for (const ids of chunk(reactivate, 100)) {
      const { error } = await db.from("jobs").update({ active: true }).in("id", ids);
      if (error) throw new Error(`reactivate: ${error.message}`);
    }

    // An empty feed for a company we already have jobs for is more likely a
    // glitch than every job closing at once, so skip closing jobs in that case.
    const feedLooksBroken = fetched.length === 0 && existing.some((e) => e.active);
    if (!feedLooksBroken) {
      const deactivate = existing
        .filter((e) => e.active && !byId.has(e.external_id))
        .map((e) => e.id);
      for (const ids of chunk(deactivate, 100)) {
        const { error } = await db.from("jobs").update({ active: false }).in("id", ids);
        if (error) throw new Error(`deactivate: ${error.message}`);
      }
    }

    const { error: companyError } = await db
      .from("companies")
      .update({
        baseline_done: true,
        last_fetched_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", c.id);
    if (companyError) throw new Error(`company update: ${companyError.message}`);

    console.log(
      `  ok    ${c.name}: ${wanted.length} jobs, ${toInsert.length} new${baseline ? " (baseline)" : ""}`,
    );
    return 1;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  fail  ${c.name}: ${message}`);
    await db
      .from("companies")
      .update({
        last_fetched_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
      })
      .eq("id", c.id);
    return 0;
  }
}

// ---------------------------------------------------------------
// Step 2: match alerts and notify
// ---------------------------------------------------------------

async function sendAlerts(): Promise<{ emails: number; telegrams: number; whatsapps: number }> {
  const sent = { emails: 0, telegrams: 0, whatsapps: 0 };

  const since = new Date(Date.now() - NOTIFY_WINDOW_HOURS * 3600 * 1000).toISOString();
  const candidates = await selectAll<JobWithCompany>((from, to) =>
    db
      .from("jobs")
      .select("*, companies!inner(name,slug,segment)")
      .eq("active", true)
      .eq("is_baseline", false)
      .gte("first_seen_at", since)
      .order("first_seen_at", { ascending: false })
      .range(from, to),
  );
  if (candidates.length === 0) return sent;

  const { data: alertData, error: alertError } = await db
    .from("alerts")
    .select("*")
    .eq("active", true);
  if (alertError) throw new Error(alertError.message);
  const alerts = (alertData ?? []) as AlertRow[];
  if (alerts.length === 0) return sent;

  const userIds = [...new Set(alerts.map((a) => a.user_id))];
  const profiles = new Map<string, ProfileRow>();
  for (const ids of chunk(userIds, 100)) {
    const { data, error } = await db
      .from("profiles")
      .select("id,email,telegram_chat_id,whatsapp_number")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as ProfileRow[]) profiles.set(p.id, p);
  }

  for (const alert of alerts) {
    const profile = profiles.get(alert.user_id);
    if (!profile) continue;
    const matches = candidates.filter((job) => matchesAlert(alert, job));
    if (matches.length === 0) continue;

    for (const channel of alert.channels) {
      const canEmail = channel === "email" && profile.email && emailConfigured();
      const canTelegram =
        channel === "telegram" && profile.telegram_chat_id && telegramConfigured();
      const canWhatsApp =
        channel === "whatsapp" && profile.whatsapp_number && whatsappConfigured();
      if (!canEmail && !canTelegram && !canWhatsApp) continue;

      const alreadySent = new Set<string>();
      for (const ids of chunk(matches.map((m) => m.id), 100)) {
        const { data, error } = await db
          .from("notifications")
          .select("job_id")
          .eq("alert_id", alert.id)
          .eq("channel", channel)
          .in("job_id", ids);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) alreadySent.add(row.job_id as string);
      }

      const fresh = matches.filter((m) => !alreadySent.has(m.id));
      if (fresh.length === 0) continue;
      const batch = fresh.slice(0, MAX_JOBS_PER_MESSAGE);
      const extra = fresh.length - batch.length;

      try {
        if (canEmail) {
          const mail = buildEmail(alert.name, alert.keywords, batch, extra);
          await sendEmail(profile.email!, mail.subject, mail.html);
          sent.emails++;
        } else if (canTelegram) {
          const messages = buildTelegramMessages(alert.name, alert.keywords, batch, extra);
          for (const text of messages) await sendTelegram(profile.telegram_chat_id!, text);
          sent.telegrams++;
        } else {
          await sendWhatsApp(
            profile.whatsapp_number!,
            buildWhatsAppText(alert.name, alert.keywords, batch, extra),
            buildWhatsAppTemplateParams(alert.name, alert.keywords, batch, extra),
          );
          sent.whatsapps++;
        }

        const { error } = await db.from("notifications").upsert(
          batch.map((job) => ({
            alert_id: alert.id,
            user_id: alert.user_id,
            job_id: job.id,
            channel,
          })),
          { onConflict: "alert_id,job_id,channel", ignoreDuplicates: true },
        );
        if (error) console.log(`  could not log notifications: ${error.message}`);
      } catch (err) {
        // Not logged as sent, so the next run tries again.
        console.log(
          `  alert ${alert.id} (${channel}) failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
  return sent;
}

// ---------------------------------------------------------------

async function main() {
  const { data, error } = await db
    .from("companies")
    .select("*")
    .eq("active", true)
    .not("ats", "is", null)
    .not("ats_token", "is", null);
  if (error) throw new Error(error.message);
  const companies = (data ?? []) as CompanyRow[];

  if (companies.length === 0) {
    console.log("No companies have a hiring platform set yet. Run: npm run seed && npm run detect");
    return;
  }

  console.log(`Fetching ${companies.length} companies (${CONCURRENCY} at a time)...`);
  let ok = 0;
  await runPool(companies, CONCURRENCY, async (c) => {
    // Read the result first: `ok += await ...` would lose counts when companies run in parallel.
    const succeeded = await processCompany(c);
    ok += succeeded;
  });
  console.log(`Fetched ${ok} of ${companies.length} companies.`);

  const sent = await sendAlerts();
  console.log(
    `Alerts sent: ${sent.emails} email, ${sent.telegrams} Telegram, ${sent.whatsapps} WhatsApp.`,
  );

  if (ok === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
