import { Link } from "react-router-dom";
import type { JobWithCompany } from "../../lib/types";
import JobCard from "../components/JobCard";
import { Loading, LoadError } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import { supabase } from "../supabase";

async function loadHome() {
  const [latest, tracked, total, open] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, companies!inner(name,slug,segment)")
      .eq("active", true)
      .order("first_seen_at", { ascending: false })
      .limit(8),
    supabase.from("companies").select("id", { count: "exact", head: true }).not("ats", "is", null),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const failed = latest.error ?? tracked.error ?? total.error ?? open.error;
  if (failed) throw new Error(failed.message);
  return {
    jobs: (latest.data ?? []) as unknown as JobWithCompany[],
    tracked: tracked.count ?? 0,
    total: total.count ?? 0,
    open: open.count ?? 0,
  };
}

export default function Home() {
  useTitle("");
  const { data, error, loading, reload } = useAsync(loadHome, "home");

  return (
    <>
      <section className="hero">
        <h1>Be first in line.</h1>
        <p className="lede">
          Pick the keywords you care about. When a company in India posts a matching role, you get a
          message with a button that opens its own application page.
        </p>
        <div className="hero-actions">
          <Link to="/alerts" className="btn">
            Create an alert
          </Link>
          <Link to="/jobs" className="btn ghost">
            Browse open jobs
          </Link>
        </div>
        {data && (
          <p className="board-note">
            {data.open > 0
              ? `Watching ${data.tracked} of ${data.total} company career sites, with ${data.open} roles open right now.`
              : "No roles are loaded yet. Run the fetcher to fill the board."}
          </p>
        )}
      </section>

      {loading && !data && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}

      {data && data.jobs.length > 0 && (
        <section aria-labelledby="latest-heading">
          <h2 id="latest-heading" style={{ marginBottom: 14 }}>
            Just posted
          </h2>
          <div className="tickets">
            {data.jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
          <p style={{ marginTop: 18 }}>
            <Link to="/jobs">See all open jobs</Link>
          </p>
        </section>
      )}
    </>
  );
}
