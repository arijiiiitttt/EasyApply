// Supabase Edge Function (Deno). Telegram calls this when someone messages the bot.
// "/start <code>" links that chat to the Easy Apply account the code belongs to.
//
// Deploy:
//   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=...
//   supabase functions deploy telegram-webhook --no-verify-jwt
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

interface TelegramUpdate {
  message?: { text?: string; chat?: { id: number } };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function send(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ ok: false }, 405);

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return json({ ok: false }, 401);
  }
  if (!Deno.env.get("TELEGRAM_BOT_TOKEN")) return json({ ok: false }, 503);

  const update = (await request.json()) as TelegramUpdate;
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (!text || !chatId) return json({ ok: true });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code || !/^[a-f0-9]{32}$/.test(code)) {
      await send(
        chatId,
        "To connect this chat, open Easy Apply, go to Alerts and tap Connect Telegram.",
      );
      return json({ ok: true });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .eq("telegram_link_code", code)
      .maybeSingle();
    if (!profile) {
      await send(
        chatId,
        "That link is no longer valid. Open Alerts on Easy Apply and tap Connect Telegram again.",
      );
      return json({ ok: true });
    }

    // One chat belongs to one account, and the link code is replaced after use.
    await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
    await db
      .from("profiles")
      .update({
        telegram_chat_id: chatId,
        telegram_link_code: crypto.randomUUID().replace(/-/g, ""),
      })
      .eq("id", profile.id);
    await send(
      chatId,
      "Connected. Roles that match your alerts will arrive here. Send /stop to disconnect.",
    );
    return json({ ok: true });
  }

  if (text === "/stop") {
    await db.from("profiles").update({ telegram_chat_id: null }).eq("telegram_chat_id", chatId);
    await send(chatId, "Disconnected. You will not get alerts in this chat.");
  }

  return json({ ok: true });
});
