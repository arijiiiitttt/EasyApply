import { timeAgo } from "../../lib/format";
import type { JobWithCompany } from "../../lib/types";

const FRESH_MS = 48 * 3600 * 1000;

export default function JobCard({ job }: { job: JobWithCompany }) {
  const fresh = !job.is_baseline && Date.now() - new Date(job.first_seen_at).getTime() < FRESH_MS;

  return (
    <article className="ticket">
      <div className="ticket-main">
        <div className="ticket-company">
          {job.companies.name}
          <span className="tag">{job.companies.segment}</span>
          {fresh && <span className="tag fresh">New</span>}
          {job.is_remote && <span className="tag">Remote</span>}
        </div>
        <h3>{job.title}</h3>
        <p className="ticket-meta">
          {job.location || "India"}
          {job.department ? `, ${job.department}` : ""}
        </p>
      </div>
      <div className="ticket-stub">
        <span className="ticket-age">{timeAgo(job.first_seen_at)}</span>
        <a className="btn small" href={job.apply_url} target="_blank" rel="noopener noreferrer">
          Apply
        </a>
      </div>
    </article>
  );
}
