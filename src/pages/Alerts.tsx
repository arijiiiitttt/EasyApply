import { useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { SEGMENTS } from "../../lib/segments";
import type { AlertRow, ProfileRow } from "../../lib/types";
import { useAuth } from "../auth";
import { Loading, LoadError } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import { supabase } from "../supabase";

const botName = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, "");

const channelName = (c: string) => (c === "whatsapp" ? "WhatsApp" : c === "telegram" ? "Telegram" : "email");

function toList(value: FormDataEntryValue | null, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(value ?? "").split(/[\n,]+/)) {
    const item = raw.trim().slice(0, 60);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
  }
  return out.slice(0, max);
}

export default function Alerts() {
  useTitle("Alerts");
  const { user, loading: authLoading } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    if (!user) return null;
    const [profile, alerts] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,email,telegram_chat_id,telegram_link_code,whatsapp_number,whatsapp_link_code")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("alerts").select("*").order("created_at", { ascending: false }),
    ]);
    if (profile.error) throw new Error(profile.error.message);
    if (alerts.error) throw new Error(alerts.error.message);
    return {
      profile: profile.data as ProfileRow | null,
      alerts: (alerts.data ?? []) as AlertRow[],
    };
  }, user?.id ?? "none");

  if (authLoading) return <Loading />;
  if (!user) return <Navigate to="/login?next=/alerts" replace />;

  async function createAlert(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError("");
    setSaved(false);

    const form = new FormData(e.currentTarget);
    const keywords = toList(form.get("keywords"));
    if (keywords.length === 0) {
      setFormError("Add at least one keyword.");
      return;
    }
    const channels = form.getAll("channels").map(String).filter((c) => c === "email" || c === "telegram" || c === "whatsapp");
    const segments = form
      .getAll("segments")
      .map(String)
      .filter((s) => (SEGMENTS as readonly string[]).includes(s));

    setSaving(true);
    const { error: insertError } = await supabase.from("alerts").insert({
      user_id: user!.id,
      name: String(form.get("name") ?? "").trim().slice(0, 80),
      keywords,
      exclude_keywords: toList(form.get("exclude")),
      locations: toList(form.get("locations"), 10),
      segments,
      remote_only: form.get("remote_only") === "on",
      channels: channels.length > 0 ? channels : ["email"],
    });
    setSaving(false);

    if (insertError) {
      setFormError(insertError.message || "Could not save the alert. Try again.");
      return;
    }
    formRef.current?.reset();
    setSaved(true);
    reload();
  }

  async function toggle(alert: AlertRow) {
    const { error: updateError } = await supabase
      .from("alerts")
      .update({ active: !alert.active })
      .eq("id", alert.id);
    if (updateError) setFormError(updateError.message);
    reload();
  }

  async function remove(alert: AlertRow) {
    const { error: deleteError } = await supabase.from("alerts").delete().eq("id", alert.id);
    if (deleteError) setFormError(deleteError.message);
    reload();
  }

  async function disconnectTelegram() {
    const { error: rpcError } = await supabase.rpc("disconnect_telegram");
    if (rpcError) setFormError(rpcError.message);
    reload();
  }

  async function disconnectWhatsApp() {
    const { error: rpcError } = await supabase.rpc("disconnect_whatsapp");
    if (rpcError) setFormError(rpcError.message);
    reload();
  }

  const profile = data?.profile ?? null;
  const alerts = data?.alerts ?? [];

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: "clamp(32px, 6vw, 48px)" }}>Alerts</h1>
        <p>
          We check company career sites every 30 minutes. When a new role matches one of your
          alerts, we send it with a link to apply.
        </p>
      </div>

      {error && <LoadError message={error} onRetry={reload} />}
      {formError && (
        <div className="notice" role="alert">
          {formError}
        </div>
      )}
      {saved && !formError && (
        <div className="notice ok" role="status">
          Alert saved. You will hear from us when a matching role is posted.
        </div>
      )}
      {loading && !data && <Loading />}

      {data && (
        <>
          <section className="panel" aria-labelledby="telegram-heading">
            <h3 id="telegram-heading">Telegram</h3>
            {profile?.telegram_chat_id ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: "0 0 12px" }}>
                  Connected. Alerts that use Telegram arrive in your chat with the Easy Apply bot.
                </p>
                <button type="button" className="btn danger small" onClick={disconnectTelegram}>
                  Disconnect Telegram
                </button>
              </div>
            ) : botName && profile ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: "0 0 12px" }}>
                  Get alerts as instant messages. Tap the button, then press Start in Telegram.
                </p>
                <a
                  className="btn small"
                  href={`https://t.me/${botName}?start=${profile.telegram_link_code}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Connect Telegram
                </a>
              </div>
            ) : (
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Telegram alerts are not set up on this site yet. Email alerts work.
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="whatsapp-heading">
            <h3 id="whatsapp-heading">WhatsApp</h3>
            {profile?.whatsapp_number ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: "0 0 12px" }}>
                  Connected to +{profile.whatsapp_number}. Alerts that use WhatsApp arrive in your
                  chat with the Easy Apply number.
                </p>
                <button type="button" className="btn danger small" onClick={disconnectWhatsApp}>
                  Disconnect WhatsApp
                </button>
              </div>
            ) : whatsappNumber && profile ? (
              <div style={{ marginTop: 8 }}>
                <p className="muted" style={{ margin: "0 0 12px" }}>
                  Get alerts on WhatsApp. Tap the button, then send the message that opens. It
                  proves the number is yours.
                </p>
                <a
                  className="btn small"
                  href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Connect ${profile.whatsapp_link_code}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Connect WhatsApp
                </a>
              </div>
            ) : (
              <p className="muted" style={{ margin: "8px 0 0" }}>
                WhatsApp alerts are not set up on this site yet. Email alerts work.
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="new-heading">
            <h2 id="new-heading" style={{ marginBottom: 16 }}>
              New alert
            </h2>
            <form ref={formRef} onSubmit={createAlert} className="form-grid">
              <div>
                <label htmlFor="keywords">
                  Keywords <span className="hint">Separate with commas or new lines</span>
                </label>
                <textarea
                  id="keywords"
                  name="keywords"
                  required
                  placeholder={"react developer\ndata analyst fresher\ndevops"}
                />
                <p className="hint" style={{ margin: "6px 0 0" }}>
                  A role matches when all words of one keyword appear in its title.
                </p>
              </div>

              <div>
                <label htmlFor="exclude">
                  Skip roles with <span className="hint">Optional</span>
                </label>
                <input id="exclude" name="exclude" type="text" placeholder="senior, manager, intern" />
              </div>

              <div>
                <label htmlFor="locations">
                  Cities <span className="hint">Optional, leave empty for all of India</span>
                </label>
                <input id="locations" name="locations" type="text" placeholder="Bengaluru, Hyderabad, Kolkata" />
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, padding: 0 }}>
                  Company groups <span className="hint">Optional, leave empty for all</span>
                </legend>
                {SEGMENTS.map((s) => (
                  <label className="check" key={s}>
                    <input type="checkbox" name="segments" value={s} />
                    {s}
                  </label>
                ))}
              </fieldset>

              <div>
                <label className="check">
                  <input type="checkbox" name="remote_only" />
                  Remote roles only
                </label>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, padding: 0 }}>
                  Send alerts by
                </legend>
                <label className="check">
                  <input type="checkbox" name="channels" value="email" defaultChecked />
                  Email ({profile?.email ?? user.email})
                </label>
                <label className="check">
                  <input type="checkbox" name="channels" value="telegram" />
                  Telegram
                </label>
                <label className="check">
                  <input type="checkbox" name="channels" value="whatsapp" />
                  WhatsApp
                </label>
              </fieldset>

              <div>
                <label htmlFor="name">
                  Alert name <span className="hint">Optional</span>
                </label>
                <input id="name" name="name" type="text" placeholder="Frontend roles in Bengaluru" />
              </div>

              <div>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "Saving" : "Save alert"}
                </button>
              </div>
            </form>
          </section>

          <section style={{ marginTop: 36 }} aria-labelledby="mine-heading">
            <h2 id="mine-heading" style={{ marginBottom: 14 }}>
              Your alerts
            </h2>
            {alerts.length === 0 ? (
              <div className="empty">
                <h3>No alerts yet</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Add your first keywords above and we will start watching.
                </p>
              </div>
            ) : (
              <div className="tickets">
                {alerts.map((a) => (
                  <article className={`panel alert-card${a.active ? "" : " paused"}`} key={a.id}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{a.name || a.keywords.slice(0, 3).join(", ")}</h3>
                      <ul className="chips" aria-label="Keywords">
                        {a.keywords.map((k) => (
                          <li className="chip" key={k}>
                            {k}
                          </li>
                        ))}
                        {a.exclude_keywords.map((k) => (
                          <li className="chip neg" key={`x-${k}`}>
                            not {k}
                          </li>
                        ))}
                      </ul>
                      <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>
                        {a.locations.length > 0 ? a.locations.join(", ") : "All of India"}
                        {a.remote_only ? ", remote only" : ""}
                        {a.segments.length > 0 ? `, ${a.segments.join(", ")}` : ""}. Sent by{" "}
                        {a.channels.map(channelName).join(", ")}.{a.active ? "" : " Paused."}
                      </p>
                    </div>
                    <div className="actions">
                      <button type="button" className="btn ghost small" onClick={() => toggle(a)}>
                        {a.active ? "Pause" : "Resume"}
                      </button>
                      <button type="button" className="btn danger small" onClick={() => remove(a)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
