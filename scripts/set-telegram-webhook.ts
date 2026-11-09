import "./env";

// Tells Telegram where to send messages your bot receives: the telegram-webhook
// Edge Function in your Supabase project. Run after deploying the function:
//   npm run telegram:webhook
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !supabaseUrl) {
    throw new Error("Set TELEGRAM_BOT_TOKEN and SUPABASE_URL first.");
  }

  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/telegram-webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret || undefined,
      allowed_updates: ["message"],
    }),
  });
  console.log(res.status, await res.text());
  console.log(`Webhook set to ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
