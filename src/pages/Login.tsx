import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Loading } from "../components/Status";
import { useTitle } from "../hooks";
import { supabase } from "../supabase";

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/alerts";
}

export default function Login() {
  useTitle("Sign in");
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  if (loading) return <Loading />;
  if (user) return <Navigate to={next} replace />;

  // After the email link or Google, Supabase sends the person back to this page of the site.
  const redirectTo = `${window.location.origin}${next}`;

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    }
  }

  return (
    <div className="login-box">
      <div className="page-head">
        <h1 style={{ fontSize: "clamp(32px, 6vw, 44px)" }}>Sign in</h1>
        <p>You need an account to save alerts. No password, we email you a link.</p>
      </div>

      <div className="panel">
        {status === "sent" ? (
          <div className="notice ok" role="status" style={{ marginBottom: 0 }}>
            <strong>Check your email.</strong> We sent a sign-in link to {email}. Open it on this
            device to finish signing in.
          </div>
        ) : (
          <div className="form-grid">
            <form className="form-grid" onSubmit={sendLink}>
              <div>
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button type="submit" className="btn" disabled={status === "sending"}>
                {status === "sending" ? "Sending link" : "Email me a sign-in link"}
              </button>
            </form>

            <button type="button" className="btn ghost" onClick={google}>
              Continue with Google
            </button>

            {status === "error" && (
              <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
                {message || "Could not sign you in. Try again."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
