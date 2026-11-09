// Supabase Edge Function (Deno). Meta's WhatsApp Cloud API calls this when someone
// messages your WhatsApp business number.
//
//   GET   Meta's one-time webhook check (hub.challenge).
//   POST  A message "Connect <code>" links that WhatsApp number to the Easy Apply
//         account the code belongs to. "STOP" unlinks it.
//
// Because the person messages first, the number is proven to be theirs and
// WhatsApp opens a 24 hour window in which we may reply with free text.
//
// Deploy:
//   supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... \
//     WHATSAPP_VERIFY_TOKEN=... WHATSAPP_APP_SECRET=...
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

interface WhatsAppPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; type?: string; text?: { body?: string } }[];
      };
    }[];
  }[];
}

const encoder = new TextEncoder();

const respond = (body: string, status = 200) => new Response(body, { status });

async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const expected = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function reply(to: string, text: string): Promise<void> {
  await fetch(
    `https://graph.facebook.com/v21.0/${Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (
      verifyToken &&
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === verifyToken
    ) {
      return respond(url.searchParams.get("hub.challenge") ?? "");
    }
    return respond("Forbidden", 403);
  }

  if (request.method !== "POST") return respond("Method not allowed", 405);

  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret || !Deno.env.get("WHATSAPP_TOKEN")) return respond("Not configured", 503);

  const raw = await request.text();
  if (!(await validSignature(raw, request.headers.get("x-hub-signature-256"), appSecret))) {
    return respond("Bad signature", 401);
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(raw) as WhatsAppPayload;
  } catch {
    return respond("ok");
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const from = message.from?.replace(/\D/g, "");
        const text = message.text?.body?.trim();
        if (!from || message.type !== "text" || !text) continue;

        const code = text.toLowerCase().match(/\b[a-f0-9]{32}\b/)?.[0];

        if (code) {
          const { data: profile } = await db
            .from("profiles")
            .select("id")
            .eq("whatsapp_link_code", code)
            .maybeSingle();
          if (!profile) {
            await reply(
              from,
              "That link is no longer valid. Open Alerts on Easy Apply and tap Connect WhatsApp again.",
            );
            continue;
          }
          // One number belongs to one account, and the link code is replaced after use.
          await db.from("profiles").update({ whatsapp_number: null }).eq("whatsapp_number", from);
          await db
            .from("profiles")
            .update({
              whatsapp_number: from,
              whatsapp_link_code: crypto.randomUUID().replace(/-/g, ""),
            })
            .eq("id", profile.id);
          await reply(
            from,
            "Connected. Roles that match your alerts will arrive here. Send STOP to disconnect.",
          );
        } else if (text.toLowerCase() === "stop") {
          await db.from("profiles").update({ whatsapp_number: null }).eq("whatsapp_number", from);
          await reply(from, "Disconnected. You will not get alerts on this number.");
        } else {
          await reply(
            from,
            "To connect this number, open Easy Apply, go to Alerts and tap Connect WhatsApp.",
          );
        }
      }
    }
  }

  return respond("ok");
});
