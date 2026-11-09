import { Link } from "react-router-dom";
import { SEGMENTS } from "../../lib/segments";
import { Loading, LoadError } from "../components/Status";
import { useAsync, useTitle } from "../hooks";
import { supabase } from "../supabase";

interface CompanyListRow {
  id: string;
  name: string;
  slug: string;
  careers_url: string;
  segment: string;
  ats: string | null;
  open_jobs: number;
}

export default function Companies() {
  useTitle("Companies");
  const { data, error, loading, reload } = useAsync(async () => {
    const res = await supabase
      .from("companies_with_counts")
      .select("id,name,slug,careers_url,segment,ats,open_jobs")
      .eq("active", true)
      .order("name");
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []) as CompanyListRow[];
  }, "companies");

  const companies = data ?? [];
  const tracked = companies.filter((c) => c.ats).length;

  return (
    <>
      <div className="page-head">
        <h1 style={{ fontSize: "clamp(32px, 6vw, 48px)" }}>Companies</h1>
        <p>
          {companies.length} companies hiring in India. {tracked} are tracked, so their new roles
          trigger alerts. The rest link to their career page.
        </p>
      </div>

      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading />}

      {SEGMENTS.map((segment) => {
        const group = companies.filter((c) => c.segment === segment);
        if (group.length === 0) return null;
        return (
          <section className="group" key={segment} aria-labelledby={`seg-${segment}`}>
            <h2 id={`seg-${segment}`}>{segment}</h2>
            <ul className="company-list">
              {group.map((c) => (
                <li key={c.id}>
                  <div>
                    <span className="company-name">{c.name}</span>{" "}
                    {c.ats ? (
                      <span className="status on">
                        {c.open_jobs} open {c.open_jobs === 1 ? "role" : "roles"}
                      </span>
                    ) : (
                      <span className="status">Career page only</span>
                    )}
                  </div>
                  <div className="company-links">
                    {c.ats && c.open_jobs > 0 && (
                      <Link to={`/jobs?company=${encodeURIComponent(c.slug)}`}>View roles</Link>
                    )}
                    <a href={c.careers_url} target="_blank" rel="noopener noreferrer">
                      Career page
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
