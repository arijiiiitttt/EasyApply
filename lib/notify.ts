import type { JobWithCompany } from "./types";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const emailConfigured = () =>
  Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

function siteUrl(): string {
  return (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function alertLabel(name: string, keywords: string[]): string {
  return name.trim() || keywords.slice(0, 3).join(", ");
}

export function buildEmail(
  alertName: string,
  keywords: string[],
  jobs: JobWithCompany[],
  extra: number,
): { subject: string; html: string } {
  const label = alertLabel(alertName, keywords);
  const count = jobs.length + extra;
  const subject = `${count} new ${count === 1 ? "job" : "jobs"} for ${label}`;

  const rows = jobs
    .map(
      (j) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #e3e7ef">
          <div style="font-size:13px;color:#5b6478">${escapeHtml(j.companies.name)}</div>
          <div style="font-size:16px;font-weight:600;color:#17214a;margin:2px 0">${escapeHtml(j.title)}</div>
          <div style="font-size:13px;color:#5b6478;margin-bottom:8px">${escapeHtml(j.location || "India")}</div>
          <a href="${escapeHtml(j.apply_url)}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:8px 16px;border-radius:6px">Apply on company site</a>
        </td>
      </tr>`,
    )
    .join("");

  const more =
    extra > 0
      ? `<p style="font-size:14px;color:#5b6478">${extra} more are waiting. <a href="${siteUrl()}/jobs">See them on Easy Apply</a>.</p>`
      : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#eef2f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px">
    <h1 style="font-size:20px;color:#17214a;margin:0 0 4px">New jobs for ${escapeHtml(label)}</h1>
    <p style="font-size:14px;color:#5b6478;margin:0 0 8px">These openings were posted on company career sites.</p>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    ${more}
    <p style="font-size:12px;color:#8b93a7;margin-top:20px">
      You get this because of an alert on Easy Apply.
      <a href="${siteUrl()}/alerts" style="color:#8b93a7">Change or pause alerts</a>.
    </p>
  </div>
</body></html>`;

  return { subject, html };
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function sendTelegram(chatId: number, text: string): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) {
    throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Telegram messages are capped at 4096 characters, so jobs are split into chunks. */
export function buildTelegramMessages(
  alertName: string,
  keywords: string[],
  jobs: JobWithCompany[],
  extra: number,
): string[] {
  const label = escapeHtml(alertLabel(alertName, keywords));
  const header = `<b>New jobs for ${label}</b>\n\n`;
  const blocks = jobs.map(
    (j) =>
      `<b>${escapeHtml(j.title)}</b>\n${escapeHtml(j.companies.name)} · ${escapeHtml(j.location || "India")}\n<a href="${escapeHtml(j.apply_url)}">Apply on company site</a>`,
  );

  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    if ((current + block).length > 3500) {
      messages.push(current.trimEnd());
      current = "";
    }
    current += `${block}\n\n`;
  }
  if (extra > 0) {
    current += `${extra} more at ${siteUrl()}/jobs`;
  }
  if (current.trim()) messages.push(current.trimEnd());
  return messages;
}

// ---------------------------------------------------------------
// WhatsApp (Meta WhatsApp Cloud API)
//
// A business can only start a conversation with an approved template message.
// Once the person has messaged the bot in the last 24 hours, free text with links
// is allowed. So we try free text first and fall back to the template when
// WhatsApp answers "re-engagement required" (error code 131047).
// ---------------------------------------------------------------

export const whatsappConfigured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const RE_ENGAGEMENT_ERROR = 131047;

/** WhatsApp formats *bold* and _italic_, so strip those from job text. */
const plain = (s: string) => s.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();

export function buildWhatsAppText(
  alertName: string,
  keywords: string[],
  jobs: JobWithCompany[],
  extra: number,
): string {
  const lines = [`*New jobs for ${plain(alertLabel(alertName, keywords))}*`, ""];
  for (const j of jobs.slice(0, 10)) {
    lines.push(`*${plain(j.title)}*`);
    lines.push(`${plain(j.companies.name)}, ${plain(j.location || "India")}`);
    lines.push(`Apply: ${j.apply_url}`);
    lines.push("");
  }
  const hidden = extra + Math.max(0, jobs.length - 10);
  if (hidden > 0) lines.push(`${hidden} more at ${siteUrl()}/jobs`);
  return lines.join("\n").trim().slice(0, 4000);
}

/**
 * Template messages cannot contain new lines in their variables, so the jobs are
 * summarised on one line. Create a template in Meta Business Manager with this body:
 *   New jobs for {{1}}: {{2}} See them and apply here: {{3}}
 */
export function buildWhatsAppTemplateParams(
  alertName: string,
  keywords: string[],
  jobs: JobWithCompany[],
  extra: number,
): [string, string, string] {
  const shown = jobs
    .slice(0, 3)
    .map((j) => `${plain(j.title)} at ${plain(j.companies.name)}`)
    .join(", ");
  const more = jobs.length + extra - Math.min(3, jobs.length);
  const summary = more > 0 ? `${shown} and ${more} more.` : `${shown}.`;
  return [plain(alertLabel(alertName, keywords)).slice(0, 60), summary.slice(0, 600), `${siteUrl()}/jobs`];
}

async function whatsappPost(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(
    `${GRAPH_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (res.ok) return;

  const raw = await res.text();
  let code: number | undefined;
  try {
    code = (JSON.parse(raw) as { error?: { code?: number } }).error?.code;
  } catch {
    // not JSON
  }
  const error = new Error(`WhatsApp ${res.status}: ${raw.slice(0, 200)}`) as Error & {
    waCode?: number;
  };
  error.waCode = code;
  throw error;
}

export async function sendWhatsApp(
  to: string,
  text: string,
  templateParams?: [string, string, string],
): Promise<void> {
  const number = to.replace(/\D/g, "");
  try {
    await whatsappPost({ to: number, type: "text", text: { body: text, preview_url: false } });
  } catch (err) {
    const code = (err as { waCode?: number }).waCode;
    const template = process.env.WHATSAPP_TEMPLATE_NAME;
    if (code !== RE_ENGAGEMENT_ERROR || !template || !templateParams) throw err;
    await whatsappPost({
      to: number,
      type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
        components: [
          {
            type: "body",
            parameters: templateParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    });
  }
}
