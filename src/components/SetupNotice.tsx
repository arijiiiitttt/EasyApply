export default function SetupNotice() {
  return (
    <section className="panel setup">
      <h2>Connect your database to start</h2>
      <p className="muted">Easy Apply needs a Supabase project before it can show anything.</p>
      <ol>
        <li>
          Create a free project at <code>supabase.com</code> and run <code>supabase/setup.sql</code>{" "}
          in its SQL editor.
        </li>
        <li>
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in{" "}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </li>
        <li>
          Restart <code>npm run dev</code>, then run <code>npm run seed</code>,{" "}
          <code>npm run detect</code> and <code>npm run fetch</code>.
        </li>
      </ol>
      <p className="muted">The README walks through each step.</p>
    </section>
  );
}
