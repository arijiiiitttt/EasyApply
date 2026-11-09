import { getJson } from "../http";
import type { AtsAdapter, NormalizedJob } from "../types";

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  department?: { label?: string };
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
  };
}

interface SrResponse {
  totalFound?: number;
  content?: SrPosting[];
}

const PAGE = 100;
const MAX_JOBS = 1500;

export const smartrecruiters: AtsAdapter = {
  type: "smartrecruiters",
  async fetchJobs(token) {
    const jobs: NormalizedJob[] = [];
    let offset = 0;
    while (offset < MAX_JOBS) {
      const data = await getJson<SrResponse>(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=${PAGE}&offset=${offset}`,
      );
      const content = data.content ?? [];
      for (const p of content) {
        const country =
          p.location?.country?.toLowerCase() === "in"
            ? "India"
            : (p.location?.country ?? "").toUpperCase();
        const location = [p.location?.city, p.location?.region, country]
          .filter(Boolean)
          .join(", ");
        jobs.push({
          externalId: p.id,
          title: p.name,
          location,
          department: p.department?.label ?? null,
          isRemote: Boolean(p.location?.remote),
          applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${p.id}`,
          postedAt: p.releasedDate ?? null,
        });
      }
      offset += PAGE;
      if (content.length < PAGE || offset >= (data.totalFound ?? 0)) break;
    }
    return jobs;
  },
};
