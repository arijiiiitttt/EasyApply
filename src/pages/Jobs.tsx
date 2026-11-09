import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cleanSearchTerm } from "../../lib/format";
import { SEGMENTS } from "../../lib/segments";
import type { JobWithCompany } from "../../lib/types";
import JobCard from "../components/JobCard";
import { Loading, LoadError } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import { supabase } from "../supabase";

const PAGE_SIZE = 25;

export default function Jobs() {
  useTitle("Open jobs");
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const location = params.get("location") ?? "";
  const segment = params.get("segment") ?? "";
  const company = params.get("company") ?? "";
  const remote = params.get("remote") === "1";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const { data, error, loading, reload } = useAsync(async () => {
    let query = supabase
      .from("jobs")
      .select("*, companies!inner(name,slug,segment)", { count: "exact" })
      .eq("active", true)
      .order("first_seen_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    for (const term of q.split(/\s+/).map(cleanSearchTerm).filter(Boolean).slice(0, 6)) {
      query = query.ilike("title", `%${term}%`);
    }
    const loc = cleanSearchTerm(location);
    if (loc) query = query.ilike("location", `%${loc}%`);
    if (segment) query = query.eq("companies.segment", segment);
    if (company) query = query.eq("companies.slug", cleanSearchTerm(company));
    if (remote) query = query.eq("is_remote", true);

    const res = await query;
    if (res.error) throw new Error(res.error.message);
    return { jobs: (res.data ?? []) as unknown as JobWithCompany[], total: res.count ?? 0 };
  }, params.toString());

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const name of ["q", "location", "segment"]) {
      const value = String(form.get(name) ?? "").trim();
      if (value) next.set(name, value);
    }
    if (form.get("remote")) next.set("remote", "1");
    if (company) next.set("company", company);
    setParams(next);
  }

  function goTo(target: number) {
    const next = new URLSearchParams(params);
    if (target > 1) next.set("page", String(target));
    else next.delete("page");
    setParams(next);
    window.scrollTo(0, 0);
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || location || segment || company || remote);

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: "clamp(32px, 6vw, 48px)" }}>Open jobs</h1>
        <p>Roles in India, newest first. Every Apply button opens the company&apos;s own page.</p>
      </div>

      <form className="filters" onSubmit={submit} key={params.toString()}>
        <div>
          <label htmlFor="q">Job title keywords</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="react developer" />
        </div>
        <div>
          <label htmlFor="location">City</label>
          <input id="location" name="location" type="text" defaultValue={location} placeholder="Bengaluru" />
        </div>
        <div>
          <label htmlFor="segment">Company group</label>
          <select id="segment" name="segment" defaultValue={segment}>
            <option value="">All companies</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="row-end">
          <label className="check">
            <input type="checkbox" name="remote" defaultChecked={remote} />
            Remote only
          </label>
          <button type="submit" className="btn">
            Search
          </button>
          {filtered && <Link to="/jobs">Clear filters</Link>}
        </div>
      </form>

      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {data && data.jobs.length === 0 && (
        <div className="empty">
          <h3>No roles match yet</h3>
          <p className="muted" style={{ margin: "0 0 14px" }}>
            Try fewer keywords. Or create an alert and we will tell you when a match appears.
          </p>
          <Link to="/alerts" className="btn small">
            Create an alert
          </Link>
        </div>
      )}

      {data && data.jobs.length > 0 && (
        <>
          <p className="result-count">
            {total.toLocaleString("en-IN")} {total === 1 ? "role" : "roles"}, page {page} of {lastPage}
          </p>
          <div className="tickets" style={{ opacity: loading ? 0.6 : 1 }}>
            {data.jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
          <div className="pager">
            {page > 1 ? (
              <button type="button" className="btn ghost small" onClick={() => goTo(page - 1)}>
                Previous page
              </button>
            ) : (
              <span />
            )}
            {page < lastPage ? (
              <button type="button" className="btn ghost small" onClick={() => goTo(page + 1)}>
                Next page
              </button>
            ) : (
              <span />
            )}
          </div>
        </>
      )}
    </>
  );
}
