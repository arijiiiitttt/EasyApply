import { readFileSync } from "node:fs";
import { adapters, detectFromText } from "../lib/ats";
import { isIndia } from "../lib/india";
import { matchesAlert } from "../lib/matcher";
import { buildEmail, buildTelegramMessages, buildWhatsAppTemplateParams, buildWhatsAppText, sendWhatsApp } from "../lib/notify";
import { parseCsv } from "../scripts/csv";
import type { AlertRow, JobWithCompany } from "../lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

function ok(name: string, cond: boolean, note = "") {
  check(name, cond, true);
  if (!cond && note) console.log(`      detail: ${note}`);
}

// ---- India detection
check("india: Bengaluru, Karnataka, India", isIndia("Bengaluru, Karnataka, India"), true);
check("india: Pune", isIndia("Pune"), true);
check("india: Hyderabad / Remote", isIndia("Hyderabad / Remote"), true);
check("india: Indiana, USA", isIndia("Indiana, USA"), false);
check("india: Indianapolis", isIndia("Indianapolis, IN"), false);
check("india: Remote", isIndia("Remote"), false);
check("india: London, UK", isIndia("London, UK"), false);
check("india: Gurugram, Haryana", isIndia("Gurugram, Haryana"), true);
check("india: empty", isIndia(""), false);

// ---- matcher
const job = (title: string, location = "Bengaluru, India", extra: Partial<JobWithCompany> = {}): JobWithCompany => ({
  id: "j1",
  company_id: "c1",
  external_id: "e1",
  title,
  location,
  department: null,
  is_remote: false,
  apply_url: "https://example.com/apply",
  posted_at: null,
  first_seen_at: new Date().toISOString(),
  active: true,
  is_baseline: false,
  companies: { name: "Acme", slug: "acme", segment: "Unicorn" },
  ...extra,
});
const alert = (extra: Partial<AlertRow>): AlertRow => ({
  id: "a1",
  user_id: "u1",
  name: "",
  keywords: ["react developer"],
  exclude_keywords: [],
  locations: [],
  segments: [],
  remote_only: false,
  channels: ["email"],
  active: true,
  created_at: new Date().toISOString(),
  ...extra,
});

check("match: exact phrase", matchesAlert(alert({}), job("React Developer")), true);
check("match: words in other order", matchesAlert(alert({}), job("Developer - React")), true);
check("match: plural title", matchesAlert(alert({ keywords: ["developer"] }), job("React Developers")), true);
check("match: no partial word", matchesAlert(alert({ keywords: ["react"] }), job("Reactive Systems Engineer")), false);
check("match: missing word", matchesAlert(alert({}), job("React Designer")), false);
check("match: exclude", matchesAlert(alert({ exclude_keywords: ["senior"] }), job("Senior React Developer")), false);
check("match: any of several keywords", matchesAlert(alert({ keywords: ["devops", "react developer"] }), job("DevOps Engineer")), true);
check("match: c++", matchesAlert(alert({ keywords: ["c++"] }), job("C++ Engineer")), true);
check("match: node.js", matchesAlert(alert({ keywords: ["node.js"] }), job("Node.js Developer")), true);
check("match: location pass", matchesAlert(alert({ locations: ["bengaluru"] }), job("React Developer")), true);
check("match: location fail", matchesAlert(alert({ locations: ["kolkata"] }), job("React Developer")), false);
check("match: remote only fail", matchesAlert(alert({ remote_only: true }), job("React Developer")), false);
check("match: remote only pass", matchesAlert(alert({ remote_only: true }), job("React Developer", "Remote, India", { is_remote: true })), true);
check("match: segment pass", matchesAlert(alert({ segments: ["Unicorn"] }), job("React Developer")), true);
check("match: segment fail", matchesAlert(alert({ segments: ["Global"] }), job("React Developer")), false);
check("match: department counts", matchesAlert(alert({ keywords: ["platform"] }), job("Engineer", "Pune", { department: "Platform" })), true);

// ---- ATS detection from links
check("detect: greenhouse", detectFromText("see https://boards.greenhouse.io/razorpay for jobs"), { ats: "greenhouse", token: "razorpay" });
check("detect: greenhouse embed ignored", detectFromText("https://boards.greenhouse.io/embed/job_board/js?for=acme"), null);
check("detect: lever", detectFromText('<a href="https://jobs.lever.co/cred/abc">'), { ats: "lever", token: "cred" });
check("detect: ashby", detectFromText("https://jobs.ashbyhq.com/postman"), { ats: "ashby", token: "postman" });
check("detect: workable", detectFromText("https://apply.workable.com/acme/"), { ats: "workable", token: "acme" });
check("detect: smartrecruiters", detectFromText("https://jobs.smartrecruiters.com/Acme1/123"), { ats: "smartrecruiters", token: "Acme1" });
check("detect: workday", detectFromText("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"), { ats: "workday", token: "nvidia|wd5|NVIDIAExternalCareerSite" });
check("detect: nothing", detectFromText("https://careers.example.com"), null);

// ---- CSV
const rows = parseCsv(readFileSync("data/companies.csv", "utf8"));
check("csv: 193 rows", rows.length, 193);
check("csv: slugs unique", new Set(rows.map((r) => r.slug)).size, 193);
check("csv: all fields set", rows.every((r) => r.name && r.slug && r.careers_url.startsWith("https://") && r.segment), true);
check("csv: quoted fields", parseCsv('a,b\n"x, y","say ""hi"""\n'), [{ a: "x, y", b: 'say "hi"' }]);

// ---- adapters with sample payloads (the shapes these public APIs document)
const realFetch = globalThis.fetch;
function mockFetch(payload: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
}
async function adapterTests() {
  mockFetch({ jobs: [{ id: 1, title: "SDE", location: { name: "Bangalore" }, absolute_url: "https://x/1", updated_at: "2026-01-01T00:00:00Z" }] });
  check("greenhouse maps", await adapters.greenhouse.fetchJobs("t"), [{ externalId: "1", title: "SDE", location: "Bangalore", department: null, isRemote: false, applyUrl: "https://x/1", postedAt: "2026-01-01T00:00:00Z" }]);

  mockFetch([{ id: "abc", text: "Data Analyst", hostedUrl: "https://l/abc", createdAt: 1767225600000, categories: { location: "Pune", team: "Data" } }]);
  const lev = await adapters.lever.fetchJobs("t");
  check("lever maps", [lev[0].externalId, lev[0].title, lev[0].location, lev[0].department, lev[0].applyUrl], ["abc", "Data Analyst", "Pune", "Data", "https://l/abc"]);

  mockFetch({ jobs: [{ id: "z", title: "PM", location: "Mumbai", secondaryLocations: [{ location: "Delhi" }], isRemote: false, jobUrl: "https://a/z", publishedAt: "2026-02-02" }, { id: "hidden", title: "X", isListed: false, jobUrl: "https://a/h" }] });
  const ash = await adapters.ashby.fetchJobs("t");
  check("ashby maps and hides unlisted", [ash.length, ash[0].location], [1, "Mumbai / Delhi"]);

  mockFetch({ totalFound: 1, content: [{ id: "77", name: "QA", releasedDate: "2026-03-03", location: { city: "Chennai", country: "in" } }] });
  const sr = await adapters.smartrecruiters.fetchJobs("Co");
  check("smartrecruiters maps", [sr[0].location, sr[0].applyUrl], ["Chennai, India", "https://jobs.smartrecruiters.com/Co/77"]);

  mockFetch({ jobs: [{ title: "Support", shortcode: "SC1", city: "Noida", country: "India", url: "https://w/sc1", published_on: "2026-04-04" }] });
  const wk = await adapters.workable.fetchJobs("t");
  check("workable maps", [wk[0].externalId, wk[0].location], ["SC1", "Noida, India"]);

  mockFetch({ total: 1, jobPostings: [{ title: "Engineer", externalPath: "/job/India-Pune/Engineer_R1", locationsText: "India, Pune", bulletFields: ["R1"] }] });
  const wd = await adapters.workday.fetchJobs("ten|wd5|Site");
  check("workday maps", [wd[0].externalId, wd[0].applyUrl], ["R1", "https://ten.wd5.myworkdayjobs.com/en-US/Site/job/India-Pune/Engineer_R1"]);

  let threw = false;
  try {
    await adapters.workday.fetchJobs("bad-token");
  } catch {
    threw = true;
  }
  check("workday rejects bad token", threw, true);

  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  let notFound = false;
  try {
    await adapters.lever.fetchJobs("missing");
  } catch {
    notFound = true;
  }
  check("404 throws", notFound, true);
  globalThis.fetch = realFetch;
}

// ---- notification text
function notifyTests() {
  const evil = job('<script>alert(1)</script> & "Dev"', "Pune", { apply_url: 'https://x.com/a?b=1&c="2"' });
  const mail = buildEmail("My <alert>", ["react"], [evil], 3);
  check("email: subject counts extra", mail.subject, "4 new jobs for My <alert>");
  check("email: no raw script tag", mail.html.includes("<script>"), false);
  check("email: escapes quotes in href", mail.html.includes('href="https://x.com/a?b=1&amp;c=&quot;2&quot;"'), true);
  const tg = buildTelegramMessages("", ["react", "node"], [evil], 0);
  check("telegram: one message", tg.length, 1);
  check("telegram: html escaped", tg[0].includes("&lt;script&gt;"), true);

  // WhatsApp text and template
  const wj = job("*Bold* _title_ with\nnew line", "Pune", { apply_url: "https://x.com/apply/1" });
  const wtext = buildWhatsAppText("", ["react"], [wj], 2);
  ok("whatsapp: includes the apply link", wtext.includes("Apply: https://x.com/apply/1"), wtext);
  ok("whatsapp: strips formatting characters from titles", !/\*Bold\*/.test(wtext) && wtext.includes("*Bold title with new line*"), wtext);
  ok("whatsapp: mentions the extra jobs", wtext.includes("2 more at"), wtext);
  const manyJobs = Array.from({ length: 40 }, (_, i) => job(`Role ${i} ${"y".repeat(200)}`));
  ok("whatsapp: long list is cut under 4096", buildWhatsAppText("", ["role"], manyJobs, 0).length <= 4000);
  const tparams = buildWhatsAppTemplateParams("My alert", ["react"], [wj, job("Second"), job("Third"), job("Fourth")], 0);
  ok("whatsapp template: 3 variables without line breaks", tparams.length === 3 && tparams.every((p) => !/\n/.test(p)), JSON.stringify(tparams));
  ok("whatsapp template: summary counts the rest", /and 1 more\.$/.test(tparams[1]), tparams[1]);
  const many = Array.from({ length: 25 }, (_, i) => job(`Role ${i} ${"x".repeat(150)}`));
  const split = buildTelegramMessages("", ["role"], many, 0);
  check("telegram: long list is split under 4096", split.every((m) => m.length < 4096) && split.length > 1, true);
}

async function whatsappSendTests() {
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "99";
  const sent: { type: string; to: string }[] = [];
  const mode = { reengage: false, hardFail: false };
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ type: body.type, to: body.to });
    if (mode.hardFail) return new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 });
    if (mode.reengage && body.type === "text") return new Response(JSON.stringify({ error: { code: 131047 } }), { status: 400 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  await sendWhatsApp("+91 98765-43210", "hi", ["a", "b", "c"]);
  ok("whatsapp send: plain text first, number reduced to digits", sent.length === 1 && sent[0].type === "text" && sent[0].to === "919876543210", JSON.stringify(sent));

  sent.length = 0; mode.reengage = true;
  process.env.WHATSAPP_TEMPLATE_NAME = "job_alert";
  await sendWhatsApp("919876543210", "hi", ["a", "b", "c"]);
  ok("whatsapp send: falls back to the template outside the 24h window", sent.map((s) => s.type).join() === "text,template", JSON.stringify(sent));

  sent.length = 0; delete process.env.WHATSAPP_TEMPLATE_NAME;
  let threw = false;
  try { await sendWhatsApp("919876543210", "hi", ["a", "b", "c"]); } catch { threw = true; }
  ok("whatsapp send: without a template name the error is raised (so it is retried later)", threw && sent.length === 1);

  sent.length = 0; mode.reengage = false; mode.hardFail = true; process.env.WHATSAPP_TEMPLATE_NAME = "job_alert";
  threw = false;
  try { await sendWhatsApp("919876543210", "hi", ["a", "b", "c"]); } catch { threw = true; }
  ok("whatsapp send: other errors do not trigger the template", threw && sent.length === 1);
  globalThis.fetch = realFetch;
}

(async () => {
  await adapterTests();
  await whatsappSendTests();
  notifyTests();
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
